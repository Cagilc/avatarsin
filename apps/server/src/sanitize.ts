import { DOMParser, XMLSerializer, type Element as XElement, type Node as XNode } from '@xmldom/xmldom';
import { cleanAttribute, cleanStyle, SVG_ELEMENTS } from '@vexstudio/format';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/**
 * Every upload passes through here before it is stored. Files are identified by their bytes, not
 * by the name or type the browser sends. SVGs are rebuilt from an allowlist; rasters are decoded
 * and encoded again as plain PNG, which drops metadata and anything hidden after the image.
 */

export const LIMITS = {
  svgBytes: 2 * 1024 * 1024,
  rasterBytes: 5 * 1024 * 1024,
  svgElements: 20_000,
  svgDepth: 64,
  rasterSide: 4096,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export type Sanitized =
  | { ok: true; type: 'image/svg+xml' | 'image/png'; bytes: Buffer; width: number; height: number }
  | { ok: false; reason: string };

export function sniff(bytes: Buffer): 'png' | 'jpeg' | 'svg' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  const head = bytes.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('<')) return 'svg';
  return null;
}

export function sanitizeUpload(bytes: Buffer): Sanitized {
  const kind = sniff(bytes);
  if (kind === 'svg') return sanitizeSvg(bytes);
  if (kind === 'png' || kind === 'jpeg') return sanitizeRaster(bytes, kind);
  return { ok: false, reason: 'Formato no admitido: sube SVG, PNG o JPEG.' };
}

// ── SVG ──────────────────────────────────────────────────────────────────────

/** Turns simple class rules from <style> into inline styles (other selectors are dropped). */
function classRules(css: string): Map<string, string> {
  const rules = new Map<string, string>();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = cleanStyle(m[2] ?? '');
    if (!decls) continue;
    for (const sel of (m[1] ?? '').split(',').map((s) => s.trim())) {
      const cls = /^\.([A-Za-z_][\w-]*)$/.exec(sel)?.[1];
      if (cls) rules.set(cls, [rules.get(cls), decls].filter(Boolean).join(';'));
    }
  }
  return rules;
}

function elementChildren(node: XNode): XElement[] {
  const out: XElement[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i]!;
    if (c.nodeType === 1) out.push(c as XElement);
  }
  return out;
}

export function sanitizeSvg(bytes: Buffer): Sanitized {
  if (bytes.length > LIMITS.svgBytes) return { ok: false, reason: 'El SVG supera 2 MB.' };
  const text = bytes.toString('utf8');
  // Entity declarations can expand without limit or reach outside the file: refused outright.
  if (/<!ENTITY/i.test(text)) return { ok: false, reason: 'El SVG declara entidades; no se admite.' };
  const withoutDoctype = text.replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?\s*>/i, '');

  let doc;
  try {
    let fatal = false;
    doc = new DOMParser({ onError: (level) => { if (level === 'fatalError') fatal = true; } }).parseFromString(withoutDoctype, 'image/svg+xml');
    if (fatal) return { ok: false, reason: 'El SVG no está bien formado.' };
  } catch {
    return { ok: false, reason: 'El SVG no está bien formado.' };
  }
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) return { ok: false, reason: 'El archivo no es un SVG.' };

  // Collect class styles before <style> elements are removed.
  const css: string[] = [];
  const styles = root.getElementsByTagNameNS(SVG_NS, 'style');
  for (let i = 0; i < styles.length; i++) css.push(styles[i]!.textContent ?? '');
  const rules = classRules(css.join('\n'));

  let count = 0;
  let tooDeep = false;
  const walk = (el: XElement, depth: number) => {
    count++;
    if (depth > LIMITS.svgDepth) tooDeep = true;
    // Inline class styles first, so the element's own style attribute still wins.
    const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const fromClasses = classes.map((c) => rules.get(c)).filter(Boolean).join(';');
    if (fromClasses) el.setAttribute('style', [fromClasses, el.getAttribute('style') ?? ''].filter(Boolean).join(';'));

    const names: string[] = [];
    for (let i = 0; i < el.attributes.length; i++) names.push(el.attributes[i]!.name);
    for (const name of names) {
      const value = el.getAttribute(name) ?? '';
      const kept = cleanAttribute(el.localName ?? '', name, value);
      if (kept === null) el.removeAttribute(name);
      else if (kept !== value) el.setAttribute(name, kept);
    }

    for (let i = el.childNodes.length - 1; i >= 0; i--) {
      const child = el.childNodes[i]!;
      if (child.nodeType === 1) {
        const c = child as XElement;
        if (c.namespaceURI !== SVG_NS || !SVG_ELEMENTS.has(c.localName ?? '')) el.removeChild(c);
      } else if (child.nodeType !== 3) el.removeChild(child);
    }
    for (const c of elementChildren(el)) walk(c, depth + 1);
  };
  walk(root, 0);
  if (count > LIMITS.svgElements) return { ok: false, reason: `El SVG tiene demasiados elementos (${count}).` };
  if (tooDeep) return { ok: false, reason: 'El SVG está anidado demasiado hondo.' };

  // A definite coordinate system: viewBox always present, size equal to it.
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  let width: number;
  let height: number;
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) {
    width = vb[2]!;
    height = vb[3]!;
  } else {
    width = parseFloat(root.getAttribute('width') ?? '') || 0;
    height = parseFloat(root.getAttribute('height') ?? '') || 0;
    if (!(width > 0 && height > 0)) return { ok: false, reason: 'El SVG no indica su tamaño (viewBox).' };
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  if (width > 8192 || height > 8192) return { ok: false, reason: 'El SVG es demasiado grande (máximo 8192).' };
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));

  const out = new XMLSerializer().serializeToString(root);
  return { ok: true, type: 'image/svg+xml', bytes: Buffer.from(out, 'utf8'), width, height };
}

// ── Raster ───────────────────────────────────────────────────────────────────

/** The PNG up to its IEND chunk: whatever was appended after the image is ignored. */
function pngBody(bytes: Buffer): Buffer {
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const end = at + 12 + length;
    if (type === 'IEND') return bytes.subarray(0, Math.min(end, bytes.length));
    at = end;
  }
  return bytes;
}

function sanitizeRaster(bytes: Buffer, kind: 'png' | 'jpeg'): Sanitized {
  if (bytes.length > LIMITS.rasterBytes) return { ok: false, reason: 'La imagen supera 5 MB.' };
  try {
    let width: number;
    let height: number;
    let rgba: Buffer;
    if (kind === 'png') {
      // Read the declared size before decoding, so a tiny file cannot claim a gigantic image.
      width = bytes.readUInt32BE(16);
      height = bytes.readUInt32BE(20);
      if (width > LIMITS.rasterSide || height > LIMITS.rasterSide) return { ok: false, reason: `La imagen supera ${LIMITS.rasterSide} px.` };
      const png = PNG.sync.read(pngBody(bytes));
      width = png.width;
      height = png.height;
      rgba = png.data;
    } else {
      const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 17, maxMemoryUsageInMB: 256 });
      width = img.width;
      height = img.height;
      rgba = Buffer.from(img.data);
    }
    if (width < 1 || height < 1 || width > LIMITS.rasterSide || height > LIMITS.rasterSide) return { ok: false, reason: `La imagen supera ${LIMITS.rasterSide} px.` };
    const out = new PNG({ width, height });
    rgba.copy(out.data);
    return { ok: true, type: 'image/png', bytes: PNG.sync.write(out), width, height };
  } catch {
    return { ok: false, reason: 'La imagen está dañada o no se puede leer.' };
  }
}
