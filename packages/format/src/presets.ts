import type { Op } from './ops.ts';
import { effectiveSquash } from './resolve.ts';
import type { AvatarDocument, Clip, Ease, Part, Prop, StateName, Track } from './schema.ts';

/**
 * Starting animations for each state, built from the avatar's own skeleton and scaled by its
 * style. They are ordinary clips: the person or the assistant can edit them afterwards.
 */

export interface Targets {
  root: string;
  head?: string;
  arm?: string;
}

const area = (p: Part) => p.bbox.width * p.bbox.height;

export function defaultTargets(doc: AvatarDocument): Targets | null {
  const roots = doc.parts.filter((p) => p.parent === null && p.role !== 'background');
  const root = [...roots].sort((a, b) => area(b) - area(a))[0] ?? doc.parts[0];
  if (!root) return null;
  const head = doc.parts.find((p) => p.role === 'head');
  const arm = doc.parts.find((p) => p.role === 'arm' || p.role === 'hand');
  return { root: root.id, ...(head ? { head: head.id } : {}), ...(arm ? { arm: arm.id } : {}) };
}

type K = [t: number, v: number, ease?: Ease];
const track = (part: string, prop: Prop, keys: K[]): Track => ({ part, prop, keys: keys.map(([t, v, ease]) => ({ t, v, ease: ease ?? 'inOut' })) });

export function presetClip(state: StateName, doc: AvatarDocument, targets: Targets): Clip {
  const r = doc.style.realism;
  // Cartoon moves more; realistic is subtler.
  const amp = 1.4 - 0.7 * r;
  const squash = effectiveSquash(doc);
  const { root } = targets;
  const head = targets.head ?? root;
  const h = doc.canvas.height;
  const id = `auto-${state}`;
  switch (state) {
    case 'idle':
      return {
        id, name: 'Reposo', duration: 3.2, loop: true,
        tracks: [
          track(root, 'scaleY', [[0, 1], [0.5, 1 + 0.03 * amp], [1, 1]]),
          track(root, 'scaleX', [[0, 1], [0.5, 1 - 0.012 * amp * squash], [1, 1]]),
          track(head, 'rotate', [[0, -1.5 * amp], [0.5, 1.5 * amp], [1, -1.5 * amp]]),
        ],
      };
    case 'talk':
      return {
        id, name: 'Hablando', duration: 1.2, loop: true,
        tracks: [
          track(head, 'rotate', [[0, 0], [0.25, 3 * amp], [0.5, -2 * amp], [0.75, 2.5 * amp], [1, 0]]),
          track(root, 'scaleY', [[0, 1], [0.2, 1 + 0.02 * amp], [0.45, 1], [0.7, 1 + 0.02 * amp], [1, 1]]),
        ],
      };
    case 'think':
      return {
        id, name: 'Pensando', duration: 2.6, loop: true,
        tracks: [
          track(head, 'rotate', [[0, 0], [0.3, 8 * amp], [0.7, 8 * amp], [1, 0]]),
          track(root, 'y', [[0, 0], [0.5, -0.01 * h * amp], [1, 0]]),
        ],
      };
    case 'happy': {
      const jump = -0.06 * h * amp;
      return {
        id, name: 'Contento', duration: 0.9, loop: true,
        tracks: [
          track(root, 'y', [[0, 0, 'out'], [0.4, jump, 'in'], [0.75, 0, 'out'], [1, 0]]),
          track(root, 'scaleY', [[0, 1 - 0.15 * squash], [0.15, 1 + 0.1 * squash], [0.4, 1], [0.75, 1 - 0.15 * squash], [1, 1 - 0.15 * squash]]),
          track(root, 'scaleX', [[0, 1 + 0.12 * squash], [0.15, 1 - 0.06 * squash], [0.4, 1], [0.75, 1 + 0.12 * squash], [1, 1 + 0.12 * squash]]),
        ],
      };
    }
    case 'wave': {
      const who = targets.arm ?? root;
      const swing = targets.arm ? 28 : 7;
      return {
        id, name: 'Saludando', duration: 1.2, loop: true,
        tracks: [track(who, 'rotate', [[0, -swing * 0.3 * amp], [0.25, swing * amp], [0.5, -swing * 0.3 * amp], [0.75, swing * amp], [1, -swing * 0.3 * amp]])],
      };
    }
    case 'attention':
      return {
        id, name: 'Atento', duration: 0.6, loop: false,
        tracks: [
          track(root, 'y', [[0, 0, 'out'], [0.35, -0.03 * h * amp, 'inOut'], [1, 0]]),
          track(root, 'scaleY', [[0, 1], [0.35, 1 + 0.06 * amp], [1, 1]]),
        ],
      };
    case 'error':
      return {
        id, name: 'Error', duration: 0.5, loop: false,
        tracks: [track(root, 'x', [[0, 0], [0.15, 0.02 * h], [0.35, -0.02 * h], [0.55, 0.012 * h], [0.75, -0.008 * h], [1, 0]])],
      };
    case 'sleep':
      return {
        id, name: 'Dormido', duration: 4, loop: true,
        tracks: [
          track(head, 'rotate', [[0, 6], [0.5, 9], [1, 6]]),
          track(root, 'scaleY', [[0, 0.98], [0.5, 1.0], [1, 0.98]]),
        ],
      };
    case 'point': {
      // The arm goes up and holds; the runtime turns it towards what the host points at (`aim`).
      const who = targets.arm ?? head;
      const lift = targets.arm ? -80 : -8;
      return {
        id, name: 'Señalando', duration: 1.6, loop: true,
        tracks: [
          track(who, 'rotate', [[0, lift * amp], [0.5, (lift - 4) * amp], [1, lift * amp]]),
          track(head, 'rotate', [[0, -3 * amp], [0.5, -4 * amp], [1, -3 * amp]]),
        ],
      };
    }
    case 'celebrate': {
      const jump = -0.08 * h * amp;
      return {
        id, name: 'Celebrando', duration: 1, loop: false,
        tracks: [
          track(root, 'y', [[0, 0, 'out'], [0.3, jump, 'in'], [0.6, 0, 'out'], [0.8, jump * 0.4, 'in'], [1, 0]]),
          track(root, 'scaleY', [[0, 1 - 0.12 * squash], [0.15, 1 + 0.1 * squash], [0.6, 1 - 0.08 * squash], [0.75, 1 + 0.05 * squash], [1, 1]]),
          track(head, 'rotate', [[0, 0], [0.25, 10 * amp], [0.5, -10 * amp], [0.75, 6 * amp], [1, 0]]),
        ],
      };
    }
  }
}

/** Operations that give every state its starting animation. */
export function presetOps(doc: AvatarDocument, states: readonly StateName[], targets = defaultTargets(doc)): Op[] {
  if (!targets) return [];
  return states.flatMap((state): Op[] => [
    { op: 'putClip', clip: presetClip(state, doc, targets) },
    { op: 'setState', state, clip: `auto-${state}` },
  ]);
}
