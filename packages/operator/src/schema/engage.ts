import { z } from 'zod';
import { toolNameSchema } from './action.ts';

/**
 * Announcements and quick actions: what a host shows its users without a model in the loop. Both
 * come from the host manifest (and connector approvals, for announcement drafts), are filtered by
 * the role in the token, and never widen anything: a quick action that calls a tool goes through
 * the same policy and confirmation as a call the model would make.
 */

export const engageIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'id: minúsculas, dígitos y guiones, empieza por letra');
const rolesSchema = z.array(z.string().min(1).max(40)).min(1).max(20);
const whenSchema = z.string().datetime();

/** What an announcement offers to do next. */
export const ctaSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('quickAction'), id: engageIdSchema }),
  z.strictObject({ kind: z.literal('link'), label: z.string().min(1).max(60), url: z.string().url().refine((u) => u.startsWith('https://'), 'solo enlaces https') }),
]);
export type Cta = z.infer<typeof ctaSchema>;

export const announcementSchema = z
  .strictObject({
    id: engageIdSchema,
    title: z.string().min(1).max(120),
    /** Plain text; the panel never renders it as HTML. */
    body: z.string().min(1).max(2000),
    since: whenSchema.optional(),
    until: whenSchema.optional(),
    /** Shown only to these roles (as the token says). Missing = everyone. */
    roles: rolesSchema.optional(),
    cta: ctaSchema.optional(),
    /** Written by a person, or drafted from a connector approval. */
    source: z.enum(['manual', 'connector']).default('manual'),
  })
  .refine((a) => !a.since || !a.until || Date.parse(a.until) > Date.parse(a.since), { message: 'until debe ser posterior a since', path: ['until'] });
export type Announcement = z.infer<typeof announcementSchema>;
export type AnnouncementInput = z.input<typeof announcementSchema>;

export const quickActionSchema = z
  .strictObject({
    id: engageIdSchema,
    label: z.string().min(1).max(40),
    icon: z.string().min(1).max(4).optional(),
    roles: rolesSchema.optional(),
    /** Text sent to the chat as if the user typed it. */
    prompt: z.string().min(1).max(400).optional(),
    /** A tool called directly with these params: same policy, same confirmation as the model. */
    tool: toolNameSchema.optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((q) => (q.prompt === undefined) !== (q.tool === undefined), { message: 'un botón lleva prompt o tool, no ambos ni ninguno' })
  .refine((q) => q.params === undefined || q.tool !== undefined, { message: 'params solo con tool', path: ['params'] });
export type QuickAction = z.infer<typeof quickActionSchema>;

/** Buttons shown at once, so the panel never turns into a toolbar. */
export const MAX_QUICK_ACTIONS = 6;

export interface Audience {
  role: string;
  nowMs: number;
}

/** Items the audience may see: their role (or any), within the dates. Order is kept. */
export function applicable<T extends { roles?: string[] | undefined; since?: string | undefined; until?: string | undefined }>(items: readonly T[], audience: Audience): T[] {
  return items.filter((it) => {
    if (it.roles && !it.roles.includes(audience.role)) return false;
    if (it.since && Date.parse(it.since) > audience.nowMs) return false;
    if (it.until && Date.parse(it.until) <= audience.nowMs) return false;
    return true;
  });
}
