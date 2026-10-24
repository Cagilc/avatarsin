import { z } from 'zod';

/**
 * Risk level of an action. It decides the permission flow:
 * read → runs silently · write → runs, reversible by the host · irreversible → needs the user's OK.
 */
export const riskSchema = z.enum(['read', 'write', 'irreversible']);
export type Risk = z.infer<typeof riskSchema>;

/** Which "hands" execute the action. Fidelity order for the router: platform > studio > dom > files > windows. */
export const driverSchema = z.enum(['platform', 'studio', 'dom', 'files', 'windows']);
export type Driver = z.infer<typeof driverSchema>;

export const toolNameSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'snake_case tool name');

/** Who the operator acts as. It never has more power than this person. */
export const principalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
});
export type Principal = z.infer<typeof principalSchema>;

/** A tool call the model asked for, after validation against the tool's input schema. */
export const actionRequestSchema = z.object({
  id: z.string().min(1),
  tool: toolNameSchema,
  driver: driverSchema,
  risk: riskSchema,
  params: z.record(z.string(), z.unknown()),
  /** One human sentence: what will happen if this runs ("Enviar correo a laura@… con asunto …"). */
  summary: z.string().min(1),
  /** What will really happen, read from the system of record (recipient, subject…). Filled for confirmations. */
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

export const actionOutcomeSchema = z.enum(['ok', 'error', 'denied', 'rejected', 'invalid', 'cancelled']);
export type ActionOutcome = z.infer<typeof actionOutcomeSchema>;

export const actionResultSchema = z.object({
  id: z.string().min(1),
  outcome: actionOutcomeSchema,
  /** Data for the model on success; the error message otherwise. */
  data: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().nonnegative(),
});
export type ActionResult = z.infer<typeof actionResultSchema>;
