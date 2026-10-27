import { z } from 'zod';
import { engageIdSchema, rolesSchema } from './engage.ts';
import { TOUR_POSES, elementIdSchema } from './tour.ts';

/**
 * A demo script: scenes a presenter walks through at their own pace, with the keyboard, without a
 * model. A scene is a tour step (what the avatar says, where it points) that may also carry a
 * quick action to run on demand, through the same loop as any button: policy, confirmation,
 * audit. Declared in the host manifest and shown only with `features.presenter`.
 */
export const sceneSchema = z.strictObject({
  /** The element to point at. A scene without one speaks from the panel. */
  target: elementIdSchema.optional(),
  say: z.string().min(1).max(600),
  pose: z.enum(TOUR_POSES).default('talk'),
  /** A quick action (by id) the presenter fires with Enter or the button; never by itself. */
  action: engageIdSchema.optional(),
  /** For the presenter's eyes: what to say, what to click. Never shown to the audience. */
  notes: z.string().max(600).optional(),
});
export type Scene = z.infer<typeof sceneSchema>;

export const scriptSchema = z.strictObject({
  id: engageIdSchema,
  title: z.string().min(1).max(80),
  roles: rolesSchema.optional(),
  scenes: z.array(sceneSchema).min(1).max(40),
});
export type DemoScript = z.infer<typeof scriptSchema>;
export type DemoScriptInput = z.input<typeof scriptSchema>;

/** The host's hook that puts the demo data back as it was between rehearsals. Signed when it names a secret. */
export const presenterSchema = z.strictObject({
  reset: z.strictObject({ url: z.string().url(), secretEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'nombre de variable de entorno en mayúsculas').optional() }).optional(),
});
export type Presenter = z.infer<typeof presenterSchema>;
