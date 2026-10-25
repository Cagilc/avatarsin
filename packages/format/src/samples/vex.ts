import type { Op } from '../ops.ts';
import type { Ease, Physics, Prop, Rect, Role, StateName, Track } from '../schema.ts';

/**
 * Vex, the operator's own avatar, as a document of this format: the hand-drawn rig
 * (assets/vex-2d, flattened into apps/studio/public/samples/vex.svg) becomes 37 parts with the
 * rig's pivots and skeleton, and its poses, faces and visemes become the clips of the 8 states.
 *
 * Faces and visemes need nothing new in the format: each eye and mouth variant is a part of its
 * own, and the clips switch them with stepped opacity tracks. `talk` cycles the nine mouth shapes
 * of the old director; the other states pick the face the old rig gave them.
 */

export const VEX_RIG = { width: 400, height: 500 } as const;

export interface VexPartDef {
  id: string;
  /** The group's id in vex.svg. */
  rig: string;
  name: string;
  parent: string | null;
  /** In rig coordinates (400×500). */
  pivot: readonly [number, number];
  role: Role;
  z: number;
  physics?: Physics;
}

const FIN_PHYSICS: Physics = { enabled: true, stiffness: 0.6, damping: 0.5, weight: 0.3, gravity: 0, limit: 20 };

export const VEX_EYES = ['neutral', 'happy', 'thinking', 'wow', 'success'] as const;
export const VEX_MOUTHS = ['neutral', 'happy', 'thinking', 'wow', 'success'] as const;
/** Rhubarb mouth shapes, lower-cased for part ids. */
export const VEX_VISEMES = ['x', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export const VEX_PARTS: readonly VexPartDef[] = [
  { id: 'llama', rig: 'vx-flame', name: 'Llama', parent: 'propulsor', pivot: [200, 408], role: 'other', z: 0 },
  { id: 'propulsor', rig: 'vx-thruster', name: 'Propulsor', parent: 'torso', pivot: [200, 384], role: 'other', z: 1 },
  { id: 'torso', rig: 'vx-torso', name: 'Torso', parent: null, pivot: [200, 384], role: 'body', z: 2 },
  { id: 'nucleo', rig: 'vx-core', name: 'Núcleo', parent: 'torso', pivot: [200, 318], role: 'other', z: 3 },
  { id: 'brazo-izq', rig: 'vx-arm-L', name: 'Brazo izquierdo', parent: 'torso', pivot: [146, 290], role: 'arm', z: 4 },
  { id: 'codo-izq', rig: 'vx-elbow-L', name: 'Antebrazo izquierdo', parent: 'brazo-izq', pivot: [146, 346], role: 'arm', z: 5 },
  { id: 'mano-izq', rig: 'vx-hand-L', name: 'Mano izquierda', parent: 'codo-izq', pivot: [146, 394], role: 'hand', z: 6 },
  { id: 'brazo-der', rig: 'vx-arm-R', name: 'Brazo derecho', parent: 'torso', pivot: [254, 290], role: 'arm', z: 4 },
  { id: 'codo-der', rig: 'vx-elbow-R', name: 'Antebrazo derecho', parent: 'brazo-der', pivot: [254, 346], role: 'arm', z: 5 },
  { id: 'mano-der', rig: 'vx-hand-R', name: 'Mano derecha', parent: 'codo-der', pivot: [254, 394], role: 'hand', z: 6 },
  { id: 'hombros', rig: 'vx-hover', name: 'Hombros', parent: 'torso', pivot: [200, 290], role: 'body', z: 7 },
  { id: 'cabeza', rig: 'vx-head', name: 'Cabeza', parent: 'torso', pivot: [200, 262], role: 'head', z: 8 },
  { id: 'aleta-izq', rig: 'vx-fin-L', name: 'Aleta izquierda', parent: 'cabeza', pivot: [104, 118], role: 'antenna', z: 9, physics: FIN_PHYSICS },
  { id: 'aleta-der', rig: 'vx-fin-R', name: 'Aleta derecha', parent: 'cabeza', pivot: [296, 118], role: 'antenna', z: 9, physics: FIN_PHYSICS },
  { id: 'oreja-izq', rig: 'vx-ear-L', name: 'Oreja izquierda', parent: 'cabeza', pivot: [92, 156], role: 'ear', z: 10 },
  { id: 'oreja-der', rig: 'vx-ear-R', name: 'Oreja derecha', parent: 'cabeza', pivot: [308, 156], role: 'ear', z: 10 },
  { id: 'casco', rig: 'vx-helmet', name: 'Casco', parent: 'cabeza', pivot: [200, 150], role: 'head', z: 11 },
  { id: 'visor', rig: 'vx-visor', name: 'Visor', parent: 'cabeza', pivot: [200, 158], role: 'face', z: 12 },
  ...VEX_EYES.map((v): VexPartDef => ({ id: `ojos-${v}`, rig: `vx-eyes-${v}`, name: `Ojos · ${v}`, parent: 'cabeza', pivot: [200, 150], role: 'eye', z: 13 })),
  ...VEX_MOUTHS.map((v): VexPartDef => ({ id: `boca-${v}`, rig: `vx-mouth-${v}`, name: `Boca · ${v}`, parent: 'cabeza', pivot: [200, 190], role: 'mouth', z: 14 })),
  ...VEX_VISEMES.map((v): VexPartDef => ({ id: `visema-${v}`, rig: `vx-vis-${v.toUpperCase()}`, name: `Visema ${v.toUpperCase()}`, parent: 'cabeza', pivot: [200, 190], role: 'mouth', z: 14 })),
];

const FACE_PARTS = [...VEX_EYES.map((v) => `ojos-${v}`), ...VEX_MOUTHS.map((v) => `boca-${v}`), ...VEX_VISEMES.map((v) => `visema-${v}`)];

/** Joint angles of the old rig, degrees, clockwise positive. */
interface Pose {
  armL: number;
  elbowL: number;
  armR: number;
  elbowR: number;
  head: number;
  finL: number;
  finR: number;
}
const POSES = {
  idle: { armL: 12, elbowL: -8, armR: -12, elbowR: 8, head: 0, finL: 0, finR: 0 },
  listening: { armL: 10, elbowL: -6, armR: -10, elbowR: 6, head: -6, finL: 10, finR: -10 },
  thinking: { armL: 12, elbowL: -8, armR: -20, elbowR: -150, head: 8, finL: -6, finR: 6 },
  talking: { armL: 18, elbowL: -22, armR: -16, elbowR: 20, head: -3, finL: 0, finR: 0 },
  greeting: { armL: 12, elbowL: -8, armR: -125, elbowR: -20, head: -5, finL: 4, finR: -4 },
  success: { armL: 120, elbowL: 15, armR: -120, elbowR: -15, head: 0, finL: 8, finR: -8 },
} satisfies Record<string, Pose>;
const JOINT: Record<keyof Pose, string> = { armL: 'brazo-izq', elbowL: 'codo-izq', armR: 'brazo-der', elbowR: 'codo-der', head: 'cabeza', finL: 'aleta-izq', finR: 'aleta-der' };

/** The mouth shapes the old director cycled while talking. */
const TALK_SEQUENCE = ['d', 'b', 'c', 'a', 'e', 'b', 'h', 'c', 'x'] as const;

type K = [t: number, v: number, ease?: Ease];
const track = (part: string, prop: Prop, keys: K[]): Track => ({ part, prop, keys: keys.map(([t, v, ease]) => ({ t, v, ease: ease ?? 'inOut' })) });
const hold = (part: string, prop: Prop, v: number): Track => track(part, prop, [[0, v, 'step']]);

function poseTracks(pose: Pose, except: ReadonlySet<string> = new Set()): Track[] {
  return (Object.keys(pose) as Array<keyof Pose>).filter((j) => !except.has(JOINT[j])).map((j) => hold(JOINT[j], 'rotate', pose[j]));
}

/**
 * Shows one eye and one mouth variant; every other face part is hidden. With `mouth: null` the
 * plain mouths are hidden and the visemes are left to `visemeTracks`, so each part keeps one track.
 */
function faceTracks(eyes: (typeof VEX_EYES)[number], mouth: (typeof VEX_MOUTHS)[number] | null): Track[] {
  return FACE_PARTS.filter((id) => mouth !== null || !id.startsWith('visema-')).map((id) => hold(id, 'opacity', id === `ojos-${eyes}` || id === `boca-${mouth}` ? 1 : 0));
}

/** The nine visemes take turns through the clip, stepped. */
function visemeTracks(): Track[] {
  return VEX_VISEMES.map((v) => track(`visema-${v}`, 'opacity', TALK_SEQUENCE.map((slot, i): K => [i / TALK_SEQUENCE.length, slot === v ? 1 : 0, 'step'])));
}

export interface VexSampleInput {
  sourceId: string;
  asset: string;
  /** Pixel size the server reported for the sanitized SVG. */
  width: number;
  height: number;
  placement: { x: number; y: number; scale: number };
  /** Child-index path of each rig group (`VexPartDef.rig`) in the sanitized SVG. */
  paths: Record<string, number[]>;
  /** Bounds of each rig group in canvas coordinates, measured by the editor. Missing = a box around the pivot. */
  bboxes?: Record<string, Rect>;
  /** First source of the document: sets the canvas and the avatar's identity. */
  first: boolean;
  canvas?: { width: number; height: number };
}

/** The clips of the 8 states, scaled to the canvas. */
export function vexClips(scale: number): Array<{ state: StateName; clip: Op & { op: 'putClip' } }> {
  const s = scale;
  const clip = (state: StateName, name: string, duration: number, loop: boolean, tracks: Track[]) => ({ state, clip: { op: 'putClip' as const, clip: { id: `vex-${state}`, name, duration, loop, tracks } } });
  const flicker: K[] = Array.from({ length: 13 }, (_, i): K => [i / 12, i % 3 === 0 ? 1 : i % 3 === 1 ? 1.22 : 0.9, 'linear']);
  return [
    clip('idle', 'Reposo', 2.4, true, [
      ...poseTracks(POSES.idle, new Set(['aleta-izq', 'aleta-der'])),
      ...faceTracks('neutral', 'neutral'),
      track('torso', 'y', [[0, 0], [0.5, -6 * s], [1, 0]]),
      track('aleta-izq', 'rotate', [[0, 0], [0.5, -5], [1, 0]]),
      track('aleta-der', 'rotate', [[0, 0], [0.5, 5], [1, 0]]),
      track('nucleo', 'opacity', [[0, 1], [0.375, 0.55], [0.75, 1], [1, 0.78]]),
      track('llama', 'scaleY', flicker),
    ]),
    clip('talk', 'Hablando', 1, true, [...poseTracks(POSES.talking), ...faceTracks('happy', null), ...visemeTracks(), track('torso', 'y', [[0, 0], [0.5, -2 * s], [1, 0]])]),
    clip('think', 'Pensando', 2.6, true, [...poseTracks(POSES.thinking, new Set(['cabeza'])), ...faceTracks('thinking', 'thinking'), track('cabeza', 'rotate', [[0, 8], [0.5, 11], [1, 8]])]),
    clip('happy', 'Contento', 0.9, true, [
      ...poseTracks(POSES.success),
      ...faceTracks('success', 'success'),
      track('torso', 'y', [[0, 0, 'out'], [0.4, -30 * s, 'in'], [0.75, 0, 'out'], [1, 0]]),
      track('torso', 'scaleY', [[0, 0.94], [0.15, 1.06], [0.4, 1], [0.75, 0.94], [1, 0.94]]),
    ]),
    clip('wave', 'Saludando', 1.2, true, [...poseTracks(POSES.greeting, new Set(['codo-der'])), ...faceTracks('happy', 'happy'), track('codo-der', 'rotate', [[0, -20], [0.25, -55], [0.5, -20], [0.75, -55], [1, -20]])]),
    clip('attention', 'Atento', 0.8, true, [...poseTracks(POSES.listening), ...faceTracks('neutral', 'neutral'), track('torso', 'y', [[0, 0, 'out'], [0.4, -8 * s, 'inOut'], [1, 0]])]),
    clip('error', 'Error', 0.5, false, [...poseTracks(POSES.idle), ...faceTracks('wow', 'wow'), track('torso', 'x', [[0, 0], [0.15, 8 * s], [0.35, -8 * s], [0.55, 5 * s], [0.75, -3 * s], [1, 0]])]),
    clip('sleep', 'Dormido', 4, true, [...poseTracks(POSES.idle, new Set(['cabeza'])), ...faceTracks('happy', 'neutral'), track('cabeza', 'rotate', [[0, 6], [0.5, 9], [1, 6]]), track('torso', 'scaleY', [[0, 0.98], [0.5, 1], [1, 0.98]])]),
  ];
}

/** Everything that turns an empty document into Vex: source, parts, clips, states, style and personality. */
export function vexSampleOps(input: VexSampleInput): Op[] {
  const { placement } = input;
  const toCanvas = (p: readonly [number, number]) => ({ x: placement.x + placement.scale * p[0], y: placement.y + placement.scale * p[1] });
  const ops: Op[] = [];
  if (input.first) {
    const canvas = input.canvas ?? { width: 512, height: 512 };
    ops.push({ op: 'setCanvas', width: canvas.width, height: canvas.height }, { op: 'setInfo', name: 'Vex' });
  }
  ops.push({ op: 'addSource', source: { id: input.sourceId, asset: input.asset, kind: 'svg', width: input.width, height: input.height, placement } });
  for (const def of VEX_PARTS) {
    const path = input.paths[def.rig];
    if (!path) throw new Error(`Falta el grupo ${def.rig} en el SVG de Vex.`);
    const pivot = toCanvas(def.pivot);
    const half = 20 * placement.scale;
    const bbox = input.bboxes?.[def.rig] ?? { x: pivot.x - half, y: pivot.y - half, width: 2 * half, height: 2 * half };
    ops.push({
      op: 'addPart',
      part: { id: def.id, name: def.name, source: input.sourceId, nodes: [path], bbox, pivot, parent: def.parent, z: def.z, role: def.role, visible: true, ...(def.physics ? { physics: def.physics } : {}) },
    });
  }
  for (const { state, clip } of vexClips(placement.scale)) ops.push(clip, { op: 'setState', state, clip: clip.clip.id });
  ops.push({ op: 'setStyle', style: { realism: 0.25 } });
  if (input.first) {
    ops.push({
      op: 'setPersonality',
      patch: { displayName: 'Vex', tone: 'cercano', formality: 0.3, verbosity: 0.4, emoji: false, greeting: '¡Hola! Soy Vex. ¿Qué hacemos?', about: 'El operador: hace cosas en la plataforma con los permisos de quien ha iniciado sesión y pide confirmación para lo irreversible.', language: 'es' },
    });
  }
  return ops;
}
