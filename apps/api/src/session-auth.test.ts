import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ScriptedProvider, hostManifestSchema, type OperatorEvent } from '@vex/operator';
import { createCitasApp } from '@vex/sample-tools';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { MockPlatform } from './platform/mock.ts';
import { MemoryStore } from './storage.ts';

// A connector with `auth.kind: 'session'` acts with the person's own host token: the host's API sees
// who asks. Here the appointments API only accepts one bearer: the JWT the host issued to Marta.

type Streamed = OperatorEvent | { type: 'session'; sessionId: string };
const parseSse = (body: string): Streamed[] =>
  body
    .split('\n\n')
    .filter((c) => c.includes('data: '))
    .map((c) => JSON.parse(c.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as Streamed);

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const SECRET = 'secreto-compartido-con-el-host';
const sec = Math.floor(Date.now() / 1000);
function hostJwt(claims: Record<string, unknown>): string {
  const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'https://host.example', aud: 'vex', exp: sec + 600, ...claims })}`;
  return `${input}.${createHmac('sha256', SECRET).update(input).digest('base64url')}`;
}
const MARTA = hostJwt({ sub: 'h-marta', name: 'Marta', role: 'owner' });
const PAU = hostJwt({ sub: 'h-pau', name: 'Pau', role: 'staff' });

describe('connectors that act with the person\'s session', () => {
  let citas: ReturnType<typeof createCitasApp>;
  let citasBase = '';
  let app: FastifyInstance | undefined;
  let store: MemoryStore;

  beforeAll(async () => {
    // The host's API trusts exactly the host's JWT for Marta, nothing else.
    citas = createCitasApp({ baseUrl: 'http://127.0.0.1:0', token: MARTA });
    await citas.listen({ port: 0, host: '127.0.0.1' });
    citasBase = `http://127.0.0.1:${(citas.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await citas.close();
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start() {
    store = new MemoryStore();
    const manifest = hostManifestSchema.parse({
      format: 'vex-host',
      version: 1,
      host: { name: 'Host', domain: 'host.example' },
      identity: { kind: 'hs256', secretEnv: 'HOST_JWT_SECRET', issuer: 'https://host.example', audience: 'vex', claims: { roles: { owner: 'admin', staff: 'gestora' } } },
      connectors: [{ id: 'citas', name: 'Agenda', source: { kind: 'openapi', url: `${citasBase}/openapi.json` }, baseUrl: citasBase, auth: { kind: 'session' } }],
    });
    app = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(), store, manifest, demoLogin: true, connectors: { env: { HOST_JWT_SECRET: SECRET }, mcpAllow: [], urlPolicy: { allowHttp: true, allowInternal: true } } });
    await app.ready();
    const headers = (token: string) => ({ authorization: `Bearer ${token}` });
    const list = (await app.inject({ method: 'GET', url: '/connectors', headers: headers(MARTA) })).json() as Array<{ id: string; tools: Array<{ name: string; suggestedRisk: string }> }>;
    const tools = list.find((c) => c.id === 'citas')!.tools;
    expect((await app.inject({ method: 'POST', url: '/connectors/citas/review', headers: headers(MARTA), payload: { decisions: tools.map((t) => ({ name: t.name, risk: t.suggestedRisk, enabled: true })) } })).statusCode).toBe(200);
    return headers;
  }

  it('the host JWT reaches the host\'s API as the bearer, and never the audit, the stream or the card', async () => {
    const headers = await start();
    const run = await app!.inject({ method: 'POST', url: '/operator/chat', headers: headers(MARTA), payload: { message: 'usa citas_listar_huecos {"fecha":"2026-10-30"}' } });
    const events = parseSse(run.body);
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ outcome: 'ok' });
    expect(events.at(-1)).toMatchObject({ type: 'done', reply: expect.stringContaining('Hecho (citas_listar_huecos)') });
    expect(run.body).not.toContain(MARTA);
    expect(JSON.stringify(store.auditEntries)).not.toContain(MARTA);
    expect(store.auditEntries.find((e) => e.tool === 'citas_listar_huecos')?.principal).toEqual({ id: 'h-marta', name: 'Marta', role: 'admin' });

    // An irreversible step: the card shows the request, not the credential. The run waits for the decision; we reject it.
    const reminder = app!.inject({ method: 'POST', url: '/operator/chat', headers: headers(MARTA), payload: { sessionId: 's-marta', message: 'usa citas_enviar_recordatorio {"id":"CITA-101","body":{"canal":"sms"}}' } });
    let decided = 404;
    for (let i = 0; i < 100 && decided !== 200; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      decided = (await app!.inject({ method: 'POST', url: '/operator/confirm', headers: headers(MARTA), payload: { sessionId: 's-marta', actionId: 'call_1_citas_enviar_recordatorio', approved: false } })).statusCode;
    }
    const confirm = parseSse((await reminder).body).find((e) => e.type === 'confirm') as { action: { details: Record<string, unknown> } } | undefined;
    expect(confirm).toBeDefined();
    expect(JSON.stringify(confirm!.action.details)).not.toContain(MARTA);
  });

  it('another person\'s host JWT is refused by the host\'s API, with a plain message and no retry', async () => {
    const headers = await start();
    const events = parseSse((await app!.inject({ method: 'POST', url: '/operator/chat', headers: headers(PAU), payload: { message: 'usa citas_listar_huecos {"fecha":"2026-10-30"}' } })).body);
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ outcome: 'error', summary: expect.stringContaining('no acepta tu sesión (401)') });
    expect(store.auditEntries.filter((e) => e.tool === 'citas_listar_huecos')).toHaveLength(1);
  });

  it('a Vex token (the demo login) carries no host credential: the tool says so instead of acting as a service account', async () => {
    const headers = await start();
    const demo = ((await app!.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-cesar' } })).json() as { token: string }).token;
    const events = parseSse((await app!.inject({ method: 'POST', url: '/operator/chat', headers: headers(demo), payload: { message: 'usa citas_listar_huecos {"fecha":"2026-10-30"}' } })).body);
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ outcome: 'error', summary: expect.stringContaining('no trae un token del host') });
  });

  it('a manifest with a session connector and no identity does not validate', () => {
    expect(
      hostManifestSchema.safeParse({ format: 'vex-host', version: 1, host: { name: 'H', domain: 'h.example' }, connectors: [{ id: 'citas', source: { kind: 'openapi', url: 'https://h/openapi.json' }, auth: { kind: 'session' } }] }).success,
    ).toBe(false);
  });
});
