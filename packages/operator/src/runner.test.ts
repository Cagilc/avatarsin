import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChatMessage, Completion, CompletionRequest, ModelProvider } from './provider.ts';
import { runOperator, type RunOptions } from './runner.ts';
import type { AuditEntry } from './schema/audit.ts';
import type { OperatorEvent } from './schema/events.ts';
import { DEFAULT_POLICY } from './schema/policy.ts';
import { defineTool } from './tool.ts';

/** Replays queued completions; records what it was asked. */
class QueueProvider implements ModelProvider {
  readonly name = 'queue';
  readonly requests: CompletionRequest[] = [];
  private readonly queue: Completion[];
  constructor(queue: Completion[]) {
    this.queue = queue;
  }
  async complete(req: CompletionRequest): Promise<Completion> {
    // Snapshot: the runner mutates the history array in place.
    this.requests.push({ ...req, messages: [...req.messages] });
    const next = this.queue.shift();
    if (!next) throw new Error('queue exhausted');
    return next;
  }
}

const calls: string[] = [];
const buscar = defineTool({
  name: 'buscar',
  description: 'Busca contactos',
  driver: 'platform',
  risk: 'read',
  input: z.object({ consulta: z.string().min(1) }),
  summarize: (i) => `Buscar "${i.consulta}"`,
  execute: async (i) => {
    calls.push(`buscar:${i.consulta}`);
    return { resultados: [{ id: 'c1', nombre: 'Laura' }] };
  },
});
const enviar = defineTool({
  name: 'enviar_correo',
  description: 'Envía un correo',
  driver: 'platform',
  risk: 'irreversible',
  input: z.object({ para: z.string().email() }),
  summarize: (i) => `Enviar correo a ${i.para}`,
  execute: async (i) => {
    calls.push(`enviar:${i.para}`);
    return { enviado: true };
  },
});
const rompe = defineTool({
  name: 'rompe',
  description: 'Falla siempre',
  driver: 'platform',
  risk: 'write',
  input: z.object({}),
  summarize: () => 'Romper',
  execute: async () => {
    throw new Error('boom');
  },
});

const text = (t: string): Completion => ({ content: [{ type: 'text', text: t }], stopReason: 'end_turn' });
const use = (name: string, input: unknown, id = `u_${name}`): Completion => ({ content: [{ type: 'tool_use', id, name, input }], stopReason: 'tool_use' });

function harness(queue: Completion[], overrides: Partial<RunOptions> = {}) {
  const events: OperatorEvent[] = [];
  const audit: AuditEntry[] = [];
  const history: ChatMessage[] = [];
  const provider = new QueueProvider(queue);
  const opts: RunOptions = {
    sessionId: 's1',
    provider,
    tools: [buscar, enviar, rompe],
    policy: DEFAULT_POLICY,
    principal: { id: 'u1', name: 'César', role: 'admin' },
    context: { pantalla: 'expedientes' },
    history,
    userMessage: 'hola',
    system: 'sys',
    emit: (e) => events.push(e),
    confirm: async () => true,
    audit: (a) => audit.push(a),
    now: () => 1_700_000_000_000,
    ...overrides,
  };
  return { opts, events, audit, history, provider };
}

describe('runOperator', () => {
  it('answers in text when the model asks for no tool', async () => {
    calls.length = 0;
    const h = harness([text('Hola, ¿qué necesitas?')]);
    const result = await runOperator(h.opts);
    expect(result).toEqual({ reply: 'Hola, ¿qué necesitas?', turns: 1 });
    expect(h.events.map((e) => e.type)).toEqual(['phase', 'phase', 'done']);
    expect(h.history[0]?.content[0]).toEqual({ type: 'text', text: '[Contexto de pantalla] {"pantalla":"expedientes"}\n\nhola' });
    expect(h.audit).toHaveLength(0);
  });

  it('runs a read tool silently, feeds the result back and audits it', async () => {
    calls.length = 0;
    const h = harness([use('buscar', { consulta: 'Laura' }), text('Encontrada.')]);
    const result = await runOperator(h.opts);
    expect(result.turns).toBe(2);
    expect(calls).toEqual(['buscar:Laura']);
    expect(h.events.some((e) => e.type === 'confirm')).toBe(false);
    expect(h.events.find((e) => e.type === 'tool_call')).toMatchObject({ action: { tool: 'buscar', risk: 'read', summary: 'Buscar "Laura"' } });
    const second = h.provider.requests[1]!;
    const last = second.messages[second.messages.length - 1]!;
    expect(last).toEqual({ role: 'user', content: [{ type: 'tool_result', toolUseId: 'u_buscar', content: '{"resultados":[{"id":"c1","nombre":"Laura"}]}' }] });
    expect(h.audit[0]).toMatchObject({ tool: 'buscar', outcome: 'ok', ts: '2023-11-14T22:13:20.000Z', principal: { id: 'u1' } });
  });

  it('pauses for confirmation on irreversible tools and skips them when rejected', async () => {
    calls.length = 0;
    const h = harness([use('enviar_correo', { para: 'laura@ejemplo.es' }), text('No lo envío.')], { confirm: async () => false });
    await runOperator(h.opts);
    expect(calls).toEqual([]);
    const confirm = h.events.find((e) => e.type === 'confirm');
    expect(confirm).toMatchObject({ action: { tool: 'enviar_correo', summary: 'Enviar correo a laura@ejemplo.es' } });
    expect(h.events.find((e) => e.type === 'tool_result')).toMatchObject({ outcome: 'rejected' });
    expect(h.audit[0]?.outcome).toBe('rejected');
    const fed = h.provider.requests[1]!.messages.at(-1)!.content[0];
    expect(fed).toMatchObject({ type: 'tool_result', isError: true });
  });

  it('executes irreversible tools once approved', async () => {
    calls.length = 0;
    const h = harness([use('enviar_correo', { para: 'laura@ejemplo.es' }), text('Enviado.')]);
    await runOperator(h.opts);
    expect(calls).toEqual(['enviar:laura@ejemplo.es']);
    expect(h.events.map((e) => (e.type === 'phase' ? e.phase : e.type))).toEqual([
      'thinking', 'awaiting_confirmation', 'confirm', 'working', 'progress', 'tool_call', 'tool_result', 'thinking', 'talking', 'done',
    ]);
  });

  it('denies tools outside the policy and reports invalid params without executing', async () => {
    calls.length = 0;
    const h = harness([use('buscar', { consulta: '' }, 'u1'), use('enviar_correo', { para: 'x@y.es' }, 'u2'), text('Fin.')], {
      policy: { allow: ['buscar'], deny: [], confirm: [] },
    });
    await runOperator(h.opts);
    expect(calls).toEqual([]);
    expect(h.audit.map((a) => a.outcome)).toEqual(['invalid', 'denied']);
  });

  it('turns tool exceptions into error results and keeps going', async () => {
    const h = harness([use('rompe', {}), text('Ha fallado.')]);
    const result = await runOperator(h.opts);
    expect(result.reply).toBe('Ha fallado.');
    expect(h.audit[0]).toMatchObject({ outcome: 'error', error: 'boom' });
  });

  it('stops at the turn cap with an error event', async () => {
    const h = harness([use('buscar', { consulta: 'a' }, 'a'), use('buscar', { consulta: 'b' }, 'b'), use('buscar', { consulta: 'c' }, 'c')], { maxTurns: 2 });
    const result = await runOperator(h.opts);
    expect(result.turns).toBe(2);
    expect(h.events.at(-1)).toMatchObject({ type: 'error' });
  });
});

describe('runOperator · stop, caps and previews', () => {
  const never = <T,>() => new Promise<T>(() => {});

  it('stops while the model is thinking, even if the provider ignores the signal', async () => {
    const controller = new AbortController();
    const hanging: ModelProvider = { name: 'hang', complete: () => never<Completion>() };
    const h = harness([], { provider: hanging, signal: controller.signal });
    const run = runOperator(h.opts);
    await Promise.resolve();
    controller.abort();
    const result = await run;
    expect(result.cancelled).toBe(true);
    expect(h.events.slice(-2)).toEqual([{ type: 'phase', phase: 'idle' }, { type: 'cancelled' }]);
    expect(h.audit).toHaveLength(0);
  });

  it('stops at a pending confirmation and closes every tool_use so the history stays valid', async () => {
    calls.length = 0;
    const controller = new AbortController();
    const both: Completion = {
      content: [
        { type: 'tool_use', id: 'u1', name: 'enviar_correo', input: { para: 'laura@ejemplo.es' } },
        { type: 'tool_use', id: 'u2', name: 'buscar', input: { consulta: 'Laura' } },
      ],
      stopReason: 'tool_use',
    };
    const h = harness([both], { signal: controller.signal, confirm: () => never<boolean>() });
    const run = runOperator(h.opts);
    await new Promise((r) => setTimeout(r, 5));
    expect(h.events.some((e) => e.type === 'confirm')).toBe(true);
    controller.abort();
    const result = await run;
    expect(result.cancelled).toBe(true);
    expect(calls).toEqual([]);
    expect(h.audit.map((a) => `${a.tool}:${a.outcome}`)).toEqual(['enviar_correo:cancelled', 'buscar:cancelled']);
    const last = h.history.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content.map((b) => (b.type === 'tool_result' ? `${b.toolUseId}:${b.isError}` : b.type))).toEqual(['u1:true', 'u2:true']);
  });

  it('does not start when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness([text('nunca')], { signal: controller.signal });
    const result = await runOperator(h.opts);
    expect(result).toEqual({ reply: '', turns: 0, cancelled: true });
    expect(h.provider.requests).toHaveLength(0);
  });

  it('denies tool calls beyond the cap', async () => {
    calls.length = 0;
    const many: Completion = {
      content: ['a', 'b', 'c'].map((q, i) => ({ type: 'tool_use' as const, id: `m${i}`, name: 'buscar', input: { consulta: q } })),
      stopReason: 'tool_use',
    };
    const h = harness([many, text('Fin.')], { maxToolCalls: 2 });
    await runOperator(h.opts);
    expect(calls).toEqual(['buscar:a', 'buscar:b']);
    expect(h.audit.map((a) => a.outcome)).toEqual(['ok', 'ok', 'denied']);
    expect(h.audit[2]?.error).toMatch(/Límite de 2 acciones/);
  });

  it('shows the real details on the confirmation card and keeps them in the audit', async () => {
    calls.length = 0;
    const seen: unknown[] = [];
    const conPreview = defineTool({
      ...enviar,
      name: 'enviar_borrador',
      input: z.object({ borradorId: z.string() }),
      summarize: (i: { borradorId: string }) => `Enviar el borrador ${i.borradorId}`,
      preview: async (i: { borradorId: string }) => ({ para: 'laura@ejemplo.es', asunto: `Asunto de ${i.borradorId}` }),
      execute: async () => ({ enviado: true }),
    });
    const h = harness([use('enviar_borrador', { borradorId: 'B-1' }), text('Enviado.')], {
      tools: [conPreview],
      confirm: async (action) => {
        seen.push(action.details);
        return true;
      },
    });
    await runOperator(h.opts);
    expect(seen).toEqual([{ para: 'laura@ejemplo.es', asunto: 'Asunto de B-1' }]);
    expect(h.events.find((e) => e.type === 'confirm')).toMatchObject({ action: { details: { para: 'laura@ejemplo.es' } } });
    expect(h.audit[0]).toMatchObject({ outcome: 'ok', details: { asunto: 'Asunto de B-1' } });
  });

  it('does not ask for confirmation when the preview cannot be read', async () => {
    const roto = defineTool({
      ...enviar,
      name: 'enviar_borrador',
      input: z.object({ borradorId: z.string() }),
      summarize: () => 'Enviar',
      preview: async () => {
        throw new Error('No existe el borrador B-9.');
      },
      execute: async () => ({ enviado: true }),
    });
    let asked = false;
    const h = harness([use('enviar_borrador', { borradorId: 'B-9' }), text('No pude.')], {
      tools: [roto],
      confirm: async () => {
        asked = true;
        return true;
      },
    });
    await runOperator(h.opts);
    expect(asked).toBe(false);
    expect(h.audit[0]).toMatchObject({ outcome: 'error', error: 'No se puede preparar la confirmación: No existe el borrador B-9.' });
  });
});
