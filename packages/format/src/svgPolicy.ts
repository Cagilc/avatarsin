/**
 * What an SVG may contain once it is part of an avatar. The server sanitizes every upload with
 * this policy and the runtime applies it again before drawing (defence in depth). Anything not
 * listed is dropped: scripts, foreign content, event handlers, external references, animation
 * elements and CSS that could load or run something.
 */

export const SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'image',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feComposite', 'feFlood', 'feMerge', 'feMergeNode', 'feDropShadow', 'feMorphology',
]);

export const SVG_ATTRIBUTES = new Set([
  'id', 'class', 'transform', 'viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'd', 'points', 'pathLength',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'color', 'display', 'visibility', 'clip-path', 'clip-rule', 'mask', 'filter', 'paint-order', 'vector-effect', 'mix-blend-mode', 'isolation',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'clipPathUnits', 'maskUnits', 'maskContentUnits', 'patternUnits', 'patternContentUnits', 'patternTransform',
  'filterUnits', 'primitiveUnits', 'in', 'in2', 'result', 'stdDeviation', 'dx', 'dy', 'mode', 'type', 'values', 'operator', 'k1', 'k2', 'k3', 'k4', 'radius', 'flood-color', 'flood-opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'word-spacing', 'text-decoration',
  'href', 'xlink:href', 'style', 'xmlns', 'xmlns:xlink', 'version', 'xml:space',
]);

/** CSS properties kept from `style` attributes and from class rules inlined by the server. */
export const CSS_PROPERTIES = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'color', 'display', 'visibility', 'clip-path', 'clip-rule', 'mask', 'filter', 'mix-blend-mode', 'isolation', 'stop-color', 'stop-opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing',
]);

const RASTER_DATA = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/;

/** A reference is acceptable only if it stays inside the document (or is an embedded raster). */
export function safeHref(value: string, element: string): boolean {
  const v = value.trim();
  if (v.startsWith('#')) return /^#[A-Za-z_][\w.-]*$/.test(v);
  return element === 'image' && RASTER_DATA.test(v);
}

/** `url(...)` must point inside the document; no imports, expressions or escapes. */
export function safeCssValue(value: string): boolean {
  const v = value.toLowerCase();
  if (/[\\<>]|expression|javascript:|@import|behavior|-moz-binding/.test(v)) return false;
  const urls = v.match(/url\(([^)]*)\)/g) ?? [];
  return urls.every((u) => /^url\(\s*['"]?#[a-z_][\w.-]*['"]?\s*\)$/.test(u));
}

/** Keeps only allowed declarations of a `style` attribute. */
export function cleanStyle(style: string): string {
  return style
    .split(';')
    .map((decl) => {
      const i = decl.indexOf(':');
      if (i < 0) return '';
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim();
      return CSS_PROPERTIES.has(prop) && value && safeCssValue(value) ? `${prop}:${value}` : '';
    })
    .filter(Boolean)
    .join(';');
}

/** Checks one attribute; returns the value to keep, or null to drop it. */
export function cleanAttribute(element: string, name: string, value: string): string | null {
  if (!SVG_ATTRIBUTES.has(name)) return null;
  if (name === 'href' || name === 'xlink:href') return safeHref(value, element) ? value : null;
  if (name === 'style') {
    const s = cleanStyle(value);
    return s || null;
  }
  return safeCssValue(value) ? value : null;
}
