// Rig data from assets/vex-2d/vex-rig.json. Angles in degrees, positive = clockwise (SVG),
// each around its own joint pivot.

export type VexState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'talking'
  | 'working'
  | 'greeting'
  | 'creative'
  | 'success';

export type VexExpression = 'neutral' | 'happy' | 'thinking' | 'wow' | 'success';

/** Rhubarb Lip Sync mouth shapes. */
export type Viseme = 'X' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export type VexLod = 'full' | 'bust' | 'head';

export interface Pose {
  armL: number;
  elbowL: number;
  armR: number;
  elbowR: number;
  head: number;
  finL: number;
  finR: number;
}

export const POSES: Record<VexState, Pose> = {
  idle: { armL: 12, elbowL: -8, armR: -12, elbowR: 8, head: 0, finL: 0, finR: 0 },
  listening: { armL: 10, elbowL: -6, armR: -10, elbowR: 6, head: -6, finL: 10, finR: -10 },
  thinking: { armL: 12, elbowL: -8, armR: -20, elbowR: -150, head: 8, finL: -6, finR: 6 },
  talking: { armL: 18, elbowL: -22, armR: -16, elbowR: 20, head: -3, finL: 0, finR: 0 },
  working: { armL: 20, elbowL: -100, armR: -20, elbowR: 100, head: 4, finL: 0, finR: 0 },
  greeting: { armL: 12, elbowL: -8, armR: -125, elbowR: -20, head: -5, finL: 4, finR: -4 },
  creative: { armL: 14, elbowL: -10, armR: -100, elbowR: -30, head: -4, finL: 0, finR: 0 },
  success: { armL: 120, elbowL: 15, armR: -120, elbowR: -15, head: 0, finL: 8, finR: -8 },
};

/** Default face per state; `talking` also cycles visemes on the mouth. */
export const STATE_FACES: Record<VexState, VexExpression> = {
  idle: 'neutral',
  listening: 'neutral',
  thinking: 'thinking',
  talking: 'happy',
  working: 'neutral',
  greeting: 'happy',
  creative: 'happy',
  success: 'success',
};

/** Timing contract shared with whoever drives the state machine. */
export const TIMING = {
  poseMs: 300,
  returnToIdleMs: 400,
  visemeMs: [80, 120] as const,
  /** greeting: elbow waves between -20° and -55°, 600 ms per wave, 3 waves. */
  greetingWaveMs: 600,
  greetingWaves: 3,
  /** success: hold the pose, then back to idle. */
  successHoldMs: 600,
} as const;

export const LOD: Record<VexLod, { viewBox: readonly [number, number, number, number] }> = {
  full: { viewBox: [0, 0, 400, 500] },
  bust: { viewBox: [60, 0, 280, 330] },
  head: { viewBox: [64, 8, 272, 272] },
};

/** Level of detail for a rendered height in px: body ≥ 160, bust 64–160, head ≤ 64. */
export function lodForHeight(px: number): VexLod {
  if (px >= 160) return 'full';
  if (px > 64) return 'bust';
  return 'head';
}

export const PALETTE = {
  body: '#F4F8FD',
  shade: '#D3DFEE',
  outline: '#B9C8DC',
  joint: '#2E7BFF',
  light: '#5CE1FF',
  visor: '#0A1230',
  hands: '#3B4250',
  accent: '#E25CFF',
  background: '#0B1636',
} as const;
