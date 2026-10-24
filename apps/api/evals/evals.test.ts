import { describe, expect, it } from 'vitest';
import { ScriptedProvider, type Completion, type ModelProvider } from '@vex/operator';
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

describe('eval bank · connector cases are measured correctly', () => {
  /** Plays a fixed sequence of tool calls, then a reply: stands in for a model. */
  class Script implements ModelProvider {
    readonly name = 'script';
    private readonly steps: Array<{ name: string; input: Record<string, unknown> } | string>;
    private i = 0;
    constructor(steps: Array<{ name: string; input: Record<string, unknown> } | string>) {
      this.steps = steps;
    }
    async complete(): Promise<Completion> {
      const step = this.steps[this.i] ?? 'Hecho.';
      this.i += 1;
      if (typeof step === 'string') return { content: [{ type: 'text', text: step }], stopReason: 'end_turn' };
      return { content: [{ type: 'tool_use', id: `s${this.i}`, name: step.name, input: step.input }], stopReason: 'tool_use' };
    }
  }
  const caseById = (id: string) => CASES.find((c) => c.id === id)!;

  it('passes when the model reads the guide, checks the slots, books and sends the SMS', async () => {
    const r = await runCase(
      caseById('conector-reservar-y-recordar'),
      new Script([
        { name: 'leer_guia', input: { conector: 'citas' } },
        { name: 'citas_listar_huecos', input: { fecha: '2026-10-28' } },
        { name: 'citas_crear_cita', input: { body: { cliente: 'Marco Rossi', email: 'marco.rossi@ejemplo.it', inicio: '2026-10-28T12:00:00+01:00', motivo: 'Revisar contrato' } } },
        { name: 'citas_enviar_recordatorio', input: { id: 'CITA-101', body: { canal: 'sms' } } },
        'Cita CITA-101 reservada y recordatorio enviado por SMS.',
      ]),
    );
    expect(r.failures).toEqual([]);
    expect(r.calls).toEqual(['leer_guia:ok', 'citas_listar_huecos:ok', 'citas_crear_cita:ok', 'citas_enviar_recordatorio:ok']);
  });

  it('fails when the model books a time that was not free and skips the guide', async () => {
    const r = await runCase(
      caseById('conector-reservar-primera-hora'),
      new Script([{ name: 'citas_crear_cita', input: { body: { cliente: 'Laura Pérez', email: 'laura.perez@ejemplo.es', inicio: '2026-10-27T11:00:00+01:00', motivo: 'Documentación' } } }, 'Reservada.']),
    );
    expect(r.failures).toEqual([
      'llamadas esperadas leer_guia > citas_listar_huecos > citas_crear_cita; hechas citas_crear_cita',
      'no hay cita a las 2026-10-27T09:00:00+01:00; hay 2026-10-27T11:00:00+01:00',
    ]);
  });

  it('counts a rejected reminder as not sent', async () => {
    const r = await runCase(
      caseById('conector-recordatorio-rechazado'),
      new Script([
        { name: 'citas_crear_cita', input: { body: { cliente: 'Marco Rossi', email: 'marco.rossi@ejemplo.it', inicio: '2026-10-28T12:00:00+01:00', motivo: 'Contrato' } } },
        { name: 'citas_enviar_recordatorio', input: { id: 'CITA-101', body: { canal: 'email' } } },
        'La cita queda reservada; el recordatorio no se ha enviado.',
      ]),
    );
    expect(r.failures).toEqual([]);
    expect(r.calls).toEqual(['citas_crear_cita:ok', 'citas_enviar_recordatorio:rejected']);
  });
});
