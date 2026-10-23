import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScriptedProvider, type OperatorEvent } from '@vex/operator';
import { buildApp } from './app.ts';
import { AuditLog } from './audit.ts';
import { MockPlatform } from './platform/mock.ts';
import type { FastifyInstance } from 'fastify';

function parseSse(body: string): Array<OperatorEvent | { type: 'session'; sessionId: string }> {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.includes('data: '))
    .map((chunk) => JSON.parse(chunk.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
}

describe('Vex Core HTTP', () => {
  let app: FastifyInstance;
  let token: string;
  let audit: AuditLog;

  beforeEach(async () => {
    audit = new AuditLog(null);
    app = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(() => new Date('2026-10-23T10:00:00.000Z')), audit, confirmTimeoutMs: 2000 });
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-cesar' } });
    token = (login.json() as { token: string }).token;
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects requests without a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/operator/chat', payload: { message: 'hola' } });
    expect(res.statusCode).toBe(401);
  });

  it('streams the events of a read-only run and audits it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/operator/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'Busca a Laura', context: { pantalla: 'contactos' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.body);
    expect(events[0]).toMatchObject({ type: 'session' });
    expect(events.find((e) => e.type === 'tool_call')).toMatchObject({ action: { tool: 'buscar', params: { consulta: 'Laura', tipo: 'contactos' } } });
    expect(events.at(-1)).toMatchObject({ type: 'done', reply: 'He encontrado a Laura Pérez (laura.perez@ejemplo.es).' });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ tool: 'buscar', outcome: 'ok', principal: { id: 'u-cesar' } });
  });

  it('pauses on the irreversible step until the user confirms, then sends the email', async () => {
    const platform = new MockPlatform();
    audit = new AuditLog(null);
    await app.close();
    app = buildApp({ provider: new ScriptedProvider(), platform, audit, confirmTimeoutMs: 5000 });
    await app.ready();

    const run = app.inject({
      method: 'POST',
      url: '/operator/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: 's-mail', message: 'Busca a Laura Pérez, abre expediente de residencia, crea una tarea para extranjería y mándale un correo pidiendo documentación' },
    });

    // Wait until the loop is parked on the confirmation.
    let pendingId: string | undefined;
    for (let i = 0; i < 50 && !pendingId; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      const log = audit.entries;
      if (log.some((e) => e.tool === 'redactar_correo' && e.outcome === 'ok')) {
        // The runner emits confirm right after redactar_correo; give it a tick, then confirm the known id.
        await new Promise((r) => setTimeout(r, 20));
        pendingId = 'call_5_enviar_correo';
      }
    }
    expect(pendingId).toBeDefined();
    const confirm = await app.inject({
      method: 'POST',
      url: '/operator/confirm',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: 's-mail', actionId: pendingId, approved: true },
    });
    expect(confirm.statusCode).toBe(200);

    const res = await run;
    const events = parseSse(res.body);
    const confirmEvent = events.find((e) => e.type === 'confirm');
    expect(confirmEvent).toMatchObject({ action: { tool: 'enviar_correo', risk: 'irreversible' } });
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect((events.at(-1) as { reply: string }).reply).toContain('Correo enviado a laura.perez@ejemplo.es');
    expect(await platform.correos()).toHaveLength(1);
    expect(audit.entries.map((e) => `${e.tool}:${e.outcome}`)).toEqual([
      'buscar:ok',
      'crear_expediente:ok',
      'crear_tarea:ok',
      'redactar_correo:ok',
      'enviar_correo:ok',
    ]);
  });

  it('treats a rejected confirmation as a stop, without sending', async () => {
    const platform = new MockPlatform();
    await app.close();
    app = buildApp({ provider: new ScriptedProvider(), platform, audit, confirmTimeoutMs: 5000 });
    await app.ready();
    const run = app.inject({
      method: 'POST',
      url: '/operator/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: 's-no', message: 'Mándale un correo a Laura con el presupuesto' },
    });
    for (let i = 0; i < 50; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      if (audit.entries.some((e) => e.tool === 'redactar_correo')) break;
    }
    await new Promise((r) => setTimeout(r, 20));
    await app.inject({ method: 'POST', url: '/operator/confirm', headers: { authorization: `Bearer ${token}` }, payload: { sessionId: 's-no', actionId: 'call_3_enviar_correo', approved: false } });
    const events = parseSse((await run).body);
    expect(events.find((e) => e.type === 'tool_result' && e.outcome === 'rejected')).toBeDefined();
    expect(await platform.correos()).toHaveLength(0);
    expect((events.at(-1) as { reply: string }).reply).toContain('Me he detenido');
  });

  it('exposes the audit filtered by user and the operator info', async () => {
    const info = await app.inject({ method: 'GET', url: '/operator/info' });
    expect(info.json()).toMatchObject({ provider: 'scripted', tools: expect.arrayContaining([expect.objectContaining({ name: 'enviar_correo', risk: 'irreversible' })]) });
    const other = await app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-ana' } });
    const otherToken = (other.json() as { token: string }).token;
    await app.inject({ method: 'POST', url: '/operator/chat', headers: { authorization: `Bearer ${token}` }, payload: { message: 'Busca a Marco' } });
    const mine = await app.inject({ method: 'GET', url: '/operator/audit', headers: { authorization: `Bearer ${token}` } });
    const theirs = await app.inject({ method: 'GET', url: '/operator/audit', headers: { authorization: `Bearer ${otherToken}` } });
    expect((mine.json() as unknown[]).length).toBe(1);
    expect((theirs.json() as unknown[]).length).toBe(0);
  });
});
