import type { EffectiveMaterial } from '@vexstudio/format';
import type { Rect } from '@vexstudio/format';
import { SVG_NS } from './svgsource.ts';

/**
 * Materials as SVG filters: finish (lighting), texture (noise), tint, outline and shadow. A flat
 * material with nothing else returns null, so cartoon avatars cost nothing extra to draw.
 */

const FINISH: Record<Exclude<EffectiveMaterial['finish'], 'flat'>, { blur: number; constant: number; exponent: number; amount: number; desaturate: number }> = {
  matte: { blur: 8, constant: 0.6, exponent: 6, amount: 0.22, desaturate: 0 },
  satin: { blur: 5, constant: 0.75, exponent: 14, amount: 0.4, desaturate: 0 },
  gloss: { blur: 3, constant: 1, exponent: 28, amount: 0.65, desaturate: 0 },
  metal: { blur: 2.5, constant: 1.2, exponent: 40, amount: 0.75, desaturate: 0.55 },
};

const TEXTURE: Record<Exclude<EffectiveMaterial['texture'], 'none'>, { type: 'fractalNoise' | 'turbulence'; freq: string; octaves: number }> = {
  grain: { type: 'fractalNoise', freq: '0.9', octaves: 2 },
  noise: { type: 'fractalNoise', freq: '0.45', octaves: 3 },
  paper: { type: 'fractalNoise', freq: '0.04', octaves: 5 },
  fabric: { type: 'turbulence', freq: '0.6 0.05', octaves: 2 },
};

export function needsFilter(m: EffectiveMaterial): boolean {
  return m.finish !== 'flat' || m.texture !== 'none' || m.shadow > 0 || m.outline !== null || m.tint !== null;
}

function el(name: string, attrs: Record<string, string | number>, children: Element[] = []): Element {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) e.appendChild(c);
  return e;
}

/** Builds the filter for a part; `bbox` is the part's rest bounds in the filter's user space. */
export function materialFilter(id: string, m: EffectiveMaterial, bbox: Rect): Element | null {
  if (!needsFilter(m)) return null;
  const size = Math.max(bbox.width, bbox.height, 1);
  const pad = Math.max(0.25 * size, 4 * (m.outline?.width ?? 0));
  const filter = el('filter', {
    id,
    filterUnits: 'userSpaceOnUse',
    x: bbox.x - pad,
    y: bbox.y - pad,
    width: bbox.width + 2 * pad,
    height: bbox.height + 2 * pad,
    'color-interpolation-filters': 'sRGB',
  });
  let base = 'SourceGraphic';

  if (m.tint) {
    filter.append(
      el('feFlood', { 'flood-color': m.tint, result: 'tintColor' }),
      el('feComposite', { in: 'tintColor', in2: 'SourceAlpha', operator: 'in', result: 'tintMask' }),
      el('feBlend', { in: 'tintMask', in2: base, mode: 'multiply', result: 'tinted' }),
    );
    base = 'tinted';
  }

  if (m.texture !== 'none') {
    const t = TEXTURE[m.texture];
    const s = m.textureStrength;
    filter.append(
      el('feTurbulence', { type: t.type, baseFrequency: t.freq, numOctaves: t.octaves, seed: 7, result: 'noise' }),
      el('feColorMatrix', { in: 'noise', type: 'saturate', values: 0, result: 'grey' }),
      el('feBlend', { in: 'grey', in2: base, mode: 'multiply', result: 'texBlend' }),
      el('feComposite', { in: 'texBlend', in2: base, operator: 'arithmetic', k1: 0, k2: s, k3: 1 - s, k4: 0, result: 'texMix' }),
      el('feComposite', { in: 'texMix', in2: 'SourceAlpha', operator: 'in', result: 'textured' }),
    );
    base = 'textured';
  }

  if (m.finish !== 'flat') {
    const f = FINISH[m.finish];
    if (f.desaturate > 0) {
      filter.append(el('feColorMatrix', { in: base, type: 'saturate', values: 1 - f.desaturate, result: 'metalBase' }));
      base = 'metalBase';
    }
    // Light from the top left, above the surface; the blurred alpha acts as a height map.
    filter.append(
      el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: (f.blur * size) / 200, result: 'height' }),
      el('feSpecularLighting', { in: 'height', surfaceScale: 5, specularConstant: f.constant, specularExponent: f.exponent, 'lighting-color': '#ffffff', result: 'spec' }, [
        el('fePointLight', { x: bbox.x + bbox.width * 0.25, y: bbox.y - bbox.height * 0.4, z: size * 1.2 }),
      ]),
      el('feComposite', { in: 'spec', in2: 'SourceAlpha', operator: 'in', result: 'specIn' }),
      el('feComposite', { in: base, in2: 'specIn', operator: 'arithmetic', k1: 0, k2: 1, k3: f.amount, k4: 0, result: 'lit' }),
    );
    base = 'lit';
  }

  const layers: string[] = [];
  if (m.outline && m.outline.width > 0) {
    filter.append(
      el('feMorphology', { in: 'SourceAlpha', operator: 'dilate', radius: m.outline.width, result: 'grown' }),
      el('feFlood', { 'flood-color': m.outline.color, result: 'lineColor' }),
      el('feComposite', { in: 'lineColor', in2: 'grown', operator: 'in', result: 'outline' }),
    );
    layers.push('outline');
  }
  layers.push(base);
  filter.append(el('feMerge', { result: 'body' }, layers.map((l) => el('feMergeNode', { in: l }))));

  if (m.shadow > 0) {
    filter.append(el('feDropShadow', { in: 'body', dx: 0, dy: size * 0.035 * m.shadow, stdDeviation: size * 0.03 * m.shadow, 'flood-color': '#000000', 'flood-opacity': 0.45 * m.shadow }));
  }
  return filter;
}
