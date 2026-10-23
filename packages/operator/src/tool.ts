import { z } from 'zod';
import type { Driver, Principal, Risk } from './schema/action.ts';

/** What a tool knows about the call besides its input. */
export interface ToolContext {
  sessionId: string;
  principal: Principal;
  /** What the host says the user is looking at (open record, screen…). Free-form, host-defined. */
  context: Record<string, unknown>;
}

/**
 * A tool = contract (name, risk, input schema, human summary) + implementation.
 * The contract is what the model and the permission policy see; the implementation is the driver.
 */
export interface ToolDefinition<I, O = unknown> {
  name: string;
  /** Shown to the model. Say what it does and when to use it, in the host's language. */
  description: string;
  driver: Driver;
  risk: Risk;
  input: z.ZodType<I>;
  /** One sentence for confirmation cards and the audit log: "Enviar correo a … con asunto …". */
  summarize: (input: I) => string;
  execute: (input: I, ctx: ToolContext) => Promise<O>;
}

// biome-ignore lint/suspicious/noExplicitAny: registries hold tools of every input type.
export type AnyTool = ToolDefinition<any, unknown>;

export function defineTool<I, O = unknown>(def: ToolDefinition<I, O>): ToolDefinition<I, O> {
  return def;
}

/** Tool description in the neutral shape providers translate to their own API. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function toToolSpec(tool: AnyTool): ToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input) as Record<string, unknown>,
  };
}
