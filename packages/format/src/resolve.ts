import type { AvatarDocument, Material, Part, Physics } from './schema.ts';

/**
 * Effective values: what the part sets explicitly, otherwise what the style implies. The single
 * "flat cartoon ↔ realistic" control moves all these defaults at once; anything a person fixed
 * stays as they set it.
 */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface EffectivePhysics {
  enabled: boolean;
  stiffness: number;
  damping: number;
  weight: number;
  gravity: number;
  limit: number;
}

export interface EffectiveMaterial {
  finish: NonNullable<Material['finish']>;
  texture: NonNullable<Material['texture']>;
  textureStrength: number;
  shadow: number;
  outline: { width: number; color: string } | null;
  tint: string | null;
}

export function physicsDefaults(realism: number): Omit<EffectivePhysics, 'enabled'> {
  return {
    // Cartoon: loose and bouncy, exaggerated swings. Realistic: firmer, settles quickly, heavier.
    stiffness: lerp(0.35, 0.6, realism),
    damping: lerp(0.12, 0.55, realism),
    weight: lerp(0.3, 0.7, realism),
    gravity: lerp(0.15, 0.35, realism),
    limit: lerp(45, 25, realism),
  };
}

export function effectivePhysics(part: Part, doc: AvatarDocument): EffectivePhysics {
  const d = physicsDefaults(doc.style.realism);
  const p: Physics | undefined = part.physics;
  return {
    enabled: p?.enabled ?? false,
    stiffness: p?.stiffness ?? d.stiffness,
    damping: p?.damping ?? d.damping,
    weight: p?.weight ?? d.weight,
    gravity: p?.gravity ?? d.gravity,
    limit: p?.limit ?? d.limit,
  };
}

export function materialDefaults(realism: number): EffectiveMaterial {
  return {
    finish: realism < 0.25 ? 'flat' : realism < 0.6 ? 'matte' : 'satin',
    texture: 'none',
    textureStrength: 0.3,
    shadow: realism < 0.25 ? 0 : lerp(0.15, 0.6, (realism - 0.25) / 0.75),
    outline: null,
    tint: null,
  };
}

export function effectiveMaterial(part: Part, doc: AvatarDocument): EffectiveMaterial {
  const d = materialDefaults(doc.style.realism);
  const m = part.material;
  return {
    finish: m?.finish ?? d.finish,
    texture: m?.texture ?? d.texture,
    textureStrength: m?.textureStrength ?? d.textureStrength,
    shadow: m?.shadow ?? d.shadow,
    outline: m?.outline === undefined ? d.outline : m.outline,
    tint: m?.tint === undefined ? d.tint : m.tint,
  };
}

/** Squash and stretch on impacts: big in cartoon, nearly none when realistic. */
export function effectiveSquash(doc: AvatarDocument): number {
  return doc.style.squash ?? lerp(0.8, 0.05, doc.style.realism);
}
