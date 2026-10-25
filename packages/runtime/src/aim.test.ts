import { fixtureDocument, fixturePart } from '@vexstudio/format/fixtures';
import { describe, expect, it } from 'vitest';
import { aimSample, arms, pointingArm, restDirection } from './aim.ts';
import { apply } from './math.ts';
import { Rig } from './rig.ts';
import { REST, type Sample } from './timeline.ts';

/** The fixture with two arms hanging down from the body, one each side, plus a forearm. */
function withArms() {
  const doc = fixtureDocument();
  doc.parts.push(
    fixturePart('brazo-der', { role: 'arm', parent: 'cuerpo', nodes: [[3]], bbox: { x: 350, y: 240, width: 20, height: 80 }, pivot: { x: 360, y: 240 } }),
    fixturePart('antebrazo-der', { role: 'arm', parent: 'brazo-der', nodes: [[4]], bbox: { x: 350, y: 320, width: 20, height: 60 }, pivot: { x: 360, y: 320 } }),
    fixturePart('brazo-izq', { role: 'arm', parent: 'cuerpo', nodes: [[5]], bbox: { x: 142, y: 240, width: 20, height: 80 }, pivot: { x: 152, y: 240 } }),
  );
  return doc;
}

/** Direction the arm actually points on screen after the rig poses it. */
function worldDirection(doc: ReturnType<typeof withArms>, sample: Sample, id: string): number {
  const pose = new Rig(doc).frame(sample, 0, false);
  const part = doc.parts.find((p) => p.id === id)!;
  const m = pose.get(id)!.world;
  const p = apply(m, part.pivot.x, part.pivot.y);
  const c = apply(m, part.bbox.x + part.bbox.width / 2, part.bbox.y + part.bbox.height / 2);
  return (Math.atan2(c.y - p.y, c.x - p.x) * 180) / Math.PI;
}

describe('pointing', () => {
  it('knows the arms (not forearms) and which one is on each side', () => {
    const doc = withArms();
    expect(arms(doc).map((p) => p.id)).toEqual(['brazo-der', 'brazo-izq']);
    expect(pointingArm(doc, 0)?.id).toBe('brazo-der');
    expect(pointingArm(doc, -60)?.id).toBe('brazo-der');
    expect(pointingArm(doc, 180)?.id).toBe('brazo-izq');
    expect(pointingArm(doc, 135)?.id).toBe('brazo-izq');
    expect(pointingArm(fixtureDocument(), 0)).toBeUndefined();
    expect(restDirection(doc.parts.find((p) => p.id === 'brazo-der')!)).toBeCloseTo(90);
  });

  it('turns the arm so it lies along the aim, whatever the clip did to it', () => {
    const doc = withArms();
    for (const aim of [0, -45, -90, 30]) {
      const sample: Sample = new Map([['brazo-der', { ...REST, rotate: 25 }]]);
      expect(worldDirection(doc, aimSample(doc, sample, aim), 'brazo-der')).toBeCloseTo(aim, 5);
    }
    expect(worldDirection(doc, aimSample(doc, new Map(), 180), 'brazo-izq')).toBeCloseTo(180, 5);
    // The other arm keeps whatever the clip said.
    const aimed = aimSample(doc, new Map([['brazo-izq', { ...REST, rotate: 12 }]]), 0);
    expect(aimed.get('brazo-izq')?.rotate).toBe(12);
    expect(aimed.get('antebrazo-der')).toBeUndefined();
  });

  it('leaves a rig without arms alone', () => {
    const doc = fixtureDocument();
    const sample: Sample = new Map([['cabeza', { ...REST, rotate: 5 }]]);
    expect(aimSample(doc, sample, 45)).toBe(sample);
  });
});
