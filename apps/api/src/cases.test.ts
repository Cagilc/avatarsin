import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScriptedProvider, type AuditEntry, type OperatorEvent } from '@vex/operator';
import type { FastifyInstance } from 'fastify';
import { loadLocalCases } from '../evals/cases.ts';
import { buildApp, type AppOptions } from './app.ts';
import { anonymizeCase, caseFromSession, evalCaseJsonSchema, sessionTurns } from './cases.ts';
import { MockPlatform } from './platform/mock.ts';
import { MemoryStore, type StoredSession } from './storage.ts';

const ANA = { id: 'u-ana', name: 'Ana Ruiz', role: 'gestora' };

/** Two turns: a search that found nobody, then a draft and a sent e-mail with the screen context. */
function session(): StoredSession {
  return {
    id: 's-real',
    principal: ANA,
    history: [
      { role: 'user', content: [{ type: 'text', text: 'Busca a Nadie Pérez' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1_buscar', name: 'buscar', input: { consulta: 'Nadie Pérez', tipo: 'todo' } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_1_buscar', content: '{"resultados":[]}' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'No encuentro a nadie.' }] },
      { role: 'user', content: [{ type: 'text', text: '[Contexto de pantalla] {"pantalla":"contacto","contactoId":"c-002","contactoEmail":"marco.rossi@ejemplo.it"}\n\nMándale el presupuesto a este cliente' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_2_redactar', name: 'redactar_correo', input: { para: 'marco.rossi@ejemplo.it', proposito: 'enviar el presupuesto', expedienteId: null } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_2_redactar', content: '{"id":"b-1"}' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_3_enviar', name: 'enviar_correo', input: { borradorId: 'b-1' } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_3_enviar', content: 'ERROR (rejected): Rechazado por el usuario.', isError: true }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Me he detenido.' }] },
    ],
  };
}

function audit(): AuditEntry[] {
  const base = { ts: '2026-10-26T10:00:00.000Z', sessionId: 's-real', principal: ANA, driver: 'platform' as const, durationMs: 5 };
  return [
    { ...base, actionId: 'call_1_buscar', tool: 'buscar', risk: 'read', params: { consulta: 'Nadie Pérez', tipo: 'todo' }, summary: 'Buscar', outcome: 'ok' },
    { ...base, actionId: 'call_2_redactar', tool: 'redactar_correo', risk: 'write', params: { para: 'marco.rossi@ejemplo.it', proposito: 'enviar el presupuesto', expedienteId: null }, summary: 'Redactar', outcome: 'ok' },
    { ...base, actionId: 'call_3_enviar', tool: 'enviar_correo', risk: 'irreversible', params: { borradorId: 'b-1' }, summary: 'Enviar', details: { para: 'marco.rossi@ejemplo.it', asunto: 'Presupuesto', cuerpo: 'Hola' }, outcome: 'rejected', error: 'Rechazado por el usuario.' },
  ];
}

describe('from a session to a case', () => {
  it('splits the conversation into turns with their context and tool uses', () => {
    const turns = sessionTurns(session().history);
    expect(turns.map((t) => [t.index, t.request, t.toolUses.map((u) => u.name)])).toEqual([
      [1, 'Busca a Nadie Pérez', ['buscar']],
      [2, 'Mándale el presupuesto a este cliente', ['redactar_correo', 'enviar_correo']],
    ]);
    expect(turns[1]?.context).toEqual({ pantalla: 'contacto', contactoId: 'c-002', contactoEmail: 'marco.rossi@ejemplo.it' });
    expect(turns[1]?.outcomes.get('call_3_enviar')).toBe('rejected');
  });

  it('drafts the last turn by default: what ran, what was refused, who it was for', () => {
    const c = caseFromSession({ session: session(), audit: audit(), now: new Date('2026-10-26T12:00:00Z') });
    expect(c).toEqual({
      id: 'sesion-sreal-t2',
      category: 'flujo',
      request: 'Mándale el presupuesto a este cliente',
      context: { pantalla: 'contacto', contactoId: 'c-002', contactoEmail: 'marco.rossi@ejemplo.it' },
      user: 'u-ana',
      confirm: 'reject',
      expect: { calls: ['redactar_correo'], auditPrincipal: 'u-ana', maxToolCalls: 4, forbidden: ['enviar_correo'], sent: 0 },
      scripted: 'skip',
      note: 'Exportado de la sesión s-real, turno 2, el 2026-10-26. Revisa las expectativas antes de darlo por bueno.',
    });
    const first = caseFromSession({ session: session(), audit: audit(), turn: 1 });
    expect(first.expect).toEqual({ calls: ['buscar'], auditPrincipal: 'u-ana', maxToolCalls: 3 });
    expect(first.context).toBeUndefined();
    expect(() => caseFromSession({ session: session(), audit: audit(), turn: 3 })).toThrow(/turno 3/);
  });

  it('masks e-mails and phones the same way everywhere when asked', () => {
    const c = anonymizeCase({ id: 'x-1', category: 'flujo', request: 'Escribe a laura.perez@ejemplo.es y llama al +34 600 11 22 33; copia a LAURA.PEREZ@ejemplo.es y a pepe@otro.org', context: { contactoEmail: 'laura.perez@ejemplo.es' }, expect: { sentTo: ['laura.perez@ejemplo.es', 'pepe@otro.org'] } });
    expect(c.request).toBe('Escribe a persona1@ejemplo.test y llama al 600000000; copia a persona1@ejemplo.test y a persona2@ejemplo.test');
    expect(c.context).toEqual({ contactoEmail: 'persona1@ejemplo.test' });
    expect(c.expect.sentTo).toEqual(['persona1@ejemplo.test', 'persona2@ejemplo.test']);
    expect(caseFromSession({ session: session(), audit: audit(), anonymize: true }).context?.['contactoEmail']).toBe('persona1@ejemplo.test');
  });

  it('the JSON shape is strict and the local file loads only what validates', () => {
    expect(evalCaseJsonSchema.safeParse({ id: 'ok-1', category: 'flujo', request: 'x', expect: {}, setup: 'nope' }).success).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'vex-cases-'));
    try {
      const path = join(dir, 'cases.local.json');
      expect(loadLocalCases(path)).toEqual([]);
      writeFileSync(path, JSON.stringify([{ id: 'local-1', category: 'lenguaje', request: 'Hola', expect: { calls: [] }, scripted: 'skip' }]));
      expect(loadLocalCases(path).map((c) => c.id)).toEqual(['local-1']);
      writeFileSync(path, JSON.stringify([{ id: 'MAL', category: 'flujo', request: 'x', expect: {} }]));
      expect(() => loadLocalCases(path)).toThrow(/0\.id/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

type Streamed = OperatorEvent | { type: 'session'; sessionId: string };
function parseSse(body: string): Streamed[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.includes('data: '))
    .map((chunk) => JSON.parse(chunk.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as Streamed);
}

describe('sessions, feedback and cases over HTTP', () => {
  let app: FastifyInstance | undefined;
  let store: MemoryStore;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  async function start(extra: Partial<AppOptions> = {}) {
    store = new MemoryStore();
    app = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(() => new Date('2026-10-23T10:00:00.000Z')), store, demoLogin: true, confirmTimeoutMs: 5000, ...extra });
    await app.ready();
  }
  const login = async (userId: string) => ({ authorization: `Bearer ${((await app!.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId } })).json() as { token: string }).token}` });
  const post = (url: string, headers: Record<string, string>, payload: Record<string, unknown>) => app!.inject({ method: 'POST', url, headers, payload });

  it('exports a real run as a case an administrator can keep, and takes a thumbs down with its reason', async () => {
    await start();
    const cesar = await login('u-cesar');
    const run = post('/operator/chat', cesar, { sessionId: 's-exp', message: 'Busca a Laura Pérez, abre expediente de residencia, crea una tarea para extranjería y mándale un correo pidiendo documentación', context: { pantalla: 'inicio' } });
    let decided = 404;
    for (let i = 0; i < 300 && decided === 404; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      decided = (await post('/operator/confirm', cesar, { sessionId: 's-exp', actionId: 'call_5_enviar_correo', approved: true })).statusCode;
    }
    expect(parseSse((await run).body).at(-1)).toMatchObject({ type: 'done' });

    const ana = await login('u-ana');
    expect((await app!.inject({ method: 'GET', url: '/admin/sessions', headers: ana })).statusCode).toBe(403);
    expect((await post('/operator/feedback', ana, { sessionId: 's-exp', turn: 1, verdict: 'down' })).statusCode).toBe(404);
    expect((await post('/operator/feedback', cesar, { sessionId: 's-exp', turn: 1, verdict: 'down', reason: 'El asunto del correo era pobre.' })).statusCode).toBe(200);
    const list = (await app!.inject({ method: 'GET', url: '/admin/sessions', headers: cesar })).json() as Array<{ id: string; turns: number; feedback: { up: number; down: number; reasons: Array<{ reason: string }> } }>;
    expect(list.map((s) => [s.id, s.turns, s.feedback.down])).toEqual([['s-exp', 1, 1]]);
    expect(list[0]!.feedback.reasons[0]?.reason).toBe('El asunto del correo era pobre.');

    const c = (await app!.inject({ method: 'GET', url: '/admin/sessions/s-exp/case', headers: cesar })).json() as { id: string; request: string; context: unknown; user: string; expect: Record<string, unknown>; scripted: string };
    expect(c.id).toBe('sesion-sexp-t1');
    expect(c.user).toBe('u-cesar');
    expect(c.context).toEqual({ pantalla: 'inicio' });
    expect(c.scripted).toBe('skip');
    expect(c.expect).toMatchObject({
      calls: ['buscar', 'crear_expediente', 'crear_tarea', 'redactar_correo', 'enviar_correo'],
      sent: 1,
      sentTo: ['laura.perez@ejemplo.es'],
      expedientes: [{ contactoId: expect.stringMatching(/^c-/), tipo: expect.stringMatching(/residencia/i) }],
      tareas: [{ equipo: 'extranjeria', expedienteId: expect.stringMatching(/^EXP-/) }],
      auditPrincipal: 'u-cesar',
      maxToolCalls: 7,
    });
    const masked = (await app!.inject({ method: 'GET', url: '/admin/sessions/s-exp/case?anonymize=1', headers: cesar })).json() as { expect: { sentTo: string[] } };
    expect(masked.expect.sentTo).toEqual(['persona1@ejemplo.test']);
    expect((await app!.inject({ method: 'GET', url: '/admin/sessions/s-exp/case?turn=2', headers: cesar })).statusCode).toBe(400);
    expect((await app!.inject({ method: 'GET', url: '/admin/sessions/nadie/case', headers: cesar })).statusCode).toBe(404);
  });
});
