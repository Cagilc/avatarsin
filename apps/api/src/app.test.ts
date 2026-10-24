import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScriptedProvider, type CompletionRequest, type ModelProvider, type OperatorEvent } from '@vex/operator';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from './app.ts';
import { MockPlatform } from './platform/mock.ts';
import { trimHistory } from './sessions.ts';
import { MemoryStore, SqliteStore } from './storage.ts';

type Streamed = OperatorEvent | { type: 'session'; sessionId: string };

function parseSse(body: string): Streamed[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.includes('data: '))
    .map((chunk) => JSON.parse(chunk.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as Streamed);
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout waiting for ${label}`);
}

const LONG_REQUEST = 'Busca a Laura Pérez, abre expediente de residencia, crea una tarea para extranjería y mándale un correo pidiendo documentación';

describe('Vex Core HTTP', () => {
  let app: FastifyInstance;
  let token: string;
  let store: MemoryStore;
  let platform: MockPlatform;

  async function start(extra: Partial<AppOptions> = {}) {
    if (app) await app.close();
    store = new MemoryStore();
    platform = new MockPlatform(() => new Date('2026-10-23T10:00:00.000Z'));
    app = buildApp({ provider: new ScriptedProvider(), platform, store, confirmTimeoutMs: 5000, ...extra });
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-cesar' } });
    token = (login.json() as { token: string }).token;
  }

  const chat = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/operator/chat', headers: { authorization: `Bearer ${token}` }, payload });
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
  const parkedOnConfirmation = () => store.auditEntries.some((e) => e.tool === 'redactar_correo' && e.outcome === 'ok');

  beforeEach(async () => {
    await start();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects requests without a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/operator/chat', payload: { message: 'hola' } });
    expect(res.statusCode).toBe(401);
  });

  it('streams the events of a read-only run and audits it', async () => {
    const res = await chat({ message: 'Busca a Laura', context: { pantalla: 'contactos' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.body);
    expect(events[0]).toMatchObject({ type: 'session' });
    expect(events.find((e) => e.type === 'tool_call')).toMatchObject({ action: { tool: 'buscar', params: { consulta: 'Laura', tipo: 'contactos' } } });
    expect(events.at(-1)).toMatchObject({ type: 'done', reply: 'He encontrado a Laura Pérez (laura.perez@ejemplo.es).' });
    expect(store.auditEntries).toHaveLength(1);
    expect(store.auditEntries[0]).toMatchObject({ tool: 'buscar', outcome: 'ok', principal: { id: 'u-cesar' } });
  });

  it('pauses on the irreversible step showing the real draft, then sends it once approved', async () => {
    const run = chat({ sessionId: 's-mail', message: LONG_REQUEST });
    await waitFor(parkedOnConfirmation, 'confirmation');
    await new Promise((r) => setTimeout(r, 20));
    const confirm = await post('/operator/confirm', { sessionId: 's-mail', actionId: 'call_5_enviar_correo', approved: true });
    expect(confirm.statusCode).toBe(200);

    const events = parseSse((await run).body);
    const confirmEvent = events.find((e) => e.type === 'confirm');
    expect(confirmEvent).toMatchObject({
      action: { tool: 'enviar_correo', risk: 'irreversible', details: { para: 'laura.perez@ejemplo.es', asunto: expect.stringContaining('Pedir documentación') } },
    });
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect((events.at(-1) as { reply: string }).reply).toContain('Correo enviado a laura.perez@ejemplo.es');
    expect(await platform.correos()).toHaveLength(1);
    expect(store.auditEntries.map((e) => `${e.tool}:${e.outcome}`)).toEqual(['buscar:ok', 'crear_expediente:ok', 'crear_tarea:ok', 'redactar_correo:ok', 'enviar_correo:ok']);
    expect(store.auditEntries.at(-1)?.details).toMatchObject({ para: 'laura.perez@ejemplo.es' });
  });

  it('treats a rejected confirmation as a stop, without sending', async () => {
    const run = chat({ sessionId: 's-no', message: 'Mándale un correo a Laura con el presupuesto' });
    await waitFor(parkedOnConfirmation, 'confirmation');
    await new Promise((r) => setTimeout(r, 20));
    await post('/operator/confirm', { sessionId: 's-no', actionId: 'call_3_enviar_correo', approved: false });
    const events = parseSse((await run).body);
    expect(events.find((e) => e.type === 'tool_result' && e.outcome === 'rejected')).toBeDefined();
    expect(await platform.correos()).toHaveLength(0);
    expect((events.at(-1) as { reply: string }).reply).toContain('Me he detenido');
  });

  it('stops a run on request: nothing is sent and the stream ends with cancelled', async () => {
    const run = chat({ sessionId: 's-stop', message: LONG_REQUEST });
    await waitFor(parkedOnConfirmation, 'confirmation');
    const stop = await post('/operator/stop', { sessionId: 's-stop' });
    expect(stop.json()).toEqual({ stopped: true });
    const events = parseSse((await run).body);
    expect(events.at(-1)).toEqual({ type: 'cancelled' });
    expect(await platform.correos()).toHaveLength(0);
    expect(store.auditEntries.at(-1)).toMatchObject({ tool: 'enviar_correo', outcome: 'cancelled' });
    // The conversation stays usable after a stop.
    const next = parseSse((await chat({ sessionId: 's-stop', message: 'Busca a Marco' })).body);
    expect(next.at(-1)).toMatchObject({ type: 'done' });
    expect((await post('/operator/stop', { sessionId: 's-stop' })).json()).toEqual({ stopped: false });
  });

  it('limits messages per user', async () => {
    await start({ rateLimit: { messages: 2, windowMs: 60_000 } });
    expect((await chat({ message: 'Busca a Laura' })).statusCode).toBe(200);
    expect((await chat({ message: 'Busca a Marco' })).statusCode).toBe(200);
    const third = await chat({ message: 'Busca a Aisha' });
    expect(third.statusCode).toBe(429);
  });

  it('keeps the model proxy off unless enabled', async () => {
    const payload = { system: '', messages: [{ role: 'user', content: [{ type: 'text', text: 'Busca a Laura' }] }], tools: [{ name: 'buscar', description: '', inputSchema: {} }] };
    expect((await app.inject({ method: 'POST', url: '/provider/complete', payload })).statusCode).toBe(404);
    await start({ enableProviderProxy: true });
    const res = await app.inject({ method: 'POST', url: '/provider/complete', payload });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ stopReason: 'tool_use', content: [{ type: 'tool_use', name: 'buscar' }] });
  });

  it('exposes the audit filtered by user and the operator info', async () => {
    const info = await app.inject({ method: 'GET', url: '/operator/info' });
    expect(info.json()).toMatchObject({ provider: 'scripted', providerProxy: false, tools: expect.arrayContaining([expect.objectContaining({ name: 'enviar_correo', risk: 'irreversible' })]) });
    const other = await app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-ana' } });
    const otherToken = (other.json() as { token: string }).token;
    await chat({ message: 'Busca a Marco' });
    const mine = await app.inject({ method: 'GET', url: '/operator/audit', headers: { authorization: `Bearer ${token}` } });
    const theirs = await app.inject({ method: 'GET', url: '/operator/audit', headers: { authorization: `Bearer ${otherToken}` } });
    expect((mine.json() as unknown[]).length).toBe(1);
    expect((theirs.json() as unknown[]).length).toBe(0);
  });
});

describe('persistence with SQLite', () => {
  /** Counts how many messages the model receives, to prove the history came back. */
  class Spy implements ModelProvider {
    readonly name = 'spy';
    readonly sizes: number[] = [];
    private readonly inner = new ScriptedProvider();
    async complete(req: CompletionRequest) {
      this.sizes.push(req.messages.length);
      return this.inner.complete(req);
    }
  }

  it('keeps audit and conversations across restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vex-db-'));
    const file = join(dir, 'vex.db');
    try {
      const first = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(), store: new SqliteStore(file) });
      await first.ready();
      const login = await first.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-cesar' } });
      const token = (login.json() as { token: string }).token;
      const auth = { authorization: `Bearer ${token}` };
      await first.inject({ method: 'POST', url: '/operator/chat', headers: auth, payload: { sessionId: 's-persist', message: 'Busca a Laura' } });
      await first.close();

      const spy = new Spy();
      const second = buildApp({ provider: spy, platform: new MockPlatform(), store: new SqliteStore(file) });
      await second.ready();
      const audit = await second.inject({ method: 'GET', url: '/operator/audit?sessionId=s-persist', headers: auth });
      expect(audit.json()).toEqual([expect.objectContaining({ tool: 'buscar', outcome: 'ok', sessionId: 's-persist' })]);
      await second.inject({ method: 'POST', url: '/operator/chat', headers: auth, payload: { sessionId: 's-persist', message: 'Busca a Marco' } });
      // 4 messages from the first run + the new user message.
      expect(spy.sizes[0]).toBe(5);

      // Another user cannot take over the stored conversation.
      const ana = await second.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-ana' } });
      const anaToken = (ana.json() as { token: string }).token;
      const stolen = await second.inject({ method: 'POST', url: '/operator/chat', headers: { authorization: `Bearer ${anaToken}` }, payload: { sessionId: 's-persist', message: 'hola' } });
      expect(stolen.statusCode).toBe(403);
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('trimHistory', () => {
  const user = (t: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text: t }] });
  const call = (id: string) => ({ role: 'assistant' as const, content: [{ type: 'tool_use' as const, id, name: 'buscar', input: {} }] });
  const result = (id: string) => ({ role: 'user' as const, content: [{ type: 'tool_result' as const, toolUseId: id, content: '{}' }] });

  it('cuts only before a user text message, never between a tool call and its result', () => {
    const history = [user('a'), call('1'), result('1'), user('b'), call('2'), result('2'), user('c')];
    expect(trimHistory(history, 10)).toBe(history);
    expect(trimHistory(history, 4)).toEqual([user('b'), call('2'), result('2'), user('c')]);
    expect(trimHistory(history, 3)).toEqual([user('c')]);
  });
});
