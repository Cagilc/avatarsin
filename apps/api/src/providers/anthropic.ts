import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, Completion, CompletionRequest, ContentBlock, ModelProvider, StopReason } from '@vex/operator';

const VENDOR = 'anthropic';

function toParam(message: ChatMessage): Anthropic.MessageParam {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text });
        break;
      case 'tool_use':
        content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} });
        break;
      case 'tool_result':
        content.push({ type: 'tool_result', tool_use_id: block.toolUseId, content: block.content, ...(block.isError ? { is_error: true } : {}) });
        break;
      case 'opaque':
        // Thinking blocks must go back unchanged, in place, for the model that produced them.
        if (block.vendor === VENDOR) content.push(block.block as Anthropic.ContentBlockParam);
        break;
    }
  }
  return { role: message.role, content };
}

function fromResponse(message: Anthropic.Message): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const block of message.content) {
    if (block.type === 'text') out.push({ type: 'text', text: block.text });
    else if (block.type === 'tool_use') out.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    else out.push({ type: 'opaque', vendor: VENDOR, block });
  }
  return out;
}

function stopReason(reason: Anthropic.Message['stop_reason']): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

export interface AnthropicProviderOptions {
  model: string;
  client?: Anthropic;
  maxTokens?: number;
}

/** Claude through the official SDK: streaming, tool use, cached system prompt. */
export class AnthropicProvider implements ModelProvider {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicProviderOptions) {
    this.client = opts.client ?? new Anthropic();
    this.model = opts.model;
    this.maxTokens = opts.maxTokens ?? 16_000;
    this.name = `anthropic:${this.model}`;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        // The system prompt is stable per host: cache it. Tools render before it and are stable too.
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: req.messages.map(toParam),
        tools,
      },
      req.signal ? { signal: req.signal } : undefined,
    );
    if (req.onTextDelta) stream.on('text', (delta) => req.onTextDelta?.(delta));
    const message = await stream.finalMessage();
    return {
      content: fromResponse(message),
      stopReason: stopReason(message.stop_reason),
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
