import { z } from 'zod';
import type { Driver, Principal, Risk } from './schema/action.ts';

/** What a tool knows about the call besides its input. */
export interface ToolContext {
  sessionId: string;
  principal: Principal;
  /** What the host says the user is looking at (open record, screen…). Free-form, host-defined. */
  context: Record<string, unknown>;
  /** Fires when the user stops the run; long tools should honour it. */
  signal?: AbortSignal;
  /**
   * The person's own credential for the host (their JWT), only when the host's identity accepted
   * it for this request. A connector with `auth.kind: 'session'` sends it, so the host's API sees
   * who acts. Never logged, never shown, never kept beyond the run.
   */
  credential?: string;
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
  /** The schema the model sees, when the tool already has one (imported tools). Defaults to `input` as JSON Schema. */
  jsonSchema?: Record<string, unknown>;
  /** One sentence for confirmation cards and the audit log: "Enviar correo a … con asunto …". */
  summarize: (input: I) => string;
  /**
   * Read-only look at what the action will really do, shown on the confirmation card and kept in
   * the audit. Throwing means the action cannot run and the user is not asked.
   */
  preview?: (input: I, ctx: ToolContext) => Promise<Record<string, unknown>>;
  execute: (input: I, ctx: ToolContext) => Promise<O>;
  /**
   * How to see that the action took effect: a read tool to call afterwards. The runner runs it
   * like any read (policy, validation, audit) and reports what it saw as an `effect` event; a
   * read that fails never turns the action into a failure, it only says "could not check".
   */
  verify?: ToolVerification<I, O>;
}

export type VerifyRead = { ok: true; data: unknown } | { ok: false; error: string };

// Method signatures on purpose: a tool typed with its own output must still fit `AnyTool`.
export interface ToolVerification<I, O> {
  /** Name of the read tool that confirms the effect. Must be available and allowed by the policy. */
  tool: string;
  /** Input for that read, from this call's input and output. Null = nothing to check. */
  params(input: I, output: O): Record<string, unknown> | null;
  /** Judges the read. Default: the read succeeded. A delete confirms when the read says "not found". */
  confirms?(read: VerifyRead, input: I, output: O): boolean;
  /** Registered page element (data-vex-id) the avatar points at when the effect shows. */
  target?(input: I, output: O): string | undefined;
}

// biome-ignore lint/suspicious/noExplicitAny: registries hold tools of every input type.
export type AnyTool = ToolDefinition<any, any>;

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
    inputSchema: tool.jsonSchema ?? (z.toJSONSchema(tool.input) as Record<string, unknown>),
  };
}
