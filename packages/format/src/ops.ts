import { z } from 'zod';
import {
  capabilitiesSchema,
  clipSchema,
  idSchema,
  materialSchema,
  partSchema,
  personalitySchema,
  physicsSchema,
  sourceSchema,
  STATES,
  styleSchema,
  text,
  worldSchema,
  type Actor,
  type AvatarDocument,
} from './schema.ts';
import { parseDocument, type Issue } from './validate.ts';

/**
 * Every change to an avatar is one of these typed operations, whether it comes from the editor or
 * from the assistant. Nothing else can modify a document: the assistant never writes SVG, code or
 * raw JSON, it proposes operations that are validated exactly like a person's.
 */
const partPatchSchema = partSchema.omit({ id: true, physics: true, material: true }).partial();

export const opSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('setInfo'), name: text(80) }),
  z.strictObject({ op: z.literal('setCanvas'), width: z.number().min(16).max(4096), height: z.number().min(16).max(4096) }),
  z.strictObject({ op: z.literal('addSource'), source: sourceSchema }),
  z.strictObject({ op: z.literal('removeSource'), id: idSchema }),
  z.strictObject({ op: z.literal('addPart'), part: partSchema }),
  z.strictObject({ op: z.literal('updatePart'), id: idSchema, patch: partPatchSchema }),
  z.strictObject({ op: z.literal('removePart'), id: idSchema }),
  z.strictObject({ op: z.literal('setPhysics'), part: idSchema, physics: physicsSchema.nullable() }),
  z.strictObject({ op: z.literal('setMaterial'), part: idSchema, material: materialSchema.nullable() }),
  z.strictObject({ op: z.literal('setWorld'), world: worldSchema }),
  z.strictObject({ op: z.literal('setStyle'), style: styleSchema.partial() }),
  z.strictObject({ op: z.literal('putClip'), clip: clipSchema }),
  z.strictObject({ op: z.literal('removeClip'), id: idSchema }),
  z.strictObject({ op: z.literal('setState'), state: z.enum(STATES), clip: idSchema.nullable() }),
  z.strictObject({ op: z.literal('setPersonality'), patch: personalitySchema.partial() }),
  z.strictObject({ op: z.literal('setCapabilities'), capabilities: capabilitiesSchema.partial() }),
  /** Gives fixed values back to the assistant (the person's "let the AI decide"). */
  z.strictObject({ op: z.literal('release'), paths: z.array(z.string().max(120)).max(200) }),
]);
export type Op = z.infer<typeof opSchema>;
export type OpInput = z.input<typeof opSchema>;
export const opsSchema = z.array(opSchema).min(1).max(500);

/** Operations only a person may run. */
const PERSON_ONLY = new Set<Op['op']>(['setCapabilities', 'release']);

export interface ApplyMeta {
  /** For the assistant: how sure it is (shown next to the value in the editor). */
  confidence?: number;
  note?: string;
  /** For a person: false records the change as a default the assistant may still adjust (e.g. the parts of a fresh import). */
  lock?: boolean;
}

export type ApplyResult = { ok: true; doc: AvatarDocument; paths: string[] } | { ok: false; issues: Issue[] };

/** The provenance paths an operation writes. */
export function pathsOf(op: Op): string[] {
  switch (op.op) {
    case 'setInfo':
      return ['name'];
    case 'setCanvas':
      return ['canvas'];
    case 'addSource':
      return [`source:${op.source.id}`];
    case 'removeSource':
      return [`source:${op.id}`];
    case 'addPart':
      return [`part:${op.part.id}`, ...Object.keys(op.part).filter((k) => k !== 'id').map((k) => `part:${op.part.id}:${k}`)];
    case 'updatePart':
      return Object.keys(op.patch).map((k) => `part:${op.id}:${k}`);
    case 'removePart':
      return [`part:${op.id}`];
    case 'setPhysics':
      return [`part:${op.part}:physics`];
    case 'setMaterial':
      return [`part:${op.part}:material`];
    case 'setWorld':
      return ['world.gravity'];
    case 'setStyle':
      return Object.keys(op.style).map((k) => `style.${k}`);
    case 'putClip':
    case 'removeClip':
      return [`clip:${op.op === 'putClip' ? op.clip.id : op.id}`];
    case 'setState':
      return [`state:${op.state}`];
    case 'setPersonality':
      return Object.keys(op.patch).map((k) => `personality.${k}`);
    case 'setCapabilities':
      return Object.keys(op.capabilities).map((k) => `capabilities.${k}`);
    case 'release':
      return [];
  }
}

function lockedByPerson(doc: AvatarDocument, path: string): boolean {
  if (doc.provenance[path]?.by === 'user') return true;
  // Removing a part touches everything a person fixed on it.
  if (/^part:[^:]+$/.test(path)) return Object.entries(doc.provenance).some(([k, v]) => k.startsWith(`${path}:`) && v.by === 'user');
  return false;
}

function mutate(doc: AvatarDocument, op: Op): Issue | null {
  const findPart = (id: string) => doc.parts.find((p) => p.id === id);
  switch (op.op) {
    case 'setInfo':
      doc.name = op.name;
      return null;
    case 'setCanvas':
      doc.canvas = { width: op.width, height: op.height };
      return null;
    case 'addSource':
      if (doc.sources.some((s) => s.id === op.source.id)) return { path: 'sources', message: `Ya existe la fuente ${op.source.id}.` };
      doc.sources.push(op.source);
      return null;
    case 'removeSource':
      if (!doc.sources.some((s) => s.id === op.id)) return { path: 'sources', message: `No existe la fuente ${op.id}.` };
      if (doc.parts.some((p) => p.source === op.id)) return { path: 'sources', message: `La fuente ${op.id} aún tiene piezas.` };
      doc.sources = doc.sources.filter((s) => s.id !== op.id);
      return null;
    case 'addPart':
      if (findPart(op.part.id)) return { path: 'parts', message: `Ya existe la pieza ${op.part.id}.` };
      doc.parts.push(op.part);
      return null;
    case 'updatePart': {
      const part = findPart(op.id);
      if (!part) return { path: 'parts', message: `No existe la pieza ${op.id}.` };
      Object.assign(part, op.patch);
      return null;
    }
    case 'removePart': {
      const part = findPart(op.id);
      if (!part) return { path: 'parts', message: `No existe la pieza ${op.id}.` };
      for (const child of doc.parts) if (child.parent === op.id) child.parent = part.parent;
      doc.parts = doc.parts.filter((p) => p.id !== op.id);
      for (const clip of doc.clips) clip.tracks = clip.tracks.filter((t) => t.part !== op.id);
      return null;
    }
    case 'setPhysics':
    case 'setMaterial': {
      const part = findPart(op.part);
      if (!part) return { path: 'parts', message: `No existe la pieza ${op.part}.` };
      if (op.op === 'setPhysics') {
        if (op.physics === null) delete part.physics;
        else part.physics = op.physics;
      } else if (op.material === null) delete part.material;
      else part.material = op.material;
      return null;
    }
    case 'setWorld':
      doc.world = op.world;
      return null;
    case 'setStyle':
      doc.style = { ...doc.style, ...op.style };
      return null;
    case 'putClip': {
      const i = doc.clips.findIndex((c) => c.id === op.clip.id);
      if (i >= 0) doc.clips[i] = op.clip;
      else doc.clips.push(op.clip);
      return null;
    }
    case 'removeClip':
      if (!doc.clips.some((c) => c.id === op.id)) return { path: 'clips', message: `No existe la animación ${op.id}.` };
      doc.clips = doc.clips.filter((c) => c.id !== op.id);
      for (const state of STATES) if (doc.states[state] === op.id) delete doc.states[state];
      return null;
    case 'setState':
      if (op.clip === null) delete doc.states[op.state];
      else doc.states[op.state] = op.clip;
      return null;
    case 'setPersonality':
      doc.personality = { ...doc.personality, ...op.patch };
      return null;
    case 'setCapabilities':
      doc.capabilities = { ...doc.capabilities, ...op.capabilities };
      return null;
    case 'release':
      for (const path of op.paths) if (doc.provenance[path]?.by === 'user') doc.provenance[path] = { by: 'default' };
      return null;
  }
}

/**
 * Applies operations atomically: all of them or none. The result is validated as a whole document
 * (shape and references), and the assistant cannot touch a value a person fixed or run person-only
 * operations.
 */
export function applyOps(doc: AvatarDocument, rawOps: unknown, actor: Exclude<Actor, 'default'>, meta: ApplyMeta = {}): ApplyResult {
  const parsedOps = opsSchema.safeParse(rawOps);
  if (!parsedOps.success) return { ok: false, issues: parsedOps.error.issues.map((i) => ({ path: `ops.${i.path.join('.')}`, message: i.message })) };

  const next = structuredClone(doc);
  const written: string[] = [];
  for (const [i, op] of parsedOps.data.entries()) {
    if (actor === 'ai' && PERSON_ONLY.has(op.op)) return { ok: false, issues: [{ path: `ops.${i}`, message: `El asistente no puede ejecutar ${op.op}: solo una persona.` }] };
    const paths = pathsOf(op);
    if (actor === 'ai') {
      const locked = paths.find((p) => lockedByPerson(next, p));
      if (locked) return { ok: false, issues: [{ path: `ops.${i}`, message: `${locked} lo fijó una persona; el asistente no lo cambia.` }] };
    }
    const issue = mutate(next, op);
    if (issue) return { ok: false, issues: [{ ...issue, path: `ops.${i}: ${issue.path}` }] };

    if (op.op === 'removePart' || op.op === 'removeClip' || op.op === 'removeSource') {
      const prefix = paths[0]!;
      for (const key of Object.keys(next.provenance)) if (key === prefix || key.startsWith(`${prefix}:`)) delete next.provenance[key];
    } else {
      for (const p of paths) {
        next.provenance[p] = actor === 'ai' ? { by: 'ai', ...(meta.confidence !== undefined ? { confidence: meta.confidence } : {}), ...(meta.note ? { note: meta.note } : {}) } : { by: meta.lock === false ? 'default' : 'user' };
      }
    }
    written.push(...paths);
  }

  const checked = parseDocument(next);
  if (!checked.ok) return checked;
  return { ok: true, doc: checked.doc, paths: [...new Set(written)] };
}
