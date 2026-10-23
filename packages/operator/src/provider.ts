import type { ToolSpec } from './tool.ts';

/**
 * Provider-neutral conversation shape. The core never imports a vendor SDK; adapters
 * (apps/api/src/providers) translate to and from the vendor's types.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  /** Vendor-specific block (e.g. a thinking block) replayed verbatim by the adapter that produced it. */
  | { type: 'opaque'; vendor: string; block: unknown };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  /** Called with text as it streams, when the provider supports it. */
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface Completion {
  content: ContentBlock[];
  stopReason: StopReason;
  /** Free-form usage figures for the audit/telemetry; provider-specific keys. */
  usage?: Record<string, number>;
}

export interface ModelProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<Completion>;
}
