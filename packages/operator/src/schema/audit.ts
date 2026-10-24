import { z } from 'zod';
import { actionOutcomeSchema, driverSchema, principalSchema, riskSchema, toolNameSchema } from './action.ts';

/** One line per action, whatever happened to it. The host persists these (JSONL, table…). */
export const auditEntrySchema = z.object({
  ts: z.string().datetime(),
  sessionId: z.string().min(1),
  principal: principalSchema,
  actionId: z.string().min(1),
  tool: toolNameSchema,
  driver: driverSchema,
  risk: riskSchema,
  params: z.record(z.string(), z.unknown()),
  summary: z.string(),
  /** What the user actually approved (recipient, subject…), when the action asked for confirmation. */
  details: z.record(z.string(), z.unknown()).optional(),
  outcome: actionOutcomeSchema,
  error: z.string().optional(),
  durationMs: z.number().nonnegative(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
