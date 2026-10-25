import type { Clip, Ease, Prop, Track } from '@vexstudio/format';

export interface Local {
  rotate: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

export const REST: Readonly<Local> = { rotate: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 };

/** Local transforms per part id; parts without tracks stay at rest. */
export type Sample = Map<string, Local>;

function ease(kind: Ease, t: number): number {
  switch (kind) {
    case 'linear':
      return t;
    case 'in':
      return t * t;
    case 'out':
      return 1 - (1 - t) * (1 - t);
    case 'inOut':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    case 'step':
      return 0;
  }
}

/** Value of a track at normalized time u (0–1). Each key's ease shapes the way to the next key. */
export function sampleTrack(track: Track, u: number): number {
  const keys = track.keys;
  const first = keys[0]!;
  if (u <= first.t) return first.v;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (u <= b.t) {
      if (u === b.t) return b.v;
      const a = keys[i - 1]!;
      const span = b.t - a.t;
      const k = span <= 0 ? 1 : ease(a.ease, (u - a.t) / span);
      return a.v + (b.v - a.v) * k;
    }
  }
  return keys[keys.length - 1]!.v;
}

/** Normalized time of a clip after `seconds` of playback. */
export function clipPhase(clip: Clip, seconds: number): number {
  const u = seconds / clip.duration;
  return clip.loop ? u - Math.floor(u) : Math.min(1, Math.max(0, u));
}

export function sampleClip(clip: Clip, seconds: number, out: Sample = new Map()): Sample {
  const u = clipPhase(clip, seconds);
  for (const track of clip.tracks) {
    const local = out.get(track.part) ?? { ...REST };
    local[track.prop as Prop] = sampleTrack(track, u);
    out.set(track.part, local);
  }
  return out;
}

/** Cross-fade between two samples (w = 0 → a, 1 → b). */
export function blend(a: Sample, b: Sample, w: number): Sample {
  const out: Sample = new Map();
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(id) ?? REST;
    const y = b.get(id) ?? REST;
    out.set(id, {
      rotate: x.rotate + (y.rotate - x.rotate) * w,
      x: x.x + (y.x - x.x) * w,
      y: x.y + (y.y - x.y) * w,
      scaleX: x.scaleX + (y.scaleX - x.scaleX) * w,
      scaleY: x.scaleY + (y.scaleY - x.scaleY) * w,
      opacity: x.opacity + (y.opacity - x.opacity) * w,
    });
  }
  return out;
}
