import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ScriptedProvider, type OperatorEvent } from '@vex/operator';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from './app.ts';
import { ApprovalTokens, signature, webhookBody } from './approvals.ts';
import { parseHostManifest } from './host.ts';
import { MockPlatform } from './platform/mock.ts';
import { MemoryStore } from './storage.ts';

const LONG_REQUEST = 'Busca a Laura Pérez, abre expediente de residencia, crea una tarea para extranjería y mándale un correo pidiendo documentación';
const SECRET = 'un-secreto-de-pruebas-con-mas-de-treinta-y-dos-bytes';

type Streamed = OperatorEvent | { type: 'session'; sessionId: string };
function parseSse(body: string): Streamed[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.includes('data: '))
    .map((chunk) => JSON.parse(chunk.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as Streamed);
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout waiting for ${label}`);
}

describe('approval links', () => {
  it('round-trip, expire with the confirmation, and refuse anything altered or foreign', () => {
    let now = Date.parse('2026-10-26T10:00:00Z');
    const tokens = new ApprovalTokens(SECRET, () => now);
    const claim = { sessionId: 's-1', actionId: 'call_5_enviar_correo', principalId: 'u-ana' };
    const token = tokens.issue(claim, 60_000);
    expect(tokens.verify(token)).toEqual(claim);
    const [v, payload, sig] = token.split('.') as [string, string, string];
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), actionId: 'call_9_otra' })).toString('base64url');
    expect(tokens.verify(`${v}.${edited}.${sig}`)).toBeNull();
    expect(tokens.verify(new ApprovalTokens(`${SECRET}-otro`).issue(claim, 60_000))).toBeNull();
    expect(tokens.verify('v1.x')).toBeNull();
    now += 60_001;
    expect(tokens.verify(token)).toBeNull();
    expect(() => new ApprovalTokens('corto')).toThrow(/32 bytes/);
  });
});

describe('approvals by channel', () => {
  let app: FastifyInstance | undefined;
  let store: MemoryStore;
  let platform: MockPlatform;
  let hook: Server;
  let hookUrl: string;
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
  let hookStatus = 200;

  beforeAll(async () => {
    hook = createServer((req, res) => {
      let body = '';
      req.on('data', (d: Buffer) => (body += d.toString()));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(hookStatus).end();
      });
    });
    await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
    hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/vex/aprobaciones`;
    return () => new Promise<void>((r) => hook.close(() => r()));
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    received.length = 0;
    hookStatus = 200;
  });

  const manifest = (channels: unknown[], on = true) =>
    parseHostManifest(JSON.stringify({ format: 'vex-host', version: 1, host: { name: 'Demo', domain: 'demo.example' }, features: { channelApprovals: on }, approvals: { channels } }), 'test');

  async function start(extra: Partial<AppOptions> = {}) {
    store = new MemoryStore();
    platform = new MockPlatform(() => new Date('2026-10-23T10:00:00.000Z'));
    app = buildApp({
      provider: new ScriptedProvider(),
      platform,
      store,
      demoLogin: true,
      confirmTimeoutMs: 5000,
      publicUrl: 'https://vex.example',
      approvalSecret: SECRET,
      connectors: { urlPolicy: { allowHttp: true, allowInternal: true }, env: { HOOK_SECRET: 'clave-del-webhook' } },
      ...extra,
    });
    await app.ready();
  }
  const login = async (userId: string) => ({ authorization: `Bearer ${((await app!.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId } })).json() as { token: string }).token}` });
  const chat = (headers: Record<string, string>, sessionId: string) => app!.inject({ method: 'POST', url: '/operator/chat', headers, payload: { sessionId, message: LONG_REQUEST } });

  it('sends the card out through a signed webhook, and the link approves what the page would', async () => {
    await start({ manifest: manifest([{ kind: 'webhook', url: hookUrl, secretEnv: 'HOOK_SECRET' }, { kind: 'log' }]) });
    const cesar = await login('u-cesar');
    const run = chat(cesar, 's-hook');
    await waitFor(() => received.length === 1, 'webhook');
    const body = JSON.parse(received[0]!.body) as { type: string; approveUrl: string; details: Record<string, string>; principal: { id: string }; tool: string; expiresAt: string };
    expect(body).toMatchObject({ type: 'approval_requested', tool: 'enviar_correo', principal: { id: 'u-cesar' }, details: { para: 'laura.perez@ejemplo.es' } });
    expect(received[0]!.headers['x-vex-event']).toBe('approval_requested');
    expect(received[0]!.headers['x-vex-signature']).toBe(signature('clave-del-webhook', received[0]!.body));
    expect(body.approveUrl).toMatch(/^https:\/\/vex\.example\/approve\/v1\./);
    const token = body.approveUrl.split('/approve/')[1]!;

    // The page shows the real preview; the form is same-origin and passes the origin check.
    const page = await app!.inject({ method: 'GET', url: `/approve/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('laura.perez@ejemplo.es');
    expect(page.body).toContain('Pedir documentación');
    expect(page.body).toContain('Aprobar');
    expect((await app!.inject({ method: 'POST', url: `/approve/${token}/approve`, headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
    const approved = await app!.inject({ method: 'POST', url: `/approve/${token}/approve`, headers: { origin: 'http://localhost:80', host: 'localhost:80' } });
    expect(approved.statusCode).toBe(200);
    expect(approved.body).toContain('Aprobado');

    const events = parseSse((await run).body);
    expect(events.find((e) => e.type === 'notice')).toEqual({ type: 'notice', message: 'Te he avisado por webhook y el registro del servidor por si prefieres aprobarlo desde allí.' });
    expect(events.at(-1)).toMatchObject({ type: 'done', reply: expect.stringContaining('Correo enviado a laura.perez@ejemplo.es') });
    expect(await platform.correos()).toHaveLength(1);
    expect(store.auditEntries.filter((e) => e.tool === 'avisar_aprobacion').map((e) => `${e.params['canal']}:${e.outcome}`)).toEqual(['webhook:ok', 'log:ok']);
    // Single use: the same link is gone.
    expect((await app!.inject({ method: 'POST', url: `/approve/${token}/approve` })).statusCode).toBe(410);
    expect((await app!.inject({ method: 'GET', url: `/approve/${token}` })).statusCode).toBe(410);
    expect((await app!.inject({ method: 'GET', url: '/approve/v1.no.valido' })).statusCode).toBe(400);
  });

  it('a rejection from the link stops the run without sending', async () => {
    await start({ manifest: manifest([{ kind: 'webhook', url: hookUrl }]) });
    const cesar = await login('u-cesar');
    const run = chat(cesar, 's-no');
    await waitFor(() => received.length === 1, 'webhook');
    expect(received[0]!.headers['x-vex-signature']).toBeUndefined();
    const token = (JSON.parse(received[0]!.body) as { approveUrl: string }).approveUrl.split('/approve/')[1]!;
    const rejected = await app!.inject({ method: 'POST', url: `/approve/${token}/reject` });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.body).toContain('Rechazado');
    const events = parseSse((await run).body);
    expect(events.find((e) => e.type === 'tool_result' && e.outcome === 'rejected')).toBeDefined();
    expect(await platform.correos()).toHaveLength(0);
  });

  it('a channel that fails never blocks the card, and it shows in the audit', async () => {
    await start({ manifest: manifest([{ kind: 'webhook', url: 'http://127.0.0.1:1/down' }, { kind: 'webhook', url: hookUrl, secretEnv: 'NO_EXISTE' }]) });
    const cesar = await login('u-cesar');
    const run = chat(cesar, 's-down');
    await waitFor(() => store.auditEntries.filter((e) => e.tool === 'avisar_aprobacion').length === 2, 'audit');
    expect(store.auditEntries.filter((e) => e.tool === 'avisar_aprobacion').map((e) => e.outcome)).toEqual(['error', 'error']);
    expect(store.auditEntries.find((e) => e.error?.includes('NO_EXISTE'))).toBeDefined();
    expect(received).toHaveLength(0);
    // The page still works as before.
    expect((await app!.inject({ method: 'POST', url: '/operator/confirm', headers: cesar, payload: { sessionId: 's-down', actionId: 'call_5_enviar_correo', approved: true } })).statusCode).toBe(200);
    const events = parseSse((await run).body);
    expect(events.find((e) => e.type === 'notice')).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('with the feature off nothing leaves the page', async () => {
    await start({ manifest: manifest([{ kind: 'webhook', url: hookUrl }], false) });
    const cesar = await login('u-cesar');
    const run = chat(cesar, 's-off');
    await waitFor(() => store.auditEntries.some((e) => e.tool === 'redactar_correo'), 'parked');
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(0);
    expect((await app!.inject({ method: 'POST', url: '/operator/confirm', headers: cesar, payload: { sessionId: 's-off', actionId: 'call_5_enviar_correo', approved: false } })).statusCode).toBe(200);
    expect(parseSse((await run).body).find((e) => e.type === 'notice')).toBeUndefined();
  });

  it('describes the delivery the host receives', () => {
    const body = JSON.parse(
      webhookBody({
        sessionId: 's',
        principal: { id: 'u-ana', name: 'Ana', role: 'gestora' },
        action: { id: 'a1', tool: 'enviar_correo', driver: 'platform', risk: 'irreversible', params: { borradorId: 'b-1' }, summary: 'Enviar el correo b-1', details: { para: 'x@y.z' } },
        approveUrl: 'https://vex.example/approve/t',
        expiresAt: '2026-10-26T10:05:00.000Z',
      }),
    ) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['actionId', 'approveUrl', 'details', 'expiresAt', 'params', 'principal', 'risk', 'sessionId', 'summary', 'tool', 'type']);
  });
});
