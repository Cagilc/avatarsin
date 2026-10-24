import { z } from 'zod';
import { actionOutcomeSchema, actionRequestSchema } from './action.ts';

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
]);
export type OperatorEvent = z.infer<typeof operatorEventSchema>;
