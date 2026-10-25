import { effectivePhysics, type AvatarDocument, type Part } from '@vexstudio/format';
import { angleOf, apply, IDENTITY, multiply, rotate, scale, translate, type Mat } from './math.ts';
import { REST, type Sample } from './timeline.ts';

export interface PartPose {
  world: Mat;
  opacity: number;
}
export type Pose = Map<string, PartPose>;

interface Spring {
  theta: number;
  omega: number;
  /** Driver (pivot position and angle) on the previous frame, to derive accelerations. */
  prev: { x: number; y: number; angle: number; vx: number; vy: number; va: number } | null;
}

const RAD2DEG = 180 / Math.PI;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const MAX_DT = 1 / 20;
const SUBSTEP = 1 / 240;
const MAX_ACCEL = 60_000;
const OMEGA_REF = 2 * Math.PI * 2;

/** Parents before children, so each part can use its parent's final pose. */
export function topoOrder(parts: readonly Part[]): Part[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const out: Part[] = [];
  const done = new Set<string>();
  const visit = (p: Part, depth: number) => {
    if (done.has(p.id) || depth > parts.length) return;
    const parent = p.parent === null ? undefined : byId.get(p.parent);
    if (parent) visit(parent, depth + 1);
    done.add(p.id);
    out.push(p);
  };
  for (const p of parts) visit(p, 0);
  return out;
}

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/**
 * Skeleton and secondary motion. Animation gives each part a local transform around its pivot;
 * parts with physics add a damped spring rotation that reacts to how their pivot accelerates
 * (they lag behind and overshoot) and to gravity. Deterministic: same inputs, same pose.
 */
export class Rig {
  private doc: AvatarDocument;
  private order: Part[];
  private readonly springs = new Map<string, Spring>();

  constructor(doc: AvatarDocument) {
    this.doc = doc;
    this.order = topoOrder(doc.parts);
  }

  setDocument(doc: AvatarDocument): void {
    this.doc = doc;
    this.order = topoOrder(doc.parts);
    for (const id of [...this.springs.keys()]) if (!doc.parts.some((p) => p.id === id)) this.springs.delete(id);
  }

  reset(): void {
    this.springs.clear();
  }

  /** Current spring angle of a part (degrees), for tests and the editor. */
  springAngle(id: string): number {
    return this.springs.get(id)?.theta ?? 0;
  }

  /** Pose for this frame. `dt` > 0 advances the physics; 0 just poses. */
  frame(sample: Sample, dt: number, physics = true): Pose {
    const pose: Pose = new Map();
    const step = Math.min(Math.max(dt, 0), MAX_DT);
    const { gravity } = this.doc.world;
    const g = { x: Math.cos((gravity.angle * Math.PI) / 180) * gravity.strength, y: Math.sin((gravity.angle * Math.PI) / 180) * gravity.strength };

    for (const part of this.order) {
      const parent = part.parent === null ? undefined : pose.get(part.parent);
      const parentWorld = parent?.world ?? IDENTITY;
      const local = sample.get(part.id) ?? REST;
      let theta = 0;

      const params = effectivePhysics(part, this.doc);
      if (physics && params.enabled) {
        const spring = this.springs.get(part.id) ?? { theta: 0, omega: 0, prev: null };
        this.springs.set(part.id, spring);
        if (step > 0) this.advance(spring, part, params, parentWorld, local.x, local.y, local.rotate, g, step);
        theta = spring.theta;
      }

      const { x: px, y: py } = part.pivot;
      const localMat = multiply(
        translate(px + local.x, py + local.y),
        multiply(rotate(local.rotate + theta), multiply(scale(local.scaleX, local.scaleY), translate(-px, -py))),
      );
      pose.set(part.id, { world: multiply(parentWorld, localMat), opacity: (parent?.opacity ?? 1) * local.opacity });
    }
    return pose;
  }

  private advance(
    spring: Spring,
    part: Part,
    p: ReturnType<typeof effectivePhysics>,
    parentWorld: Mat,
    lx: number,
    ly: number,
    lrot: number,
    g: { x: number; y: number },
    dt: number,
  ): void {
    const P = apply(parentWorld, part.pivot.x + lx, part.pivot.y + ly);
    const angle = angleOf(parentWorld) + lrot;

    let ax = 0;
    let ay = 0;
    let aa = 0;
    if (spring.prev) {
      const vx = (P.x - spring.prev.x) / dt;
      const vy = (P.y - spring.prev.y) / dt;
      let dA = angle - spring.prev.angle;
      dA = ((dA + 540) % 360) - 180;
      const va = dA / dt;
      ax = clamp((vx - spring.prev.vx) / dt, MAX_ACCEL);
      ay = clamp((vy - spring.prev.vy) / dt, MAX_ACCEL);
      aa = clamp((va - spring.prev.va) / dt, MAX_ACCEL);
      spring.prev = { x: P.x, y: P.y, angle, vx, vy, va };
    } else {
      spring.prev = { x: P.x, y: P.y, angle, vx: 0, vy: 0, va: 0 };
    }

    // Arm from the pivot to the part's centre, at rest.
    const cx = part.bbox.x + part.bbox.width / 2 - part.pivot.x;
    const cy = part.bbox.y + part.bbox.height / 2 - part.pivot.y;
    const L = Math.max(1, Math.hypot(cx, cy));

    // A push along the part (a jump under a vertical antenna) has no lever arm in an ideal rod,
    // but real springy parts buckle to one side: outward for side parts, right for centred ones.
    const side = Math.abs(cx) > 0.15 * L ? Math.sign(cx) : 1;

    const heavy = lerp(0.6, 1.6, p.weight);
    const omega0 = (2 * Math.PI * lerp(0.8, 6, p.stiffness)) / Math.sqrt(heavy);
    const zeta = lerp(0.03, 1, p.damping);
    const inertia = lerp(0.4, 1.6, p.weight);

    const n = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const world = ((angle + spring.theta) * Math.PI) / 180;
      const cos = Math.cos(world);
      const sin = Math.sin(world);
      const rx = cx * cos - cy * sin;
      const ry = cx * sin + cy * cos;
      // The part's mass resists the pivot's acceleration: torque of the pseudo-force −m·a at the centre.
      const inertial = (-(rx * ay - ry * ax) / (L * L)) * RAD2DEG * inertia - aa * inertia;
      const axial = ((rx * ax + ry * ay) / (L * L)) * RAD2DEG * inertia * 0.35 * side;
      // Gravity pulls the centre along g; stiffer parts sag less.
      const sag = OMEGA_REF * OMEGA_REF * 30 * p.gravity * ((rx * g.y - ry * g.x) / L);
      const acc = -omega0 * omega0 * spring.theta - 2 * zeta * omega0 * spring.omega + inertial + axial + sag;
      spring.omega += acc * h;
      spring.theta += spring.omega * h;
      if (Math.abs(spring.theta) > p.limit) {
        spring.theta = Math.sign(spring.theta) * p.limit;
        spring.omega *= -0.3;
      }
    }
  }
}
