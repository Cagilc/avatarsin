import type { AvatarDocument, Part } from '@vexstudio/format';
import { REST, type Sample } from './timeline.ts';

/**
 * "Point at that": the host gives a screen direction (degrees, 0 = right, 90 = down, as SVG
 * angles go) and the runtime turns the pointing arm so it lies along it, on top of whatever the
 * current clip does to the arm. No clip needs to know where the target is.
 */

const RAD2DEG = 180 / Math.PI;

/** Where a part lies at rest, from its pivot to its centre, in degrees. */
export function restDirection(part: Part): number {
  const cx = part.bbox.x + part.bbox.width / 2 - part.pivot.x;
  const cy = part.bbox.y + part.bbox.height / 2 - part.pivot.y;
  return Math.atan2(cy, cx) * RAD2DEG;
}

/** The arms a rig can point with: parts with the arm role that do not hang from another arm. */
export function arms(doc: AvatarDocument): Part[] {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  return doc.parts.filter((p) => {
    if (p.role !== 'arm') return false;
    const parent = p.parent === null ? undefined : byId.get(p.parent);
    return parent?.role !== 'arm' && parent?.role !== 'hand';
  });
}

/** The arm on the side of the aim: the right one for anything rightwards, the left one otherwise. */
export function pointingArm(doc: AvatarDocument, aimDeg: number): Part | undefined {
  const candidates = arms(doc);
  if (candidates.length === 0) return undefined;
  const rightwards = Math.cos((aimDeg * Math.PI) / 180) >= 0;
  const sorted = [...candidates].sort((a, b) => a.pivot.x - b.pivot.x);
  return rightwards ? sorted[sorted.length - 1] : sorted[0];
}

const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** The sample with the pointing arm turned to `aimDeg`; other parts untouched. */
export function aimSample(doc: AvatarDocument, sample: Sample, aimDeg: number): Sample {
  const arm = pointingArm(doc, aimDeg);
  if (!arm) return sample;
  const out: Sample = new Map(sample);
  const local = { ...(sample.get(arm.id) ?? REST) };
  local.rotate = wrap(aimDeg - restDirection(arm));
  out.set(arm.id, local);
  return out;
}
