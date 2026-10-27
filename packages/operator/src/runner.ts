import type { ActionOutcome, ActionRequest, Principal } from './schema/action.ts';
import type { AuditEntry } from './schema/audit.ts';
import type { OperatorEvent } from './schema/events.ts';
import { decide, type PermissionPolicy } from './schema/policy.ts';
import type { ChatMessage, Completion, ContentBlock, ModelProvider } from './provider.ts';
import { toToolSpec, type AnyTool, type ToolContext, type VerifyRead } from './tool.ts';

export interface RunOptions {
  sessionId: string;
  provider: ModelProvider;
  tools: AnyTool[];
  policy: PermissionPolicy;
  principal: Principal;
  /** Host-defined screen context, sent with the user's message. */
  context: Record<string, unknown>;
  /** Conversation so far; the runner appends to it in place. */
  history: ChatMessage[];
  userMessage: string;
  system: string;
  emit: (event: OperatorEvent) => void;
  /** Resolve with the user's decision. The loop is paused meanwhile. */
  confirm: (action: ActionRequest) => Promise<boolean>;
  audit: (entry: AuditEntry) => void;
  /** Aborting stops the loop at the next safe point: the model call, a pending confirmation or between tools. */
  signal?: AbortSignal;
  /** Model round-trips per user message. */
  maxTurns?: number;
  /** Tool calls per user message; the rest are denied. Caps the damage of a runaway loop. */
  maxToolCalls?: number;
  now?: () => number;
}

export interface RunResult {
  reply: string;
  turns: number;
  /** True when the user stopped the run. */
  cancelled?: boolean;
}

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_MAX_TOOL_CALLS = 25;

class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

/** Rejects with Cancelled as soon as the signal fires, even if the wrapped work ignores it. */
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Cancelled());
      return;
    }
    const onAbort = () => reject(new Cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function serialize(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data ?? null);
}

/**
 * The operator loop: ask the model, run the tools it asked for (policy, confirmation,
 * validation, audit), feed the results back, until the model answers in text, the user stops
 * it, or a cap is hit. The history always stays valid: every tool_use gets a tool_result,
 * also when the run is stopped half way.
 */
export async function runOperator(opts: RunOptions): Promise<RunResult> {
  const { emit, history, policy, principal, provider, sessionId, signal, tools } = opts;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxToolCalls = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const now = opts.now ?? (() => Date.now());
  const specs = tools.map(toToolSpec);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const toolCtx: ToolContext = { sessionId, principal, context: opts.context, ...(signal ? { signal } : {}) };

  const contextText = Object.keys(opts.context).length > 0 ? `[Contexto de pantalla] ${JSON.stringify(opts.context)}\n\n` : '';
  history.push({ role: 'user', content: [{ type: 'text', text: `${contextText}${opts.userMessage}` }] });

  let turns = 0;
  let reply = '';
  let toolCalls = 0;

  const MAX_EFFECT_CHARS = 2000;
  /**
   * After a write ran: call the read the tool declared, audit it like any read, and tell the host
   * what it saw. Nothing here changes the action's outcome; the model gets the check as a note
   * after the tool results, so its reply can say "comprobado".
   */
  const checkEffect = async (tool: AnyTool, input: unknown, output: unknown, action: ActionRequest, notes: string[]): Promise<void> => {
    const verify = tool.verify;
    if (!verify) return;
    let target: string | undefined;
    try {
      target = verify.target?.(input, output);
    } catch {
      target = undefined;
    }
    const report = (confirmed: boolean, summary: string, details?: unknown) => {
      const shown = details === undefined ? undefined : JSON.stringify(details).length > MAX_EFFECT_CHARS ? `${JSON.stringify(details).slice(0, MAX_EFFECT_CHARS)}…` : details;
      emit({ type: 'effect', id: action.id, tool: action.tool, readTool: verify.tool, confirmed, summary, ...(shown !== undefined ? { details: shown } : {}), ...(target ? { target } : {}) });
      // Told to the model as text after the tool results, so each result stays the plain data the tool returned.
      notes.push(`[Comprobación de ${action.tool}] ${summary}`);
    };
    const read = byName.get(verify.tool);
    if (!read) return report(false, `No se pudo comprobar: la herramienta de lectura ${verify.tool} no está disponible.`);
    if (decide(policy, read) !== 'allow') return report(false, `No se pudo comprobar: la política no permite ${read.name} sin confirmación.`);
    let params: Record<string, unknown> | null;
    try {
      params = verify.params(input, output);
    } catch (err) {
      return report(false, `No se pudo comprobar: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!params) return report(false, 'No se pudo comprobar: la acción no devolvió con qué comprobar.');
    const parsed = read.input.safeParse(params);
    if (!parsed.success) return report(false, `No se pudo comprobar: parámetros inválidos para ${read.name}.`);
    const started = now();
    let outcome: VerifyRead;
    try {
      outcome = { ok: true, data: await abortable(read.execute(parsed.data, toolCtx), signal) };
    } catch (err) {
      if (err instanceof Cancelled) throw err;
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const summary = read.summarize(parsed.data);
    opts.audit({
      ts: new Date(now()).toISOString(),
      sessionId,
      principal,
      actionId: `${action.id}:verify`,
      tool: read.name,
      driver: read.driver,
      risk: read.risk,
      params: parsed.data as Record<string, unknown>,
      summary: `Comprobar: ${summary}`,
      outcome: outcome.ok ? 'ok' : 'error',
      ...(outcome.ok ? {} : { error: outcome.error }),
      durationMs: Math.max(0, now() - started),
    });
    const confirmed = verify.confirms ? verify.confirms(outcome, input, output) : outcome.ok;
    report(confirmed, confirmed ? `Comprobado: ${summary}` : `No se pudo comprobar: ${outcome.ok ? 'la lectura no coincide con lo esperado' : outcome.error}`, outcome.ok ? outcome.data : undefined);
  };

  const stop = (): RunResult => {
    emit({ type: 'phase', phase: 'idle' });
    emit({ type: 'cancelled' });
    return { reply, turns, cancelled: true };
  };

  while (turns < maxTurns) {
    if (signal?.aborted) return stop();
    turns += 1;
    emit({ type: 'phase', phase: 'thinking' });
    let completion: Completion;
    try {
      completion = await abortable(
        provider.complete({
          system: opts.system,
          messages: history,
          tools: specs,
          onTextDelta: (delta) => emit({ type: 'text', delta }),
          ...(signal ? { signal } : {}),
        }),
        signal,
      );
    } catch (err) {
      if (err instanceof Cancelled || signal?.aborted) return stop();
      throw err;
    }
    history.push({ role: 'assistant', content: completion.content });

    const toolUses = completion.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    reply = textOf(completion.content);

    if (completion.stopReason === 'refusal') {
      emit({ type: 'phase', phase: 'error' });
      emit({ type: 'error', message: 'El modelo ha declinado esta petición.' });
      return { reply, turns };
    }
    if (toolUses.length === 0) {
      emit({ type: 'phase', phase: 'talking' });
      emit({ type: 'done', reply, turns });
      return { reply, turns };
    }

    const results: ContentBlock[] = [];
    const notes: string[] = [];
    let cancelledAt = -1;

    for (let i = 0; i < toolUses.length; i += 1) {
      const use = toolUses[i]!;
      if (signal?.aborted) {
        cancelledAt = i;
        break;
      }
      const started = now();
      const tool = byName.get(use.name);
      const base = { id: use.id, tool: use.name, params: (use.input ?? {}) as Record<string, unknown> };

      const finish = (outcome: ActionOutcome, action: ActionRequest, data?: unknown, error?: string) => {
        const durationMs = Math.max(0, now() - started);
        opts.audit({
          ts: new Date(now()).toISOString(),
          sessionId,
          principal,
          actionId: action.id,
          tool: action.tool,
          driver: action.driver,
          risk: action.risk,
          params: action.params,
          ...(action.details ? { details: action.details } : {}),
          summary: action.summary,
          outcome,
          ...(error !== undefined ? { error } : {}),
          durationMs,
        });
        const summary = outcome === 'ok' ? action.summary : (error ?? outcome);
        emit({ type: 'tool_result', id: action.id, outcome, summary });
        results.push({
          type: 'tool_result',
          toolUseId: action.id,
          content: outcome === 'ok' ? serialize(data) : `ERROR (${outcome}): ${error ?? outcome}`,
          ...(outcome === 'ok' ? {} : { isError: true }),
        });
      };

      if (!tool) {
        finish('invalid', { ...base, driver: 'platform', risk: 'read', summary: `Herramienta desconocida: ${use.name}` }, undefined, `La herramienta "${use.name}" no existe.`);
        continue;
      }
      const parsed = tool.input.safeParse(use.input ?? {});
      if (!parsed.success) {
        finish(
          'invalid',
          { ...base, driver: tool.driver, risk: tool.risk, summary: `Parámetros inválidos para ${tool.name}` },
          undefined,
          `Parámetros inválidos: ${parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`,
        );
        continue;
      }
      let action: ActionRequest = { ...base, params: parsed.data as Record<string, unknown>, driver: tool.driver, risk: tool.risk, summary: tool.summarize(parsed.data) };

      if (toolCalls >= maxToolCalls) {
        finish('denied', action, undefined, `Límite de ${maxToolCalls} acciones por petición alcanzado.`);
        continue;
      }
      toolCalls += 1;

      const decision = decide(policy, tool);
      if (decision === 'deny') {
        finish('denied', action, undefined, `La política no permite ${tool.name}.`);
        continue;
      }
      if (decision === 'confirm') {
        let approved = false;
        let previewFailed = false;
        try {
          if (tool.preview) {
            // The card shows what will really happen (recipient, subject…), read from the system of
            // record, never from what the model claims. If it cannot be read, nothing is asked.
            try {
              const details = await abortable(tool.preview(parsed.data, toolCtx), signal);
              action = { ...action, details };
            } catch (err) {
              if (err instanceof Cancelled) throw err;
              finish('error', action, undefined, `No se puede preparar la confirmación: ${err instanceof Error ? err.message : String(err)}`);
              previewFailed = true;
            }
          }
          if (!previewFailed) {
            emit({ type: 'phase', phase: 'awaiting_confirmation' });
            emit({ type: 'confirm', action });
            approved = await abortable(opts.confirm(action), signal);
          }
        } catch (err) {
          if (!(err instanceof Cancelled) && !signal?.aborted) throw err;
          finish('cancelled', action, undefined, 'Detenido por el usuario.');
          cancelledAt = i + 1;
          break;
        }
        if (previewFailed) continue;
        if (!approved) {
          finish('rejected', action, undefined, 'El usuario ha rechazado la acción.');
          continue;
        }
      }

      emit({ type: 'phase', phase: 'working' });
      emit({ type: 'progress', step: i + 1, total: toolUses.length, label: action.summary });
      emit({ type: 'tool_call', action });
      let output: { ok: true; data: unknown } | null = null;
      try {
        const data = await tool.execute(parsed.data, toolCtx);
        finish('ok', action, data);
        output = { ok: true, data };
      } catch (err) {
        finish('error', action, undefined, err instanceof Error ? err.message : String(err));
      }
      if (output) {
        try {
          await checkEffect(tool, parsed.data, output.data, action, notes);
        } catch (err) {
          if (!(err instanceof Cancelled) && !signal?.aborted) throw err;
          // The write is done and audited; what did not run yet is closed below.
          cancelledAt = i + 1;
          break;
        }
      }
    }

    if (cancelledAt >= 0) {
      // Close every tool_use that did not run so the conversation stays valid for the next message.
      for (const use of toolUses.slice(cancelledAt)) {
        const tool = byName.get(use.name);
        const action: ActionRequest = {
          id: use.id,
          tool: use.name,
          driver: tool?.driver ?? 'platform',
          risk: tool?.risk ?? 'read',
          params: (use.input ?? {}) as Record<string, unknown>,
          summary: `Cancelado: ${use.name}`,
        };
        opts.audit({
          ts: new Date(now()).toISOString(),
          sessionId,
          principal,
          actionId: action.id,
          tool: action.tool,
          driver: action.driver,
          risk: action.risk,
          params: action.params,
          summary: action.summary,
          outcome: 'cancelled',
          error: 'Detenido por el usuario.',
          durationMs: 0,
        });
        emit({ type: 'tool_result', id: action.id, outcome: 'cancelled', summary: 'Detenido por el usuario.' });
        results.push({ type: 'tool_result', toolUseId: action.id, content: 'ERROR (cancelled): Detenido por el usuario.', isError: true });
      }
      if (notes.length) results.push({ type: 'text', text: notes.join('\n') });
      history.push({ role: 'user', content: results });
      return stop();
    }
    // Tool results first (the API wants them at the head of the message), then what the checks saw.
    if (notes.length) results.push({ type: 'text', text: notes.join('\n') });
    history.push({ role: 'user', content: results });
  }

  emit({ type: 'phase', phase: 'error' });
  emit({ type: 'error', message: `Límite de ${maxTurns} pasos alcanzado sin terminar.` });
  return { reply, turns };
}

export const RUNNER_DEFAULTS = { maxTurns: DEFAULT_MAX_TURNS, maxToolCalls: DEFAULT_MAX_TOOL_CALLS } as const;
