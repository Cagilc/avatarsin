import { z } from 'zod';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/** The 9 colours of the Vex rig, overridable per host/user without touching the SVG. */
export const vexThemeSchema = z.object({
  body: hex,
  shade: hex,
  outline: hex,
  joint: hex,
  light: hex,
  visor: hex,
  hands: hex,
  accent: hex,
  background: hex,
});
export type VexTheme = z.infer<typeof vexThemeSchema>;

/** How Vex behaves, independent of how it looks. Read by the host's director. */
export const vexPersonalitySchema = z.object({
  /** Shown under the avatar and used in greetings. */
  name: z.string().min(1).max(32),
  /** Short style guide injected into the system prompt ("cercano, directo, sin emojis"). */
  tone: z.string().max(400),
  /** Whether Vex waves on load. */
  greets: z.boolean(),
  /** Milliseconds Vex keeps "talking" after a reply before settling. */
  talkMs: z.number().int().min(0).max(10_000),
});
export type VexPersonality = z.infer<typeof vexPersonalitySchema>;
