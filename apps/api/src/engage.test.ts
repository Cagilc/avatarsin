import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ScriptedProvider, type Completion, type CompletionRequest, type HostManifest, type HostManifestInput, type ModelProvider, type OperatorEvent } from '@vex/operator';
import { createCitasApp } from '@vex/sample-tools';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from './app.ts';
import { parseHostManifest } from './host.ts';
import { MockPlatform } from './platform/mock.ts';
import { MemoryStore } from './storage.ts';

type Streamed = OperatorEvent | { type: 'session'; sessionId: string };
function parseSse(body: string): Streamed[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.includes('data: '))
    .map((chunk) => JSON.parse(chunk.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as Streamed);
}

/** Answers with text and keeps what it was asked. */
class Spy implements ModelProvider {
  readonly name = 'spy';
  readonly requests: CompletionRequest[] = [];
  async complete(req: CompletionRequest): Promise<Completion> {
    // The loop appends to the same history array afterwards: keep what was asked.
    this.requests.push({ ...req, messages: structuredClone(req.messages) });
    return { content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn' };
  }
}

const LOCAL = { allowHttp: true, allowInternal: true };

function manifestWith(citasUrl: string, over: Partial<HostManifestInput> = {}): HostManifest {
  return parseHostManifest(
    JSON.stringify({
      format: 'vex-host',
      version: 1,
      host: { name: 'Demo', domain: 'demo.example' },
      features: { announcements: true, quickActions: true },
      policy: { allow: ['platform:*', 'api:*', 'mcp:*'], deny: ['enviar_correo'], confirm: ['irreversible'] },
      connectors: [{ id: 'citas', name: 'Agenda', source: { kind: 'openapi', url: `${citasUrl}/openapi.json` }, baseUrl: citasUrl }],
      quickActions: [
        { id: 'buscar-laura', label: 'Buscar a Laura', tool: 'buscar', params: { consulta: 'Laura Pérez', tipo: 'contactos' } },
        { id: 'tarea-admin', label: 'Tarea de revisión', roles: ['admin'], tool: 'crear_tarea', params: { titulo: 'Revisar expedientes', equipo: 'administracion', expedienteId: null } },
        { id: 'novedades', label: '¿Qué hay de nuevo?', prompt: '¿Qué hay de nuevo?' },
        { id: 'denegado', label: 'Enviar correo', tool: 'enviar_correo', params: { borradorId: 'b-1' } },
        { id: 'recordatorio', label: 'Recordar cita', tool: 'citas_enviar_recordatorio', params: { id: 'CITA-101', body: { canal: 'sms' } } },
      ],
      announcements: [
        { id: 'bienvenida', title: 'Vex ya opera aquí', body: 'Pídeme cosas con tus propias palabras.', cta: { kind: 'quickAction', id: 'buscar-laura' } },
        { id: 'solo-admins', title: 'Para administradores', body: 'Revisa los conectores.', roles: ['admin'] },
        { id: 'caducado', title: 'Viejo', body: 'Ya no.', until: '2020-01-01T00:00:00.000Z' },
        { id: 'futuro', title: 'Pronto', body: 'Todavía no.', since: '2999-01-01T00:00:00.000Z' },
      ],
      ...over,
    }),
    'test',
  );
}

describe('announcements and quick actions in Vex Core', () => {
  let app: FastifyInstance | undefined;
  let store: MemoryStore;
  let citasBase: string;
  let citas: ReturnType<typeof createCitasApp>;

  beforeAll(async () => {
    citas = createCitasApp({ baseUrl: 'http://127.0.0.1:0' });
    await citas.listen({ port: 0, host: '127.0.0.1' });
    citasBase = `http://127.0.0.1:${(citas.server.address() as AddressInfo).port}`;
    return async () => {
      await citas.close();
    };
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(extra: Partial<AppOptions> = {}) {
    store = new MemoryStore();
    app = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(), store, demoLogin: true, confirmTimeoutMs: 5000, connectors: { urlPolicy: LOCAL }, ...extra });
    await app.ready();
  }
  const login = async (userId: string) => ({ authorization: `Bearer ${((await app!.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId } })).json() as { token: string }).token}` });
  const get = async (url: string, headers: Record<string, string>) => app!.inject({ method: 'GET', url, headers });
  const post = async (url: string, headers: Record<string, string>, payload: Record<string, unknown> = {}) => app!.inject({ method: 'POST', url, headers, payload });
  const approveCitas = async (admin: Record<string, string>) => {
    const list = (await get('/connectors', admin)).json() as Array<{ id: string; tools: Array<{ name: string; suggestedRisk: string }> }>;
    const tools = list.find((c) => c.id === 'citas')!.tools;
    expect((await post('/connectors/citas/review', admin, { decisions: tools.map((t) => ({ name: t.name, risk: t.suggestedRisk, enabled: true })) })).statusCode).toBe(200);
  };

  it('with the features off nothing shows and the routes answer empty', async () => {
    await start({ manifest: manifestWith(citasBase, { features: {} }) });
    const ana = await login('u-ana');
    expect((await get('/engage/announcements', ana)).json()).toEqual([]);
    expect((await get('/engage/quick-actions', ana)).json()).toEqual([]);
    expect((await post('/engage/quick-actions/buscar-laura/run', ana)).statusCode).toBe(404);
    expect((await post('/engage/announcements/bienvenida/seen', ana)).statusCode).toBe(404);
  });

  it('shows each person the announcements of their role and the moment, once', async () => {
    await start({ manifest: manifestWith(citasBase) });
    const ana = await login('u-ana');
    const first = (await get('/engage/announcements', ana)).json() as Array<{ id: string; seen: boolean; body: string }>;
    expect(first.map((a) => `${a.id}:${a.seen}`)).toEqual(['bienvenida:false']);
    expect((await post('/engage/announcements/bienvenida/seen', ana)).statusCode).toBe(200);
    expect(((await get('/engage/announcements', ana)).json() as Array<{ seen: boolean }>).map((a) => a.seen)).toEqual([true]);
    // Not hers to see: nothing to mark.
    expect((await post('/engage/announcements/solo-admins/seen', ana)).statusCode).toBe(404);
    const cesar = await login('u-cesar');
    expect(((await get('/engage/announcements', cesar)).json() as Array<{ id: string }>).map((a) => a.id)).toEqual(['bienvenida', 'solo-admins']);
    expect((await get('/engage/announcements', {})).statusCode).toBe(401);
  });

  it('offers only the buttons of the role whose tool the loop would run', async () => {
    await start({ manifest: manifestWith(citasBase) });
    const ana = await login('u-ana');
    // No admin button, no denied tool, no connector tool before its review.
    expect(((await get('/engage/quick-actions', ana)).json() as Array<{ id: string }>).map((q) => q.id)).toEqual(['buscar-laura', 'novedades']);
    const cesar = await login('u-cesar');
    expect(((await get('/engage/quick-actions', cesar)).json() as Array<{ id: string }>).map((q) => q.id)).toEqual(['buscar-laura', 'tarea-admin', 'novedades']);
    await approveCitas(cesar);
    expect(((await get('/engage/quick-actions', ana)).json() as Array<{ id: string }>).map((q) => q.id)).toEqual(['buscar-laura', 'novedades', 'recordatorio']);
  });

  it('a tool button runs through the operator loop: events, audit, and a conversation that goes on', async () => {
    await start({ manifest: manifestWith(citasBase) });
    const ana = await login('u-ana');
    const res = await post('/engage/quick-actions/buscar-laura/run', ana, { context: { pantalla: 'inicio' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.body);
    const sessionId = (events.find((e) => e.type === 'session') as { sessionId: string }).sessionId;
    expect(events.find((e) => e.type === 'tool_call')).toMatchObject({ action: { tool: 'buscar', params: { consulta: 'Laura Pérez', tipo: 'contactos' }, summary: 'Buscar "Laura Pérez" en contactos' } });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ outcome: 'ok' });
    expect(events.at(-1)).toMatchObject({ type: 'done', reply: expect.stringContaining('Hecho (Buscar a Laura)') });
    expect((events.at(-1) as { reply: string }).reply).toContain('laura.perez@ejemplo.es');
    const audit = store.auditEntries.filter((e) => e.sessionId === sessionId);
    expect(audit.map((e) => `${e.tool}:${e.outcome}:${e.principal.id}`)).toEqual(['buscar:ok:u-ana']);
    // The same session carries on by chat: the history the button left is a valid conversation.
    const next = await post('/operator/chat', ana, { sessionId, message: '¿Quién es Marco Rossi?' });
    expect(next.statusCode).toBe(200);
    expect(parseSse(next.body).at(-1)).toMatchObject({ type: 'done' });
    expect((await post('/engage/quick-actions/tarea-admin/run', ana)).statusCode).toBe(404);
  });

  it('a prompt button is a message, and the prompt knows the news', async () => {
    const spy = new Spy();
    await start({ provider: spy, manifest: manifestWith(citasBase) });
    const ana = await login('u-ana');
    expect((await post('/engage/quick-actions/novedades/run', ana)).statusCode).toBe(200);
    const req = spy.requests[0]!;
    expect(req.messages.at(-1)?.content).toEqual([{ type: 'text', text: '¿Qué hay de nuevo?' }]);
    expect(req.system).toContain('Novedades de la plataforma');
    expect(req.system).toContain('Vex ya opera aquí: Pídeme cosas con tus propias palabras.');
    expect(req.system).not.toContain('Para administradores');
  });

  it('a button the policy denies never runs: 403 and a denied line in the audit', async () => {
    await start({ manifest: manifestWith(citasBase) });
    const ana = await login('u-ana');
    const res = await post('/engage/quick-actions/denegado/run', ana);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'La política no permite enviar_correo.' });
    expect(store.auditEntries.filter((e) => e.principal.id === 'u-ana').map((e) => `${e.tool}:${e.outcome}:${e.summary}`)).toEqual(['enviar_correo:denied:Botón «Enviar correo»']);
  });

  it('an irreversible button stops for the confirmation with the real request, like the model would', async () => {
    await start({ manifest: manifestWith(citasBase) });
    const cesar = await login('u-cesar');
    await approveCitas(cesar);
    const ana = await login('u-ana');
    const run = post('/engage/quick-actions/recordatorio/run', ana, { sessionId: 's-recordatorio' });
    // Reject as soon as the loop is parked on the card (the direct call's id is predictable).
    let decided = 404;
    for (let i = 0; i < 300 && decided === 404; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      decided = (await post('/operator/confirm', ana, { sessionId: 's-recordatorio', actionId: 'direct_citas_enviar_recordatorio', approved: false })).statusCode;
    }
    expect(decided).toBe(200);
    const events = parseSse((await run).body);
    const confirm = events.find((e) => e.type === 'confirm') as { action: { tool: string; details?: Record<string, unknown> } } | undefined;
    expect(confirm?.action.tool).toBe('citas_enviar_recordatorio');
    expect(confirm?.action.details).toMatchObject({ metodo: 'POST', url: expect.stringContaining('/citas/CITA-101/recordatorio') });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ outcome: 'rejected' });
  });

  it('a connector approval drafts an announcement nobody sees until an administrator publishes it', async () => {
    await start({ manifest: manifestWith(citasBase) });
    const cesar = await login('u-cesar');
    const ana = await login('u-ana');
    expect((await get('/engage/drafts', ana)).statusCode).toBe(403);
    expect((await get('/engage/drafts', cesar)).json()).toEqual([]);
    await approveCitas(cesar);
    const drafts = (await get('/engage/drafts', cesar)).json() as Array<{ id: string; status: string; source: string; title: string; body: string; connector: string }>;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ status: 'draft', source: 'connector', connector: 'citas', title: 'Novedad: Agenda' });
    expect(drafts[0]!.body).toContain('citas_listar_huecos');
    expect(((await get('/engage/announcements', ana)).json() as Array<{ id: string }>).map((a) => a.id)).toEqual(['bienvenida']);
    // Approving again with nothing new drafts nothing more.
    await approveCitas(cesar);
    expect((await get('/engage/drafts', cesar)).json()).toHaveLength(1);

    const id = drafts[0]!.id;
    expect((await post(`/engage/announcements/${id}/publish`, ana, { title: 'x' })).statusCode).toBe(403);
    const published = (await post(`/engage/announcements/${id}/publish`, cesar, { title: 'Citas desde Vex' })).json() as { status: string; title: string; since: string };
    expect(published).toMatchObject({ status: 'published', title: 'Citas desde Vex' });
    expect(((await get('/engage/announcements', ana)).json() as Array<{ id: string; title: string }>).map((a) => a.title)).toEqual(['Vex ya opera aquí', 'Citas desde Vex']);
    expect((await get('/engage/drafts', cesar)).json()).toEqual([]);
    expect((await app!.inject({ method: 'DELETE', url: `/engage/announcements/${id}`, headers: cesar })).statusCode).toBe(200);
    expect(((await get('/engage/announcements', ana)).json() as Array<{ id: string }>).map((a) => a.id)).toEqual(['bienvenida']);
    expect((await app!.inject({ method: 'DELETE', url: '/engage/announcements/bienvenida', headers: cesar })).statusCode).toBe(404);
  });
});
