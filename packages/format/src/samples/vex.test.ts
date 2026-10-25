import { describe, expect, it } from 'vitest';
import { applyOps } from '../ops.ts';
import { STATES, emptyDocument, type Clip } from '../schema.ts';
import { checkReferences } from '../validate.ts';
import { VEX_PARTS, VEX_VISEMES, vexSampleOps } from './vex.ts';

const PLACEMENT = { x: 84, y: 41, scale: 0.86 };

function vex() {
  const paths = Object.fromEntries(VEX_PARTS.map((p, i) => [p.rig, [i + 1]]));
  const ops = vexSampleOps({ sourceId: 'vex', asset: 'b'.repeat(64), width: 400, height: 500, placement: PLACEMENT, paths, first: true });
  const r = applyOps(emptyDocument('vex', 'Vex'), ops, 'user');
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.doc;
}

/** Opacity of a part at normalized time u, as the runtime would sample it (stepped keys hold the previous value). */
function opacityAt(clip: Clip, part: string, u: number): number {
  const t = clip.tracks.find((x) => x.part === part && x.prop === 'opacity');
  if (!t) return 1;
  let v = t.keys[0]!.v;
  for (const k of t.keys) if (k.t <= u) v = k.v;
  return v;
}

describe('Vex as a document of the format', () => {
  it('becomes 37 parts with the rig skeleton, every state animated, and nothing dangling', () => {
    const doc = vex();
    expect(doc.parts).toHaveLength(37);
    expect(checkReferences(doc)).toEqual([]);
    for (const s of STATES) expect(doc.states[s]).toBe(`vex-${s}`);
    expect(doc.clips.map((c) => c.id).sort()).toEqual(STATES.map((s) => `vex-${s}`).sort());
    const byId = new Map(doc.parts.map((p) => [p.id, p]));
    expect(byId.get('mano-der')?.parent).toBe('codo-der');
    expect(byId.get('codo-der')?.parent).toBe('brazo-der');
    expect(byId.get('brazo-der')?.parent).toBe('torso');
    expect(byId.get('aleta-izq')?.physics?.enabled).toBe(true);
    // Pivots land in the canvas where the placement puts the rig.
    expect(byId.get('cabeza')?.pivot).toEqual({ x: 84 + 0.86 * 200, y: 41 + 0.86 * 262 });
    expect(doc.personality.displayName).toBe('Vex');
    expect(doc.capabilities).toEqual({ tools: [], maxRisk: 'read' });
  });

  it('gives each state the face the old rig had, one eye and one mouth variant at a time', () => {
    const doc = vex();
    const clip = (id: string) => doc.clips.find((c) => c.id === id)!;
    const visible = (c: Clip, u = 0.1) => doc.parts.filter((p) => (p.role === 'eye' || p.role === 'mouth') && opacityAt(c, p.id, u) === 1).map((p) => p.id);
    expect(visible(clip('vex-idle'))).toEqual(['ojos-neutral', 'boca-neutral']);
    expect(visible(clip('vex-think'))).toEqual(['ojos-thinking', 'boca-thinking']);
    expect(visible(clip('vex-happy'))).toEqual(['ojos-success', 'boca-success']);
    expect(visible(clip('vex-wave'))).toEqual(['ojos-happy', 'boca-happy']);
    expect(visible(clip('vex-error'))).toEqual(['ojos-wow', 'boca-wow']);
  });

  it('cycles the nine visemes while talking, one at a time, never a plain mouth', () => {
    const doc = vex();
    const talk = doc.clips.find((c) => c.id === 'vex-talk')!;
    const seen = new Set<string>();
    for (let i = 0; i < 9; i++) {
      const u = (i + 0.5) / 9;
      const on = VEX_VISEMES.map((v) => `visema-${v}`).filter((id) => opacityAt(talk, id, u) === 1);
      expect(on).toHaveLength(1);
      seen.add(on[0]!);
      for (const m of ['neutral', 'happy', 'thinking', 'wow', 'success']) expect(opacityAt(talk, `boca-${m}`, u)).toBe(0);
    }
    expect(seen.size).toBeGreaterThanOrEqual(7);
    expect(opacityAt(talk, 'ojos-happy', 0.5)).toBe(1);
    // One opacity track per face part: the runtime samples tracks in order, so a duplicate would hide the cycle.
    for (const p of doc.parts.filter((x) => x.role === 'eye' || x.role === 'mouth')) expect(talk.tracks.filter((t) => t.part === p.id && t.prop === 'opacity')).toHaveLength(1);
  });

  it('keeps the greeting wave and the thinking pose of the old rig', () => {
    const doc = vex();
    const wave = doc.clips.find((c) => c.id === 'vex-wave')!;
    const elbow = wave.tracks.find((t) => t.part === 'codo-der' && t.prop === 'rotate')!;
    expect(elbow.keys.map((k) => k.v)).toEqual([-20, -55, -20, -55, -20]);
    const think = doc.clips.find((c) => c.id === 'vex-think')!;
    expect(think.tracks.find((t) => t.part === 'codo-der')?.keys[0]?.v).toBe(-150);
  });

  it('refuses to build without every rig group', () => {
    expect(() => vexSampleOps({ sourceId: 'vex', asset: 'b'.repeat(64), width: 400, height: 500, placement: PLACEMENT, paths: {}, first: true })).toThrow(/vx-flame/);
  });
});
