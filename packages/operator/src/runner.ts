import type { ActionOutcome, ActionRequest, Principal } from './schema/action.ts';
import type { AuditEntry } from './schema/audit.ts';
import type { OperatorEvent } from './schema/events.ts';
import { decide, type PermissionPolicy } from './schema/policy.ts';
import type { ChatMessage, ContentBlock, ModelProvider } from './provider.ts';
import { toToolSpec, type AnyTool, type ToolContext } from './tool.ts';

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
  /** Model round-trips per user message. */
  maxTurns?: number;
  now?: () => number;
}

export interface RunResult {
  reply: string;
  turns: number;
}

const DEFAULT_MAX_TURNS = 8;

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
 * The operator loop: ask the model → run the tools it asked for (policy, confirmation,
 * validation, audit) → feed results back → until the model answers in text or the turn cap.
 */
export async function runOperator(opts: RunOptions): Promise<RunResult> {
  const { emit, history, policy, principal, provider, sessionId, tools } = opts;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const now = opts.now ?? (() => Date.now());
  const specs = tools.map(toToolSpec);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const toolCtx: ToolContext = { sessionId, principal, context: opts.context };

  const contextText = Object.keys(opts.context).length > 0 ? `[Contexto de pantalla] ${JSON.stringify(opts.context)}\n\n` : '';
  history.push({ role: 'user', content: [{ type: 'text', text: `${contextText}${opts.userMessage}` }] });

  let turns = 0;
  let reply = '';
  while (turns < maxTurns) {
    turns += 1;
    emit({ type: 'phase', phase: 'thinking' });
    const completion = await provider.complete({
      system: opts.system,
      messages: history,
      tools: specs,
      onTextDelta: (delta) => emit({ type: 'text', delta }),
    });
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
    let step = 0;
    for (const use of toolUses) {
      step += 1;
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
        finish('invalid', { ...base, driver: tool.driver, risk: tool.risk, summary: `Parámetros inválidos para ${tool.name}` }, undefined, `Parámetros inválidos: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        continue;
      }
      const action: ActionRequest = { ...base, params: parsed.data as Record<string, unknown>, driver: tool.driver, risk: tool.risk, summary: tool.summarize(parsed.data) };

      const decision = decide(policy, tool);
      if (decision === 'deny') {
        finish('denied', action, undefined, `La política no permite ${tool.name}.`);
        continue;
      }
      if (decision === 'confirm') {
        emit({ type: 'phase', phase: 'awaiting_confirmation' });
        emit({ type: 'confirm', action });
        const approved = await opts.confirm(action);
        if (!approved) {
          finish('rejected', action, undefined, 'El usuario ha rechazado la acción.');
          continue;
        }
      }

      emit({ type: 'phase', phase: 'working' });
      emit({ type: 'progress', step, total: toolUses.length, label: action.summary });
      emit({ type: 'tool_call', action });
      try {
        const data = await tool.execute(parsed.data, toolCtx);
        finish('ok', action, data);
      } catch (err) {
        finish('error', action, undefined, err instanceof Error ? err.message : String(err));
      }
    }
    history.push({ role: 'user', content: results });
  }

  emit({ type: 'phase', phase: 'error' });
  emit({ type: 'error', message: `Límite de ${maxTurns} pasos alcanzado sin terminar.` });
  return { reply, turns };
}

export const RUNNER_DEFAULTS = { maxTurns: DEFAULT_MAX_TURNS } as const;
