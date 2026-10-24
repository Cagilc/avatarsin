import { describe, expect, it } from 'vitest';
import { ScriptedProvider } from '@vex/operator';
import { CASES } from './cases.ts';
import { runBank, runCase, toMarkdown } from './harness.ts';

// The scripted planner is the free regression gate: every case it can parse must pass.
// The same bank, run with Claude (`pnpm eval --provider anthropic`), is the real measure.
describe('eval bank · scripted gate', () => {
  for (const c of CASES.filter((x) => x.scripted !== 'skip')) {
    it(c.id, async () => {
      const r = await runCase(c, new ScriptedProvider());
      expect(r.failures, `${c.id}: ${r.failures.join('; ')}\ncalls: ${r.calls.join(' > ')}\nreply: ${r.reply}`).toEqual([]);
    });
  }

  it('reports what it skipped and renders a summary', async () => {
    const report = await runBank(CASES, new ScriptedProvider());
    expect(report.skipped).toBe(CASES.filter((c) => c.scripted === 'skip').length);
    expect(report.passRate).toBe(1);
    expect(toMarkdown(report)).toContain('| flujo-laura-completo | OK |');
  });

  it('has unique ids and covers injection and negative cases', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    expect(CASES.filter((c) => c.category === 'inyeccion').length).toBeGreaterThanOrEqual(3);
    expect(CASES.filter((c) => c.category === 'negativo').length).toBeGreaterThanOrEqual(4);
  });
});
