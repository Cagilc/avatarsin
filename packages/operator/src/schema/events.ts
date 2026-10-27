import { z } from 'zod';
import { actionOutcomeSchema, actionRequestSchema, toolNameSchema } from './action.ts';

/**
 * What the operator is doing. The host's "director" maps phases to avatar states
 * (thinking → Vex thinking, awaiting_confirmation → listening with a raised brow, …).
 */
export const phaseSchema = z.enum([
  'idle',
  'listening',
  'thinking',
  'working',
  'awaiting_confirmation',
  'talking',
  'success',
  'error',
]);
export type Phase = z.infer<typeof phaseSchema>;

/** Events streamed from the operator core to its host (SSE, WebSocket or in-process). */
export const operatorEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('phase'), phase: phaseSchema }),
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({
    type: z.literal('progress'),
    step: z.number().int().positive(),
    total: z.number().int().positive().optional(),
    label: z.string(),
  }),
  z.object({ type: z.literal('tool_call'), action: actionRequestSchema }),
  z.object({
    type: z.literal('tool_result'),
    id: z.string(),
    outcome: actionOutcomeSchema,
    summary: z.string(),
  }),
  /** The loop is paused until the host answers with the user's decision for `action.id`. */
  z.object({ type: z.literal('confirm'), action: actionRequestSchema }),
  z.object({ type: z.literal('done'), reply: z.string(), turns: z.number().int().nonnegative() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  /** The user stopped the run; every pending action was closed as cancelled. */
  z.object({ type: z.literal('cancelled') }),
  /** Something the host should show the person before the reply (a usage cap reached, the AI paused). */
  z.object({ type: z.literal('notice'), message: z.string().min(1) }),
  /**
   * What a write action left behind, read back from the system of record after it ran: `confirmed`
   * when the read agrees, otherwise "could not check" with the reason. `target` is a registered page
   * element the avatar may point at; the host refreshes that part of its screen.
   */
  z.object({
    type: z.literal('effect'),
    /** The action that was checked. */
    id: z.string().min(1),
    tool: toolNameSchema,
    /** The read tool used. */
    readTool: toolNameSchema,
    confirmed: z.boolean(),
    summary: z.string().min(1),
    details: z.unknown().optional(),
    target: z.string().min(1).optional(),
  }),
]);
export type OperatorEvent = z.infer<typeof operatorEventSchema>;
