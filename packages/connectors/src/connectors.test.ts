import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCitasApp, citasOpenApi, NOTAS_MCP_SCRIPT } from '@vex/sample-tools';
import { importOpenApi } from './openapi.ts';
import { importMcp } from './mcp/import.ts';
import { StdioMcpClient } from './mcp/client.ts';
import { refreshConnector, reviewConnector, liveTools, ReviewError, type ToolDecision } from './review.ts';
import { suggestHttpRisk, suggestMcpRisk } from './risk.ts';
import { resolveRefs, validateJson } from './jsonSchema.ts';
import { toolsFromManifest } from './runtime.ts';
import type { ConnectorManifest } from './manifest.ts';

const NOW = new Date('2026-10-24T10:00:00.000Z');

function approveAll(m: ConnectorManifest, reviewer = 'u-cesar'): ConnectorManifest {
  const decisions: ToolDecision[] = m.tools.map((t) => ({ name: t.name, risk: t.suggestedRisk, enabled: true }));
  return reviewConnector(m, decisions, reviewer, NOW);
}

describe('risk suggestions', () => {
  it('reads GET, distrusts DELETE and escalates writes that send, charge or delete', () => {
    expect(suggestHttpRisk('GET', '/citas').risk).toBe('read');
    expect(suggestHttpRisk('DELETE', '/citas/{id}').risk).toBe('irreversible');
    expect(suggestHttpRisk('POST', '/citas', 'crearCita', 'Reservar una cita').risk).toBe('write');
    expect(suggestHttpRisk('POST', '/citas/{id}/recordatorio', 'enviarRecordatorio')).toMatchObject({ risk: 'irreversible', reason: expect.stringContaining('envia') });
    expect(suggestHttpRisk('POST', '/invoices/{id}/pay').risk).toBe('irreversible');
  });

  it('uses MCP annotations as hints with pessimistic defaults', () => {
    expect(suggestMcpRisk('listar', '', { readOnlyHint: true }).risk).toBe('read');
    expect(suggestMcpRisk('crear_nota', '', { destructiveHint: false }).risk).toBe('write');
    expect(suggestMcpRisk('publicar', '', { destructiveHint: false, openWorldHint: true }).risk).toBe('irreversible');
    expect(suggestMcpRisk('enviar_sms', '', { destructiveHint: false }).risk).toBe('irreversible');
    expect(suggestMcpRisk('algo', '', undefined)).toMatchObject({ risk: 'irreversible', reason: expect.stringContaining('Sin anotaciones') });
  });
});

describe('JSON Schema subset', () => {
  const schema = {
    type: 'object',
    required: ['email', 'canal'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email' },
      canal: { type: 'string', enum: ['sms', 'email'] },
      n: { type: 'integer', minimum: 1, maximum: 3 },
      tags: { type: 'array', items: { type: 'string', minLength: 2 }, maxItems: 2 },
      nota: { type: 'string', nullable: true },
    },
  };

  it('accepts valid input and explains every problem in Spanish', () => {
    expect(validateJson(schema, { email: 'a@b.es', canal: 'sms', n: 2, tags: ['ok'], nota: null })).toEqual([]);
    expect(validateJson(schema, { email: 'no', canal: 'fax', n: 9, tags: ['x', 'yy', 'zz'], otro: 1 })).toEqual([
      'email: formato email no válido',
      'canal: debe ser uno de "sms", "email"',
      'n: máximo 3',
      'tags: máximo 2 elementos',
      'tags[0]: mínimo 2 caracteres',
      'otro: propiedad no admitida',
    ]);
    expect(validateJson(schema, {})).toEqual(['email: obligatorio', 'canal: obligatorio']);
    expect(validateJson({ anyOf: [{ type: 'string' }, { type: 'integer' }] }, true)).toEqual(['valor: no encaja en ninguna de las 2 formas admitidas']);
  });

  it('inlines local $refs and survives cycles', () => {
    const root = { components: { schemas: { A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } }, B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } } } } };
    const out = resolveRefs({ $ref: '#/components/schemas/A' }, root) as { type: string; properties: { b: { type: string; properties: { a: unknown } } } };
    expect(out.type).toBe('object');
    expect(out.properties.b.type).toBe('object');
    // The cycle closes at the first repeat with "accept anything".
    expect(out.properties.b.properties.a).toEqual({});
  });
});

describe('OpenAPI import', () => {
  const draft = importOpenApi(citasOpenApi('http://127.0.0.1:9'), { id: 'citas', now: () => NOW });

  it('makes one disabled tool per operation with a suggested risk and its reason', () => {
    expect(draft.name).toBe('Agenda de citas');
    expect(draft.tools.map((t) => `${t.name}:${t.suggestedRisk}`)).toEqual([
      'citas_listar_huecos:read',
      'citas_listar_citas:read',
      'citas_crear_cita:write',
      'citas_obtener_cita:read',
      'citas_cancelar_cita:irreversible',
      'citas_enviar_recordatorio:irreversible',
    ]);
    expect(draft.tools.every((t) => !t.enabled && t.risk === null && t.review === null)).toBe(true);
    expect(liveTools(draft)).toHaveLength(0);
  });

  it('builds input schemas from parameters and the resolved body', () => {
    const crear = draft.tools.find((t) => t.name === 'citas_crear_cita')!;
    expect(crear.binding).toMatchObject({ kind: 'http', method: 'POST', path: '/citas', body: true });
    expect(crear.inputSchema).toMatchObject({ required: ['body'], properties: { body: { required: ['cliente', 'email', 'inicio', 'motivo'] } } });
    const cancelar = draft.tools.find((t) => t.name === 'citas_cancelar_cita')!;
    expect(cancelar.binding).toMatchObject({ method: 'DELETE', pathParams: ['id'] });
    expect(cancelar.inputSchema).toMatchObject({ required: ['id'] });
  });

  it('rejects documents it cannot use', () => {
    expect(() => importOpenApi({ swagger: '2.0' }, { id: 'x' })).toThrow(/OpenAPI 3/);
    expect(() => importOpenApi({ ...citasOpenApi('/relativo'), servers: [{ url: '/v1' }] }, { id: 'x' })).toThrow(/URL base/);
  });
});

describe('human review', () => {
  const draft = importOpenApi(citasOpenApi('http://127.0.0.1:9'), { id: 'citas', now: () => NOW });

  it('records who approved what, and requires a reason to lower a risk', () => {
    expect(() => reviewConnector(draft, [{ name: 'citas_cancelar_cita', risk: 'write', enabled: true }], 'u-cesar')).toThrow(ReviewError);
    const m = reviewConnector(
      draft,
      [
        { name: 'citas_listar_huecos', risk: 'read', enabled: true },
        { name: 'citas_cancelar_cita', risk: 'write', enabled: true, lowerRiskReason: 'Cancelar se puede rehacer reservando otra vez' },
        { name: 'citas_enviar_recordatorio', risk: 'irreversible', enabled: false },
      ],
      'u-cesar',
      NOW,
    );
    expect(liveTools(m).map((t) => `${t.name}:${t.risk}`)).toEqual(['citas_listar_huecos:read', 'citas_cancelar_cita:write']);
    expect(m.tools.find((t) => t.name === 'citas_cancelar_cita')?.review).toEqual({ by: 'u-cesar', at: NOW.toISOString(), lowerRiskReason: 'Cancelar se puede rehacer reservando otra vez' });
    expect(() => reviewConnector(draft, [{ name: 'no_existe', risk: 'read', enabled: true }], 'u')).toThrow(/no tiene la herramienta/);
  });

  it('keeps approvals on refresh unless the contract changed', () => {
    const approved = approveAll(draft);
    const spec = citasOpenApi('http://127.0.0.1:9');
    (spec.paths['/huecos'].get.parameters[0] as { description: string }).description = 'Otra descripción';
    (spec.paths as Record<string, unknown>)['/salas'] = { get: { operationId: 'listarSalas', responses: {} } };
    const report = refreshConnector(approved, importOpenApi(spec, { id: 'citas', now: () => NOW }), NOW);
    expect(report.changed).toEqual(['citas_listar_huecos']);
    expect(report.added).toEqual(['citas_listar_salas']);
    expect(report.removed).toEqual([]);
    const live = liveTools(report.manifest).map((t) => t.name);
    expect(live).not.toContain('citas_listar_huecos');
    expect(live).not.toContain('citas_listar_salas');
    expect(live).toContain('citas_crear_cita');
  });
});

describe('runtime against the appointments API', () => {
  const TOKEN = 'secreto-de-prueba';
  const app = createCitasApp({ baseUrl: 'http://127.0.0.1:0', token: TOKEN });
  let base = '';

  beforeAll(async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });
  afterAll(async () => {
    await app.close();
  });

  function tools(env: Record<string, string | undefined> = { CITAS_TOKEN: TOKEN }) {
    const draft = importOpenApi(citasOpenApi(base), { id: 'citas', auth: { kind: 'bearer', env: 'CITAS_TOKEN' } });
    const byName = new Map(toolsFromManifest(approveAll(draft), { env }).map((t) => [t.name, t]));
    return (name: string) => byName.get(name)!;
  }
  const ctx = { sessionId: 's', principal: { id: 'u', name: 'U', role: 'admin' }, context: {} };

  it('exposes only approved tools, with the original schema and the approved risk', () => {
    const t = tools();
    expect(t('citas_crear_cita')).toMatchObject({ driver: 'api', risk: 'write', jsonSchema: { type: 'object' } });
    expect(t('citas_enviar_recordatorio').risk).toBe('irreversible');
  });

  it('books, previews and sends a reminder against the live service', async () => {
    const t = tools();
    const huecos = (await t('citas_listar_huecos').execute({ fecha: '2026-10-27' }, ctx)) as { huecos: string[] };
    expect(huecos.huecos).toHaveLength(5);
    const cita = (await t('citas_crear_cita').execute({ body: { cliente: 'Laura Pérez', email: 'laura.perez@ejemplo.es', inicio: huecos.huecos[1], motivo: 'Entrega de documentación' } }, ctx)) as { id: string };
    expect(cita.id).toMatch(/^CITA-/);
    const preview = await t('citas_enviar_recordatorio').preview!({ id: cita.id, body: { canal: 'sms' } }, ctx);
    expect(preview).toEqual({ servicio: 'Agenda de citas', metodo: 'POST', url: `${base}/citas/${cita.id}/recordatorio`, cuerpo: { canal: 'sms' } });
    await t('citas_enviar_recordatorio').execute({ id: cita.id, body: { canal: 'sms' } }, ctx);
    expect(app.estado().recordatorios).toHaveLength(1);
  });

  it('validates input with the tool schema and reports service errors', async () => {
    const t = tools();
    const bad = t('citas_crear_cita').input.safeParse({ body: { cliente: 'L', email: 'mal', inicio: 'mañana' } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.message)).toEqual(expect.arrayContaining(['body.motivo: obligatorio', 'body.email: formato email no válido']));
    await expect(t('citas_obtener_cita').execute({ id: 'CITA-999' }, ctx)).rejects.toThrow(/respondió 404/);
  });

  it('needs the secret from the environment and never stores it', async () => {
    const t = tools({});
    await expect(t('citas_listar_citas').execute({}, ctx)).rejects.toThrow(/Falta la variable de entorno CITAS_TOKEN/);
    const draft = importOpenApi(citasOpenApi(base), { id: 'citas', auth: { kind: 'bearer', env: 'CITAS_TOKEN' } });
    expect(JSON.stringify(draft)).not.toContain(TOKEN);
  });
});

describe('MCP over stdio', () => {
  it('imports the notes server, suggests risks from its annotations and runs approved tools', async () => {
    const client = await StdioMcpClient.start(process.execPath, [NOTAS_MCP_SCRIPT]);
    try {
      expect(client.server.name).toBe('notas');
      const draft = importMcp(await client.listTools(), { id: 'notas', source: { kind: 'mcp-stdio', command: 'node', args: [NOTAS_MCP_SCRIPT] }, server: client.server });
      expect(draft.tools.map((t) => `${t.name}:${t.suggestedRisk}`)).toEqual(['notas_listar_notas:read', 'notas_buscar_notas:read', 'notas_crear_nota:write', 'notas_borrar_nota:irreversible']);
      const live = new Map(toolsFromManifest(approveAll(draft), { env: {}, mcp: async () => client }).map((t) => [t.name, t]));
      const ctx = { sessionId: 's', principal: { id: 'u', name: 'U', role: 'admin' }, context: {} };
      const creada = JSON.parse((await live.get('notas_crear_nota')!.execute({ texto: 'Llamar a Laura el lunes' }, ctx)) as string) as { id: string };
      expect(creada.id).toBe('N-2');
      expect(await live.get('notas_buscar_notas')!.execute({ texto: 'laura' }, ctx)).toContain('Llamar a Laura');
      await expect(live.get('notas_borrar_nota')!.execute({ id: 'N-99' }, ctx)).rejects.toThrow(/No existe la nota N-99/);
      expect(await live.get('notas_borrar_nota')!.preview!({ id: 'N-2' }, ctx)).toEqual({ servicio: 'Tablón de notas del equipo', herramienta: 'borrar_nota', argumentos: { id: 'N-2' } });
    } finally {
      await client.close();
    }
  });

  it('reports a server that cannot start', async () => {
    await expect(StdioMcpClient.start(process.execPath, ['-e', 'process.exit(3)'], { timeoutMs: 5000 })).rejects.toThrow(/terminó|sin respuesta/);
  });

  const VECTORCRAFT = 'C:/Program Files/VectorCraft/vectorcraft-cli.exe';
  it.skipIf(!existsSync(VECTORCRAFT))('connects to the real VectorCraft MCP server installed on this machine', async () => {
    const client = await StdioMcpClient.start(VECTORCRAFT, ['mcp', '--headless']);
    try {
      expect(client.server).toMatchObject({ name: 'vectorcraft' });
      const draft = importMcp(await client.listTools(), { id: 'vectorcraft', source: { kind: 'mcp-stdio', command: VECTORCRAFT, args: ['mcp', '--headless'] }, server: client.server });
      const risks = Object.fromEntries(draft.tools.map((t) => [t.name, t.suggestedRisk]));
      expect(risks['vectorcraft_inspect_document']).toBe('read');
      expect(risks['vectorcraft_export']).toBe('irreversible');
      const live = new Map(toolsFromManifest(approveAll(draft), { env: {}, mcp: async () => client }).map((t) => [t.name, t]));
      const out = (await live.get('vectorcraft_list_commands')!.execute({ query: 'export', brief: true }, { sessionId: 's', principal: { id: 'u', name: 'U', role: 'admin' }, context: {} })) as string;
      expect(out.toLowerCase()).toContain('export');
    } finally {
      await client.close();
    }
  }, 30_000);
});
