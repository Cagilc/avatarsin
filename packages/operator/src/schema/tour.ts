import { z } from 'zod';
import { engageIdSchema } from './engage.ts';

/**
 * A tour: the avatar walks the page, points at registered elements and explains, step by step,
 * without a model. Declared in the host manifest and shown only with `features.tours`.
 */

/** The id a host gave an element (`data-vex-id`, `registry.register`). */
export const elementIdSchema = z.string().regex(/^[A-Za-z][\w.-]{0,63}$/, 'id de elemento no válido');

/** Avatar states a step may ask for; `point` turns the arm towards the target. */
export const TOUR_POSES = ['point', 'talk', 'happy', 'wave', 'attention', 'celebrate'] as const;

export const tourStepSchema = z
  .strictObject({
    /** The element to point at. A step without one speaks from the panel. */
    target: elementIdSchema.optional(),
    say: z.string().min(1).max(400),
    pose: z.enum(TOUR_POSES).default('point'),
    /** What moves the tour on: the Next button, a click on the target, or typing in it. */
    advanceOn: z.enum(['next', 'click', 'input']).default('next'),
  })
  .refine((s) => s.advanceOn === 'next' || s.target !== undefined, { message: 'click e input necesitan un target', path: ['advanceOn'] });
export type TourStep = z.infer<typeof tourStepSchema>;

export const tourSchema = z.strictObject({
  id: engageIdSchema,
  title: z.string().min(1).max(80),
  roles: z.array(z.string().min(1).max(40)).min(1).max(20).optional(),
  /** `first`: starts by itself the first time the person opens the page; `manual`: offered in the tray. */
  when: z.enum(['manual', 'first']).default('manual'),
  steps: z.array(tourStepSchema).min(1).max(20),
});
export type Tour = z.infer<typeof tourSchema>;
export type TourInput = z.input<typeof tourSchema>;
