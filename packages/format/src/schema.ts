import { z } from 'zod';

/**
 * The avatar document: the single source of truth. Everything else (the preview, the published
 * package, the embedded avatar) is derived from it. It holds data only: no scripts, no
 * expressions, no URLs. Every object is strict, so unknown keys are rejected rather than carried.
 */

export const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'Identificador no válido (minúsculas, números y guiones).');
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Huella SHA-256 no válida.');
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color no válido (#rrggbb).');

const unit = z.number().min(0).max(1);
const coord = z.number().min(-10_000).max(10_000);

/** Free text written by people: bounded and without control characters. */
export function text(max: number) {
  return z
    .string()
    .max(max)
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''));
}

export const pointSchema = z.strictObject({ x: coord, y: coord });
export const rectSchema = z.strictObject({ x: coord, y: coord, width: z.number().min(0).max(20_000), height: z.number().min(0).max(20_000) });
export type Point = z.infer<typeof pointSchema>;
export type Rect = z.infer<typeof rectSchema>;

/** An uploaded file, sanitized by the server and stored by its hash. */
export const sourceSchema = z.strictObject({
  id: idSchema,
  asset: hashSchema,
  kind: z.enum(['svg', 'png']),
  width: z.number().min(1).max(8192),
  height: z.number().min(1).max(8192),
  /** Where the source sits in the avatar canvas. */
  placement: z.strictObject({ x: coord, y: coord, scale: z.number().min(0.001).max(100) }),
});
export type Source = z.infer<typeof sourceSchema>;

/**
 * Secondary motion of a part around its pivot. Values are normalized (0–1) so the editor can show
 * them as sliders; a missing value follows the avatar's style (see `resolve.ts`).
 */
export const physicsSchema = z.strictObject({
  enabled: z.boolean(),
  /** 0 floppy · 1 stiff. */
  stiffness: unit.optional(),
  /** 0 keeps bouncing · 1 settles at once. */
  damping: unit.optional(),
  /** 0 light · 1 heavy (more inertia). */
  weight: unit.optional(),
  /** How much gravity bends the part (0 none · 1 hangs). */
  gravity: unit.optional(),
  /** Maximum swing either side, in degrees. */
  limit: z.number().min(0).max(180).optional(),
});
export type Physics = z.infer<typeof physicsSchema>;

export const FINISHES = ['flat', 'matte', 'satin', 'gloss', 'metal'] as const;
export const TEXTURES = ['none', 'grain', 'fabric', 'paper', 'noise'] as const;

export const materialSchema = z.strictObject({
  finish: z.enum(FINISHES).optional(),
  texture: z.enum(TEXTURES).optional(),
  textureStrength: unit.optional(),
  /** Soft drop shadow (0 none). */
  shadow: unit.optional(),
  outline: z.strictObject({ width: z.number().min(0).max(20), color: colorSchema }).nullable().optional(),
  tint: colorSchema.nullable().optional(),
});
export type Material = z.infer<typeof materialSchema>;

export const ROLES = ['body', 'head', 'face', 'eye', 'mouth', 'arm', 'hand', 'leg', 'ear', 'antenna', 'tail', 'hair', 'accessory', 'text', 'background', 'other'] as const;
export type Role = (typeof ROLES)[number];

export const partSchema = z.strictObject({
  id: idSchema,
  name: text(60),
  source: idSchema,
  /** SVG sources: element paths (child indices from the root) drawn by this part. Empty = the whole file. */
  nodes: z.array(z.array(z.number().int().min(0).max(4999)).min(1).max(12)).max(500).optional(),
  /** PNG sources: the region of the image drawn by this part, in source pixels. */
  crop: rectSchema.optional(),
  /** Bounds in canvas coordinates at rest (measured by the editor). */
  bbox: rectSchema,
  /** Rotation and scale centre, in canvas coordinates at rest. */
  pivot: pointSchema,
  parent: idSchema.nullable(),
  z: z.number().int().min(-1000).max(1000),
  role: z.enum(ROLES).optional(),
  visible: z.boolean(),
  physics: physicsSchema.optional(),
  material: materialSchema.optional(),
});
export type Part = z.infer<typeof partSchema>;

export const PROPS = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'opacity'] as const;
export type Prop = (typeof PROPS)[number];
export const EASES = ['linear', 'in', 'out', 'inOut', 'step'] as const;
export type Ease = (typeof EASES)[number];

export const keySchema = z.strictObject({
  /** Normalized time, 0–1 of the clip duration. */
  t: unit,
  v: z.number().min(-10_000).max(10_000),
  ease: z.enum(EASES),
});
export const trackSchema = z.strictObject({
  part: idSchema,
  prop: z.enum(PROPS),
  keys: z.array(keySchema).min(1).max(100),
});
export const clipSchema = z.strictObject({
  id: idSchema,
  name: text(60),
  /** Seconds. */
  duration: z.number().min(0.05).max(60),
  loop: z.boolean(),
  tracks: z.array(trackSchema).max(200),
});
export type Key = z.infer<typeof keySchema>;
export type Track = z.infer<typeof trackSchema>;
export type Clip = z.infer<typeof clipSchema>;

/**
 * The states the host drives (same vocabulary as the Vex operator's director). `point` and
 * `celebrate` serve the tours: the runtime aims the pointing arm at a direction the host gives.
 */
export const STATES = ['idle', 'talk', 'think', 'happy', 'wave', 'attention', 'error', 'sleep', 'point', 'celebrate'] as const;
export type StateName = (typeof STATES)[number];
export const statesSchema = z.strictObject(Object.fromEntries(STATES.map((s) => [s, idSchema.optional()])) as Record<StateName, z.ZodOptional<typeof idSchema>>);

export const worldSchema = z.strictObject({
  gravity: z.strictObject({
    /** 0 floating · 1 Earth-like · up to 3 heavy cartoon gravity. */
    strength: z.number().min(0).max(3),
    /** Direction in degrees; 90 = down. */
    angle: z.number().min(-180).max(180),
  }),
});

export const styleSchema = z.strictObject({
  /** 0 flat cartoon · 1 realistic. Drives the defaults of physics and materials. */
  realism: unit,
  /** Squash and stretch on impacts; missing = from realism. */
  squash: unit.optional(),
});

export const TONES = ['cercano', 'profesional', 'divertido', 'serio', 'entusiasta'] as const;
export const LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;

/** How the avatar talks. It never changes what the avatar may do: that is `capabilities`. */
export const personalitySchema = z.strictObject({
  displayName: text(40),
  tone: z.enum(TONES),
  formality: unit,
  verbosity: unit,
  emoji: z.boolean(),
  greeting: text(200),
  about: text(1000),
  language: z.enum(LANGUAGES),
});
export type Personality = z.infer<typeof personalitySchema>;

export const toolNameSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/, 'Nombre de herramienta no válido.');
export const RISKS = ['read', 'write', 'irreversible'] as const;
export type Risk = (typeof RISKS)[number];

/**
 * What the avatar may do as an operator. An integration can only narrow this further (see the
 * server's embed keys); nothing in the document can widen what an administrator approved.
 */
export const capabilitiesSchema = z.strictObject({
  tools: z.array(toolNameSchema).max(200),
  maxRisk: z.enum(RISKS),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

export const ACTORS = ['user', 'ai', 'default'] as const;
export type Actor = (typeof ACTORS)[number];
export const provenanceEntrySchema = z.strictObject({
  by: z.enum(ACTORS),
  confidence: unit.optional(),
  note: text(200).optional(),
});
export type ProvenanceEntry = z.infer<typeof provenanceEntrySchema>;

export const LIMITS = { sources: 20, parts: 200, clips: 50, provenance: 2000 } as const;

export const documentSchema = z.strictObject({
  format: z.literal('vex-avatar'),
  schemaVersion: z.literal(1),
  id: idSchema,
  name: text(80),
  canvas: z.strictObject({ width: z.number().min(16).max(4096), height: z.number().min(16).max(4096) }),
  sources: z.array(sourceSchema).max(LIMITS.sources),
  parts: z.array(partSchema).max(LIMITS.parts),
  world: worldSchema,
  style: styleSchema,
  clips: z.array(clipSchema).max(LIMITS.clips),
  states: statesSchema,
  personality: personalitySchema,
  capabilities: capabilitiesSchema,
  /** Who set each value: the person, the assistant, or nobody (a default). Keyed by path. */
  provenance: z.record(z.string().max(120), provenanceEntrySchema).refine((r) => Object.keys(r).length <= LIMITS.provenance, 'Demasiadas entradas de procedencia.'),
});
export type AvatarDocument = z.infer<typeof documentSchema>;
export type AvatarDocumentInput = z.input<typeof documentSchema>;

export function emptyDocument(id: string, name: string): AvatarDocument {
  return {
    format: 'vex-avatar',
    schemaVersion: 1,
    id,
    name,
    canvas: { width: 512, height: 512 },
    sources: [],
    parts: [],
    world: { gravity: { strength: 1, angle: 90 } },
    style: { realism: 0.3 },
    clips: [],
    states: {},
    personality: {
      displayName: name,
      tone: 'cercano',
      formality: 0.4,
      verbosity: 0.4,
      emoji: false,
      greeting: '¡Hola! ¿En qué te ayudo?',
      about: '',
      language: 'es',
    },
    capabilities: { tools: [], maxRisk: 'read' },
    provenance: {},
  };
}
