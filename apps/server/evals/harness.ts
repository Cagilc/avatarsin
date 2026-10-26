import { STATES, applyOps, effectivePhysics, pathsOf, type AvatarDocument } from '@vexstudio/format';
import type { Assistant, Proposal } from '../src/assistant/types.ts';
import type { Category, StudioCase } from './cases.ts';

export interface CaseResult {
  id: string;
  category: Category;
  pass: boolean;
  skipped: boolean;
  failures: string[];
  questions: string[];
  ops: number;
  ms: number;
  provider: string;
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
  cases: CaseResult[];
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const FORBIDDEN = new Set(['setCapabilities', 'release']);

/** Applies the proposal to the document and checks every expectation. */
export function check(c: StudioCase, doc: AvatarDocument, p: Proposal): string[] {
  const failures: string[] = [];
  const e = c.expect;

  for (const op of p.ops) if (FORBIDDEN.has(op.op) || e.noOps?.includes(op.op)) failures.push(`operación prohibida: ${op.op}`);
  if (p.questions.length > (e.maxQuestions ?? 3)) failures.push(`${p.questions.length} preguntas, máximo ${e.maxQuestions ?? 3}`);
  for (const q of p.questions) {
    if (q.options.length < 2) failures.push(`la pregunta ${q.id} tiene ${q.options.length} opciones`);
    if (!q.options.some((o) => o.id === q.recommended)) failures.push(`la pregunta ${q.id} recomienda ${q.recommended}, que no está entre sus opciones`);
    for (const o of q.options) {
      const r = applyOps(doc, [...p.ops, ...o.ops], 'ai');
      if (!r.ok) failures.push(`la opción ${q.id}/${o.id} no aplica: ${r.issues.map((i) => i.message).join(' ')}`);
    }
  }
  if (e.untouched) for (const op of p.ops) for (const path of pathsOf(op)) if (e.untouched.includes(path)) failures.push(`toca ${path}, que fijó una persona`);

  const applied = p.ops.length ? applyOps(doc, p.ops, 'ai') : ({ ok: true, doc, paths: [] } as const);
  if (!applied.ok) {
    failures.push(`la propuesta no aplica: ${applied.issues.map((i) => i.message).join(' ')}`);
    return failures;
  }
  const out = applied.doc;
  const part = (id: string) => out.parts.find((x) => x.id === id);

  if (e.nothing && (p.ops.length > 0 || p.questions.length > 0)) failures.push(`debía no proponer nada; propuso ${p.ops.length} operaciones y ${p.questions.length} preguntas`);
  for (const [id, parent] of Object.entries(e.parents ?? {})) if (part(id)?.parent !== parent) failures.push(`${id} cuelga de ${part(id)?.parent ?? 'nada'}, esperado ${parent ?? 'nada'}`);
  for (const [id, role] of Object.entries(e.roles ?? {})) if (part(id)?.role !== role) failures.push(`${id} es ${part(id)?.role ?? 'sin papel'}, esperado ${role}`);
  for (const id of e.physicsOn ?? []) {
    const pt = part(id);
    const ph = pt ? effectivePhysics(pt, out) : null;
    if (!pt?.physics?.enabled) failures.push(`${id} sin física`);
    else {
      if (e.maxStiffness !== undefined && ph && ph.stiffness > e.maxStiffness) failures.push(`${id} rigidez ${ph.stiffness.toFixed(2)}, máximo ${e.maxStiffness}`);
      if (e.weight && ph && (ph.weight < e.weight[0] || ph.weight > e.weight[1])) failures.push(`${id} peso ${ph.weight.toFixed(2)}, esperado ${e.weight[0]}–${e.weight[1]}`);
    }
  }
  for (const id of e.physicsOff ?? []) if (part(id)?.physics?.enabled) failures.push(`${id} con física, debía estar rígida`);
  if (e.realism && (out.style.realism < e.realism[0] || out.style.realism > e.realism[1])) failures.push(`realismo ${out.style.realism}, esperado ${e.realism[0]}–${e.realism[1]}`);
  if (e.gravity && (out.world.gravity.strength < e.gravity[0] || out.world.gravity.strength > e.gravity[1])) failures.push(`gravedad ${out.world.gravity.strength}, esperada ${e.gravity[0]}–${e.gravity[1]}`);
  if (e.finish) {
    for (const pt of out.parts.filter((x) => x.visible && x.role !== 'text' && x.role !== 'background')) if (pt.material?.finish !== e.finish) failures.push(`${pt.id} acabado ${pt.material?.finish ?? 'ninguno'}, esperado ${e.finish}`);
  }
  if (e.statesSet) {
    const missing = STATES.filter((s) => !out.states[s] || !out.clips.some((cl) => cl.id === out.states[s]));
    if (missing.length) failures.push(`estados sin animación: ${missing.join(', ')}`);
  }
  if (e.questions) {
    const got = p.questions.map((q) => q.id).sort();
    const want = [...e.questions].sort();
    if (got.join(',') !== want.join(',')) failures.push(`preguntas ${got.join(', ') || 'ninguna'}, esperadas ${want.join(', ') || 'ninguna'}`);
  }
  for (const [qid, rec] of Object.entries(e.recommended ?? {})) {
    const q = p.questions.find((x) => x.id === qid);
    if (q && q.recommended !== rec) failures.push(`la pregunta ${qid} recomienda ${q.recommended}, esperado ${rec}`);
  }
  if (e.name && out.personality.displayName !== e.name) failures.push(`se llama ${out.personality.displayName}, esperado ${e.name}`);
  if (e.tone && out.personality.tone !== e.tone) failures.push(`tono ${out.personality.tone}, esperado ${e.tone}`);
  for (const frag of e.summaryIncludes ?? []) if (!p.summary.some((line) => fold(line).includes(fold(frag)))) failures.push(`el resumen no dice "${frag}"`);
  return failures;
}

export async function runCase(c: StudioCase, assistant: Assistant): Promise<CaseResult> {
  const doc = c.doc();
  const started = performance.now();
  let proposal: Proposal | null = null;
  const failures: string[] = [];
  try {
    proposal = await assistant.propose({ doc, message: c.message, answers: c.answers ?? {} });
    failures.push(...check(c, doc, proposal));
  } catch (err) {
    failures.push(`el asistente lanzó un error: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { id: c.id, category: c.category, pass: failures.length === 0, skipped: false, failures, questions: proposal?.questions.map((q) => q.id) ?? [], ops: proposal?.ops.length ?? 0, ms: Math.round(performance.now() - started), provider: proposal?.provider ?? assistant.name };
}

/** Runs the bank in order. The geometric assistant skips the cases marked `heuristic: 'skip'`. */
export async function runBank(cases: StudioCase[], assistant: Assistant, onCase?: (r: CaseResult) => void): Promise<Report> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = assistant.name === 'heuristic' && c.heuristic === 'skip' ? { id: c.id, category: c.category, pass: false, skipped: true, failures: [], questions: [], ops: 0, ms: 0, provider: assistant.name } : await runCase(c, assistant);
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
    provider: assistant.name,
    date: new Date().toISOString(),
    total: results.length,
    run: ran.length,
    passed: ran.filter((r) => r.pass).length,
    skipped: results.length - ran.length,
    passRate: ran.length ? ran.filter((r) => r.pass).length / ran.length : 0,
    byCategory,
    msP50: times[Math.floor(times.length / 2)] ?? 0,
    msMax: times.at(-1) ?? 0,
    cases: results,
  };
}

export function toMarkdown(report: Report): string {
  const pct = (n: number) => `${Math.round(n * 100)} %`;
  return `${[
    `# Banco del asistente del estudio · ${report.provider}`,
    '',
    `${report.date}. ${report.passed} de ${report.run} casos superados (${pct(report.passRate)}); ${report.skipped} fuera del alcance de este asistente.`,
    '',
    '| Categoría | Superados |',
    '|---|---|',
    ...Object.entries(report.byCategory).map(([k, v]) => `| ${k} | ${v.passed} / ${v.run} |`),
    '',
    '| Caso | Resultado | Preguntas | Ops | ms | Fallos |',
    '|---|---|---|---|---|---|',
    ...report.cases.map((r) => `| ${r.id} | ${r.skipped ? 'omitido' : r.pass ? 'OK' : 'FALLA'} | ${r.questions.join(', ')} | ${r.ops} | ${r.ms} | ${r.failures.join('; ').replace(/\|/g, '/')} |`),
  ].join('\n')}\n`;
}
