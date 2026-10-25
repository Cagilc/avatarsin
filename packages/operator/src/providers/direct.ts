import type { Completion, CompletionRequest, ModelProvider } from '../provider.ts';

export interface DirectCall {
  tool: string;
  params: Record<string, unknown>;
  /** How the button is labelled; used in the reply. */
  label: string;
}

/**
 * A provider that "asks" for one tool call and then reports its result: how a quick-action
 * button runs through the operator loop. Nothing is skipped on the way: the loop validates the
 * params, applies the policy, asks for confirmation when the risk requires it, audits and keeps
 * the conversation, exactly as with a call the model made.
 */
export class DirectProvider implements ModelProvider {
  readonly name = 'direct';
  private readonly call: DirectCall;

  constructor(call: DirectCall) {
    this.call = call;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const last = req.messages.at(-1);
    const result = last?.content.find((b) => b.type === 'tool_result');
    if (!result) {
      // One call per run, so the id is predictable (a host can confirm it by name, as with the scripted planner).
      return { content: [{ type: 'tool_use', id: `direct_${this.call.tool}`, name: this.call.tool, input: this.call.params }], stopReason: 'tool_use' };
    }
    const shown = result.content.length > 600 ? `${result.content.slice(0, 600)}…` : result.content;
    const text = result.isError ? `No se pudo ejecutar «${this.call.label}»: ${result.content.replace(/^ERROR \([a-z]+\): /, '')}` : `Hecho (${this.call.label}): ${shown}`;
    req.onTextDelta?.(text);
    return { content: [{ type: 'text', text }], stopReason: 'end_turn' };
  }
}
