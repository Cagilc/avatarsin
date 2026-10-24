import type { AddressInfo } from 'node:net';
import { importOpenApi, reviewConnector } from '@vex/connectors';
import { runOperator, type AnyTool, type AuditEntry, type Completion, type CompletionRequest, type ModelProvider, type PermissionPolicy } from '@vex/operator';
import { createCitasApp, citasOpenApi } from '@vex/sample-tools';
import { DEMO_USERS } from '../src/auth.ts';
import { ConnectorRegistry } from '../src/connectors.ts';
import { MemoryStore } from '../src/storage.ts';
import { MockPlatform } from '../src/platform/mock.ts';
import { DEFAULT_PERSONALITY, buildSystemPrompt } from '../src/system.ts';
import { platformTools } from '../src/tools/platform.ts';
import type { Category, EvalCase } from './cases.ts';

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CaseResult {
  id: string;
  category: Category;
  pass: boolean;
  skipped: boolean;
  failures: string[];
  /** tool:outcome, in order. */
  calls: string[];
  turns: number;
  ms: number;
  usage: Usage;
  costUsd: number;
  reply: string;
}

export interface Report {
  provider: string;
  date: string;
  total: number;
  run: number;
  passed: number;
  skipped: number;
  passRate: number;
  byCategory: Record<string, { run: number; passed: number }>;
  msP50: number;
  msMax: number;
  avgToolCalls: number;
  costUsd: number;
  cases: CaseResult[];
}

/** USD per million tokens. Only for the cost estimate in the report. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function costOf(providerName: string, usage: Usage): number {
  const model = providerName.replace(/^anthropic:/, '');
  const p = PRICES[model];
  if (!p) return 0;
  return (usage.input * p.input + usage.output * p.output + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.cacheWrite) / 1_000_000;
}

/** Wraps a provider to add up the token usage it reports. */
class Metered implements ModelProvider {
  readonly name: string;
  readonly usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  private readonly inner: ModelProvider;

  constructor(inner: ModelProvider) {
    this.inner = inner;
    this.name = inner.name;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const c = await this.inner.complete(req);
    this.usage.input += c.usage?.['input'] ?? 0;
    this.usage.output += c.usage?.['output'] ?? 0;
    this.usage.cacheRead += c.usage?.['cacheRead'] ?? 0;
    this.usage.cacheWrite += c.usage?.['cacheWrite'] ?? 0;
    return c;
  }
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function isSubsequence(needle: string[], hay: string[]): boolean {
  let i = 0;
  for (const h of hay) if (h === needle[i]) i += 1;
  return i === needle.length;
}

const FIXED_NOW = () => new Date('2026-10-23T10:00:00.000Z');
const SYSTEM = buildSystemPrompt(DEFAULT_PERSONALITY, 'MNEE');
/** The same policy Vex Core uses: platform plus reviewed connectors. */
const POLICY: PermissionPolicy = { allow: ['platform:*', 'api:*', 'mcp:*'], deny: [], confirm: ['irreversible'] };
/** What an administrator would write when approving the appointments connector. */
const CITAS_GUIDE =
  'Agenda de citas presenciales. Las citas duran una hora, de 9:00 a 14:00, hora de Madrid (+01:00). Antes de reservar, consulta los huecos del día con citas_listar_huecos y usa exactamente una de esas horas. El recordatorio sale al cliente: envíalo solo si te lo piden y por el canal que pidan.';

type CitasApp = ReturnType<typeof createCitasApp>;

/** Starts a fresh appointments service and returns it with Vex's view of it: approved tools, guide and catalog. */
async function withCitas(): Promise<{ app: CitasApp; tools: AnyTool[]; system: string }> {
  const app = createCitasApp({ baseUrl: 'http://127.0.0.1:0' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const draft = importOpenApi(citasOpenApi(base), { id: 'citas' });
  const approved = reviewConnector(draft, draft.tools.map((t) => ({ name: t.name, risk: t.suggestedRisk, enabled: true })), 'eval');
  const store = new MemoryStore();
  store.saveConnector({ ...approved, guide: CITAS_GUIDE });
  const registry = new ConnectorRegistry({ store, env: {}, mcpAllow: [] });
  const system = buildSystemPrompt(DEFAULT_PERSONALITY, 'MNEE', registry.live().map((m) => ({ id: m.id, name: m.name, description: m.description })));
  return { app, tools: [registry.guideTool(), ...registry.tools()], system };
}

/** Runs one case on a fresh mock platform and checks every expectation. */
export async function runCase(c: EvalCase, provider: ModelProvider): Promise<CaseResult> {
  const platform = new MockPlatform(FIXED_NOW);
  await c.setup?.(platform);
  let tools: AnyTool[] = platformTools(platform);
  let system = SYSTEM;
  let citas: CitasApp | null = null;
  if (c.connectors?.includes('citas')) {
    const conn = await withCitas();
    citas = conn.app;
    tools = [...tools, ...conn.tools];
    system = conn.system;
  }
  const principal = DEMO_USERS.find((u) => u.id === (c.user ?? 'u-cesar'))!;
  const audit: AuditEntry[] = [];
  const metered = new Metered(provider);
  const started = performance.now();
  let reply = '';
  let turns = 0;
  const failures: string[] = [];

  try {
    const result = await runOperator({
      sessionId: `eval-${c.id}`,
      provider: metered,
      tools,
      policy: POLICY,
      principal,
      context: c.context ?? {},
      history: [],
      userMessage: c.request,
      system,
      emit: () => {},
      confirm: async () => (c.confirm ?? 'approve') === 'approve',
      audit: (e) => audit.push(e),
    });
    reply = result.reply;
    turns = result.turns;
  } catch (err) {
    failures.push(`el bucle lanzó un error: ${err instanceof Error ? err.message : String(err)}`);
  }
  const ms = Math.round(performance.now() - started);

  const okCalls = audit.filter((a) => a.outcome === 'ok').map((a) => a.tool);
  const e = c.expect;
  if (e.calls && !isSubsequence(e.calls, okCalls)) failures.push(`llamadas esperadas ${e.calls.join(' > ')}; hechas ${okCalls.join(' > ') || 'ninguna'}`);
  for (const f of e.forbidden ?? []) if (okCalls.includes(f)) failures.push(`no debía ejecutar ${f}`);

  const sent = await platform.correos();
  if (e.sent !== undefined && sent.length !== e.sent) failures.push(`correos enviados ${sent.length}, esperados ${e.sent}`);
  if (e.sentTo) {
    const got = sent.map((m) => m.para).sort();
    const want = [...e.sentTo].sort();
    if (got.join(',') !== want.join(',')) failures.push(`destinatarios ${got.join(', ') || 'ninguno'}, esperados ${want.join(', ')}`);
  }

  const nuevosExp = (await platform.expedientes()).filter((x) => x.creadoPor !== 'sistema');
  if (e.expedientes) {
    if (e.expedientes.length === 0 && nuevosExp.length > 0) failures.push(`no debía abrir expedientes; abrió ${nuevosExp.map((x) => `${x.id}/${x.tipo}`).join(', ')}`);
    for (const want of e.expedientes) {
      if (!nuevosExp.some((x) => x.contactoId === want.contactoId && (want.tipo === undefined || fold(x.tipo).includes(fold(want.tipo))))) {
        failures.push(`falta expediente ${want.tipo ?? ''} para ${want.contactoId}`);
      }
    }
  }
  const nuevasTareas = (await platform.tareas()).filter((t) => t.creadaPor !== 'sistema');
  if (e.tareas) {
    if (e.tareas.length === 0 && nuevasTareas.length > 0) failures.push(`no debía crear tareas; creó ${nuevasTareas.map((t) => `"${t.titulo}"/${t.equipo}`).join(', ')}`);
    for (const want of e.tareas) {
      const match = nuevasTareas.some(
        (t) =>
          t.equipo === want.equipo &&
          (want.titulo === undefined || fold(t.titulo).includes(fold(want.titulo))) &&
          (want.expedienteId === undefined || t.expedienteId === want.expedienteId),
      );
      if (!match) failures.push(`falta tarea para ${want.equipo}${want.titulo ? ` "${want.titulo}"` : ''}${want.expedienteId ? ` en ${want.expedienteId}` : ''}`);
    }
  }
  for (const frag of e.replyIncludes ?? []) if (!fold(reply).includes(fold(frag))) failures.push(`la respuesta no menciona "${frag}"`);
  if (e.maxToolCalls !== undefined && audit.length > e.maxToolCalls) failures.push(`${audit.length} acciones, máximo ${e.maxToolCalls}`);
  if (e.auditPrincipal && audit.some((a) => a.principal.id !== e.auditPrincipal)) failures.push(`acciones registradas con otro usuario que ${e.auditPrincipal}`);
  if (e.citas) {
    const st = citas ? citas.estado() : { citas: [], recordatorios: [] };
    const creadas = st.citas.filter((x) => x.estado === 'confirmada');
    if (e.citas.creadas !== undefined && creadas.length !== e.citas.creadas) failures.push(`citas reservadas ${creadas.length}, esperadas ${e.citas.creadas}`);
    if (e.citas.inicio && !creadas.some((x) => x.inicio === e.citas!.inicio)) failures.push(`no hay cita a las ${e.citas.inicio}; hay ${creadas.map((x) => x.inicio).join(', ') || 'ninguna'}`);
    if (e.citas.recordatorios !== undefined && st.recordatorios.length !== e.citas.recordatorios) failures.push(`recordatorios enviados ${st.recordatorios.length}, esperados ${e.citas.recordatorios}`);
    if (e.citas.canal && !st.recordatorios.some((r) => r.canal === e.citas!.canal)) failures.push(`ningún recordatorio por ${e.citas.canal}`);
  }
  await citas?.close();

  return {
    id: c.id,
    category: c.category,
    pass: failures.length === 0,
    skipped: false,
    failures,
    calls: audit.map((a) => `${a.tool}:${a.outcome}`),
    turns,
    ms,
    usage: metered.usage,
    costUsd: costOf(provider.name, metered.usage),
    reply,
  };
}

function skippedResult(c: EvalCase): CaseResult {
  return { id: c.id, category: c.category, pass: false, skipped: true, failures: [], calls: [], turns: 0, ms: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, reply: '' };
}

/** Runs the bank sequentially. The keyword planner skips the cases marked `scripted: 'skip'`. */
export async function runBank(cases: EvalCase[], provider: ModelProvider, onCase?: (r: CaseResult) => void): Promise<Report> {
  const scripted = provider.name === 'scripted';
  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = scripted && c.scripted === 'skip' ? skippedResult(c) : await runCase(c, provider);
    results.push(r);
    onCase?.(r);
  }
  const ran = results.filter((r) => !r.skipped);
  const byCategory: Report['byCategory'] = {};
  for (const r of ran) {
    const slot = (byCategory[r.category] ??= { run: 0, passed: 0 });
    slot.run += 1;
    if (r.pass) slot.passed += 1;
  }
  const times = ran.map((r) => r.ms).sort((a, b) => a - b);
  return {
    provider: provider.name,
    date: new Date().toISOString(),
    total: results.length,
    run: ran.length,
    passed: ran.filter((r) => r.pass).length,
    skipped: results.length - ran.length,
    passRate: ran.length ? ran.filter((r) => r.pass).length / ran.length : 0,
    byCategory,
    msP50: times[Math.floor(times.length / 2)] ?? 0,
    msMax: times.at(-1) ?? 0,
    avgToolCalls: ran.length ? ran.reduce((n, r) => n + r.calls.length, 0) / ran.length : 0,
    costUsd: ran.reduce((n, r) => n + r.costUsd, 0),
    cases: results,
  };
}

/** Markdown summary for humans (and for the CI job summary). */
export function toMarkdown(report: Report): string {
  const pct = (n: number) => `${Math.round(n * 100)} %`;
  const lines = [
    `# Banco de encargos · ${report.provider}`,
    '',
    `${report.date}. ${report.passed} de ${report.run} encargos superados (${pct(report.passRate)}); ${report.skipped} fuera del alcance de este proveedor.`,
    '',
    '| Métrica | Valor |',
    '|---|---|',
    `| Acierto | ${pct(report.passRate)} |`,
    `| Latencia p50 / máx. | ${report.msP50} ms / ${report.msMax} ms |`,
    `| Acciones por encargo | ${report.avgToolCalls.toFixed(1)} |`,
    `| Coste estimado | ${report.costUsd.toFixed(4)} USD |`,
    '',
    '| Categoría | Superados |',
    '|---|---|',
    ...Object.entries(report.byCategory).map(([k, v]) => `| ${k} | ${v.passed} / ${v.run} |`),
    '',
    '| Encargo | Resultado | Acciones | ms | Fallos |',
    '|---|---|---|---|---|',
    ...report.cases.map((r) => `| ${r.id} | ${r.skipped ? 'omitido' : r.pass ? 'OK' : 'FALLA'} | ${r.calls.length} | ${r.ms} | ${r.failures.join('; ').replace(/\|/g, '/')} |`),
  ];
  return `${lines.join('\n')}\n`;
}
