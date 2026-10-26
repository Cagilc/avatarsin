import { describe, expect, it } from 'vitest';
import { HeuristicAssistant } from '../src/assistant/heuristic.ts';
import type { Proposal } from '../src/assistant/types.ts';
import { CASES } from './cases.ts';
import { check, runBank, runCase, toMarkdown } from './harness.ts';
import { rawMascot } from './fixtures.ts';

// The geometric assistant is the free regression gate: every case it can read must pass.
// The same bank, run with Claude (`pnpm eval:studio -- --provider claude`), is the real measure.
describe('banco del asistente · puerta geométrica', () => {
  for (const c of CASES.filter((x) => x.heuristic !== 'skip')) {
    it(c.id, async () => {
      const r = await runCase(c, new HeuristicAssistant());
      expect(r.failures, `${c.id}: ${r.failures.join('; ')}\npreguntas: ${r.questions.join(', ')}`).toEqual([]);
    });
  }

  it('informa de lo omitido y resume en Markdown', async () => {
    const report = await runBank(CASES, new HeuristicAssistant());
    expect(report.skipped).toBe(CASES.filter((c) => c.heuristic === 'skip').length);
    expect(report.passRate).toBe(1);
    expect(toMarkdown(report)).toContain('| esqueleto-mascota | OK |');
  });

  it('tiene ids únicos y cubre esqueleto, preguntas, respeto y lenguaje', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const cat of ['esqueleto', 'peticion', 'preguntas', 'respeto', 'animacion', 'lenguaje']) expect(CASES.some((c) => c.category === cat), cat).toBe(true);
  });
});

describe('banco del asistente · las comprobaciones miden de verdad', () => {
  const c = CASES.find((x) => x.id === 'esqueleto-mascota')!;
  const base = (over: Partial<Proposal>): Proposal => ({ summary: [], ops: [], questions: [], confidence: 1, provider: 'fake', ...over });

  it('suspende a quien toca las capacidades, pregunta de más o deja el esqueleto plano', () => {
    const doc = rawMascot();
    expect(check(c, doc, base({ ops: [{ op: 'setCapabilities', capabilities: { maxRisk: 'irreversible' } }] }))).toEqual(expect.arrayContaining([expect.stringContaining('setCapabilities')]));
    const lazy = base({
      questions: Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, text: '?', why: '', recommended: 'a', options: [{ id: 'a', label: 'A', detail: '', ops: [] }, { id: 'b', label: 'B', detail: '', ops: [] }] })),
    });
    expect(check(c, doc, lazy)).toEqual(expect.arrayContaining([expect.stringContaining('4 preguntas'), expect.stringContaining('p7 cuelga de nada'), expect.stringContaining('p6 sin física'), expect.stringContaining('estados sin animación')]));
  });

  it('suspende una propuesta que no aplica, y una opción cuyo valor no está entre las suyas', () => {
    const doc = rawMascot();
    expect(check(c, doc, base({ ops: [{ op: 'updatePart', id: 'no-existe', patch: { parent: null } }] }))).toEqual(expect.arrayContaining([expect.stringContaining('no aplica')]));
    const odd = base({ questions: [{ id: 'estilo', text: '?', why: '', recommended: 'x', options: [{ id: 'plano', label: 'P', detail: '', ops: [] }, { id: 'volumen', label: 'V', detail: '', ops: [] }] }] });
    expect(check(c, doc, odd)).toEqual(expect.arrayContaining([expect.stringContaining('recomienda x')]));
  });
});
