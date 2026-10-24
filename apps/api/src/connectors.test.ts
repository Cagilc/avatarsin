import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NOTAS_MCP_SCRIPT, createCitasApp, citasOpenApi } from '@vex/sample-tools';
import { ScriptedProvider, type CompletionRequest, type ModelProvider, type OperatorEvent } from '@vex/operator';
import type { ConnectorManifest } from '@vex/connectors';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from './app.ts';
import { MockPlatform } from './platform/mock.ts';
import { MemoryStore, SqliteStore, type OperatorStore } from './storage.ts';

type Streamed = OperatorEvent | { type: 'session'; sessionId: string };

function parseSse(body: string): Streamed[] {
  return body
    .split('\n\n')
    .filter((c) => c.includes('data: '))
    .map((c) => JSON.parse(c.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as Streamed);
}

const TOKEN = 'token-de-la-agenda';
const citas = createCitasApp({ baseUrl: 'http://127.0.0.1:0', token: TOKEN });
let CITAS = '';

beforeAll(async () => {
  await citas.listen({ port: 0, host: '127.0.0.1' });
  const addr = citas.server.address();
  CITAS = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(async () => {
  await citas.close();
});

/** Remembers the system prompt and tools the model was given. */
class Spy implements ModelProvider {
  readonly name = 'scripted';
  last: CompletionRequest | null = null;
  private readonly inner = new ScriptedProvider();
  async complete(req: CompletionRequest) {
    this.last = req;
    return this.inner.complete(req);
  }
}

describe('connectors in Vex Core', () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let gestora: Record<string, string>;
  let spy: Spy;

  async function start(extra: Partial<AppOptions> = {}, store: OperatorStore = new MemoryStore()) {
    spy = new Spy();
    app = buildApp({ provider: spy, platform: new MockPlatform(), store, connectors: { env: { CITAS_TOKEN: TOKEN }, mcpAllow: ['node'] }, ...extra });
    await app.ready();
    const login = async (userId: string) => ({ authorization: `Bearer ${((await app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId } })).json() as { token: string }).token}` });
    admin = await login('u-cesar');
    gestora = await login('u-ana');
  }

  const importCitas = () =>
    app.inject({ method: 'POST', url: '/connectors/import/openapi', headers: admin, payload: { id: 'citas', url: `${CITAS}/openapi.json`, baseUrl: CITAS, auth: { kind: 'bearer', env: 'CITAS_TOKEN' } } });

  const approveCitas = (m: ConnectorManifest, guide = 'Reserva siempre un hueco que devuelva citas_listar_huecos. El recordatorio sale al cliente: confirma el canal.') =>
    app.inject({
      method: 'POST',
      url: '/connectors/citas/review',
      headers: admin,
      payload: { decisions: m.tools.map((t) => ({ name: t.name, risk: t.suggestedRisk, enabled: true })), guide },
    });

  const chat = (sessionId: string, message: string) => app.inject({ method: 'POST', url: '/operator/chat', headers: admin, payload: { sessionId, message } });
  const toolNames = async () => ((await app.inject({ method: 'GET', url: '/operator/info' })).json() as { tools: Array<{ name: string }> }).tools.map((t) => t.name);

  afterEach(async () => {
    await app?.close();
  });

  it('only administrators can connect tools', async () => {
    await start();
    expect((await app.inject({ method: 'GET', url: '/connectors', headers: gestora })).statusCode).toBe(403);
    const res = await app.inject({ method: 'POST', url: '/connectors/import/openapi', headers: gestora, payload: { id: 'citas', url: `${CITAS}/openapi.json` } });
    expect(res.statusCode).toBe(403);
  });

  it('imports an OpenAPI tool as a draft: nothing reaches Vex until a person reviews it', async () => {
    await start();
    const res = await importCitas();
    expect(res.statusCode).toBe(201);
    const m = res.json() as ConnectorManifest;
    expect(m.tools).toHaveLength(6);
    expect(m.tools.every((t) => !t.enabled && t.review === null)).toBe(true);
    expect((await toolNames()).some((n) => n.startsWith('citas_'))).toBe(false);
    expect((await importCitas()).statusCode).toBe(409);
  });

  it('refuses to lower a risk without a reason, then exposes what was approved', async () => {
    await start();
    const m = (await importCitas()).json() as ConnectorManifest;
    const lower = await app.inject({ method: 'POST', url: '/connectors/citas/review', headers: admin, payload: { decisions: [{ name: 'citas_cancelar_cita', risk: 'write', enabled: true }] } });
    expect(lower.statusCode).toBe(400);
    expect(lower.json()).toMatchObject({ error: expect.stringContaining('explica por qué') });

    const ok = await approveCitas(m);
    expect(ok.statusCode).toBe(200);
    expect(await toolNames()).toEqual(expect.arrayContaining(['citas_listar_huecos', 'citas_crear_cita', 'citas_enviar_recordatorio', 'leer_guia']));
    const audit = (await app.inject({ method: 'GET', url: '/operator/audit?sessionId=admin', headers: admin })).json() as Array<{ tool: string; summary: string }>;
    expect(audit.map((a) => a.tool)).toEqual(['importar_conector', 'revisar_conector']);
    expect(audit[1]?.summary).toBe('Revisar Agenda de citas: 6 activadas, 0 desactivadas');
  });

  it('uses an approved connector from the chat, asking first for the irreversible step', async () => {
    await start();
    await approveCitas((await importCitas()).json() as ConnectorManifest);

    const crear = parseSse(
      (await chat('s-citas', `usa citas_crear_cita {"body":{"cliente":"Laura Pérez","email":"laura.perez@ejemplo.es","inicio":"2026-10-27T11:00:00+01:00","motivo":"Entrega de documentación"}}`)).body,
    );
    expect(crear.find((e) => e.type === 'confirm')).toBeUndefined();
    expect(crear.at(-1)).toMatchObject({ type: 'done', reply: expect.stringContaining('Hecho (citas_crear_cita)') });
    const cita = citas.estado().citas.at(-1)!;
    expect(cita).toMatchObject({ cliente: 'Laura Pérez', estado: 'confirmada' });

    // The system prompt lists the connector and tells the model to read its guide first.
    expect(spy.last?.system).toContain('- citas: Agenda de citas');
    expect(spy.last?.system).toContain('leer_guia');

    const sent = citas.estado().recordatorios.length;
    const run = chat('s-citas', `usa citas_enviar_recordatorio {"id":"${cita.id}","body":{"canal":"sms"}}`);
    let confirmed = 404;
    for (let i = 0; i < 100 && confirmed !== 200; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      confirmed = (await app.inject({ method: 'POST', url: '/operator/confirm', headers: admin, payload: { sessionId: 's-citas', actionId: 'call_1_citas_enviar_recordatorio', approved: true } })).statusCode;
    }
    const events = parseSse((await run).body);
    expect(events.find((e) => e.type === 'confirm')).toMatchObject({
      action: { driver: 'api', risk: 'irreversible', details: { servicio: 'Agenda de citas', metodo: 'POST', url: `${CITAS}/citas/${cita.id}/recordatorio`, cuerpo: { canal: 'sms' } } },
    });
    expect(citas.estado().recordatorios.length).toBe(sent + 1);

    const guia = parseSse((await chat('s-citas', 'usa leer_guia {"conector":"citas"}')).body).at(-1) as { reply: string };
    expect(guia.reply).toContain('Reserva siempre un hueco');
  });

  it('validates arguments against the imported schema before calling the service', async () => {
    await start();
    await approveCitas((await importCitas()).json() as ConnectorManifest);
    const before = citas.estado().citas.length;
    const events = parseSse((await chat('s-bad', 'usa citas_crear_cita {"body":{"cliente":"L"}}')).body);
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ outcome: 'invalid', summary: expect.stringContaining('body.email: obligatorio') });
    expect(citas.estado().citas.length).toBe(before);
  });

  it('connects a local MCP server only if its command is allowed', async () => {
    await start({ connectors: { env: {}, mcpAllow: [] } });
    const denied = await app.inject({ method: 'POST', url: '/connectors/import/mcp', headers: admin, payload: { id: 'notas', transport: 'stdio', command: 'node', args: [NOTAS_MCP_SCRIPT] } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: expect.stringContaining('VEX_MCP_ALLOW') });
    await app.close();

    await start();
    const res = await app.inject({ method: 'POST', url: '/connectors/import/mcp', headers: admin, payload: { id: 'notas', transport: 'stdio', command: 'node', args: [NOTAS_MCP_SCRIPT] } });
    expect(res.statusCode).toBe(201);
    const m = res.json() as ConnectorManifest;
    expect(m.tools.map((t) => `${t.name}:${t.suggestedRisk}`)).toEqual(['notas_listar_notas:read', 'notas_buscar_notas:read', 'notas_crear_nota:write', 'notas_borrar_nota:irreversible']);
    await app.inject({
      method: 'POST',
      url: '/connectors/notas/review',
      headers: admin,
      payload: { decisions: m.tools.map((t) => ({ name: t.name, risk: t.suggestedRisk, enabled: t.name !== 'notas_borrar_nota' })) },
    });
    expect(await toolNames()).not.toContain('notas_borrar_nota');
    const done = parseSse((await chat('s-notas', 'usa notas_crear_nota {"texto":"Preparar la reunión del lunes"}')).body).at(-1);
    expect(done).toMatchObject({ type: 'done', reply: expect.stringContaining('Preparar la reunión del lunes') });
  });

  it('refuses ids that would shadow a built-in tool', async () => {
    await start();
    const spec = { ...citasOpenApi(CITAS), paths: { '/x': { post: { operationId: 'tarea', responses: {} } } } };
    const res = await app.inject({ method: 'POST', url: '/connectors/import/openapi', headers: admin, payload: { id: 'crear', spec } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('crear_tarea') });
  });

  const VECTORCRAFT = 'C:/Program Files/VectorCraft/vectorcraft-cli.exe';
  it.skipIf(!existsSync(VECTORCRAFT))('drives the real VectorCraft (MCP) through Vex Core: draw, write and export after approval', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vex-vc-')).replace(/\\/g, '/');
    try {
      await start({ connectors: { env: {}, mcpAllow: [VECTORCRAFT] } });
      const imported = await app.inject({
        method: 'POST',
        url: '/connectors/import/mcp',
        headers: admin,
        payload: { id: 'vectorcraft', transport: 'stdio', command: VECTORCRAFT, args: ['mcp', '--headless', '--automation-read-root', dir, '--automation-write-root', dir] },
      });
      expect(imported.statusCode).toBe(201);
      const m = imported.json() as ConnectorManifest;
      const suggested = Object.fromEntries(m.tools.map((t) => [t.name, t.suggestedRisk]));
      expect(suggested).toMatchObject({ vectorcraft_inspect_document: 'read', vectorcraft_draw_shape: 'irreversible', vectorcraft_export: 'irreversible' });

      // The person decides: drawing edits an in-memory document that undo reverts, so it is a write;
      // exporting writes a file to disk and stays irreversible. Everything else stays off.
      const why = 'Edita el documento en memoria; se deshace con undo';
      const review = await app.inject({
        method: 'POST',
        url: '/connectors/vectorcraft/review',
        headers: admin,
        payload: {
          decisions: [
            { name: 'vectorcraft_inspect_document', risk: 'read', enabled: true },
            { name: 'vectorcraft_draw_shape', risk: 'write', enabled: true, lowerRiskReason: why },
            { name: 'vectorcraft_add_text', risk: 'write', enabled: true, lowerRiskReason: why },
            { name: 'vectorcraft_export', risk: 'irreversible', enabled: true },
          ],
          guide: 'Documento de 612 × 792 pt. Dibuja con draw_shape y add_text; exporta al final.',
        },
      });
      expect(review.statusCode).toBe(200);
      const live = (await toolNames()).filter((n) => n.startsWith('vectorcraft_'));
      expect(live.sort()).toEqual(['vectorcraft_add_text', 'vectorcraft_draw_shape', 'vectorcraft_export', 'vectorcraft_inspect_document']);

      const done = async (message: string) => parseSse((await chat('s-vc', message)).body).at(-1);
      expect(await done('usa vectorcraft_draw_shape {"shape":"rectangle","x":40,"y":40,"width":300,"height":160,"radius":24,"fill":"#2E7BFF","name":"Cartel"}')).toMatchObject({ type: 'done', reply: expect.stringContaining('"name":"Cartel"') });
      expect(await done('usa vectorcraft_add_text {"text":"Hola desde Vex","x":60,"y":130,"size":36,"color":"#FFFFFF"}')).toMatchObject({ type: 'done' });

      const run = chat('s-vc', `usa vectorcraft_export {"path":"${dir}/vex.png","format":"png"}`);
      let confirmed = 404;
      for (let i = 0; i < 200 && confirmed !== 200; i += 1) {
        await new Promise((r) => setTimeout(r, 10));
        confirmed = (await app.inject({ method: 'POST', url: '/operator/confirm', headers: admin, payload: { sessionId: 's-vc', actionId: 'call_1_vectorcraft_export', approved: true } })).statusCode;
      }
      const events = parseSse((await run).body);
      expect(events.find((e) => e.type === 'confirm')).toMatchObject({ action: { driver: 'mcp', details: { herramienta: 'export', argumentos: { path: `${dir}/vex.png` } } } });
      expect(events.at(-1)).toMatchObject({ type: 'done', reply: expect.stringContaining('Hecho (vectorcraft_export)') });
      expect(statSync(`${dir}/vex.png`).size).toBeGreaterThan(1000);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('keeps connectors and their reviews across restarts, and refreshes from the source', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vex-conn-'));
    try {
      await start({}, new SqliteStore(join(dir, 'vex.db')));
      await approveCitas((await importCitas()).json() as ConnectorManifest);
      await app.close();

      await start({}, new SqliteStore(join(dir, 'vex.db')));
      expect(await toolNames()).toContain('citas_crear_cita');
      const refresh = await app.inject({ method: 'POST', url: '/connectors/citas/refresh', headers: admin });
      expect(refresh.json()).toMatchObject({ added: [], changed: [], removed: [] });
      expect(await toolNames()).toContain('citas_crear_cita');
      expect((await app.inject({ method: 'DELETE', url: '/connectors/citas', headers: admin })).json()).toEqual({ ok: true });
      expect((await toolNames()).some((n) => n.startsWith('citas_'))).toBe(false);
      await app.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
