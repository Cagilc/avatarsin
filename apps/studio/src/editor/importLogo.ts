import type { AvatarDocument, Op, Rect } from '@vexstudio/format';
import type { LoadedAsset } from '@vexstudio/runtime';
import { api, fetchAsset } from '../api.ts';

/**
 * Turns an uploaded logo into a source and its parts. The server sanitizes the file first; the
 * parts are found in the sanitized SVG (the groups or shapes of its main layer) and measured by
 * the browser, so the editor and the published avatar see the same geometry.
 */

const CANVAS = 512;
const MAX_PARTS = 60;
const NON_DRAWING = new Set(['defs', 'title', 'desc', 'linearGradient', 'radialGradient', 'clipPath', 'mask', 'pattern', 'filter', 'symbol']);
const GENERIC_ID = /^(path|g|group|layer|capa|rect|circle|ellipse|polygon|shape|svg|_)[\w-]*$/i;

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function partName(el: Element, n: number): string {
  const id = el.getAttribute('id');
  if (id && !GENERIC_ID.test(id)) return id.replace(/[_-]+/g, ' ').slice(0, 60);
  return `${el.localName === 'g' ? 'Grupo' : 'Forma'} ${n}`;
}

function drawingChildren(el: Element): Element[] {
  return [...el.children].filter((c) => !NON_DRAWING.has(c.localName));
}

/** The element whose children are the logo's pieces: descend while there is a single group. */
function mainLayer(root: Element): { el: Element; path: number[] } {
  let el = root;
  const path: number[] = [];
  for (let depth = 0; depth < 8; depth++) {
    const kids = drawingChildren(el);
    if (kids.length !== 1 || kids[0]!.localName !== 'g') break;
    path.push([...el.children].indexOf(kids[0]!));
    el = kids[0]!;
  }
  return { el, path };
}

export interface ImportResult {
  ops: Op[];
  asset: { hash: string; loaded: LoadedAsset };
  parts: number;
  note: string | null;
}

export async function importLogo(file: File, doc: AvatarDocument): Promise<ImportResult> {
  const meta = await api.upload(file);
  const first = doc.sources.length === 0;
  const canvas = first ? { width: CANVAS, height: CANVAS } : doc.canvas;
  const s = Math.min((canvas.width * 0.84) / meta.width, (canvas.height * 0.84) / meta.height);
  const placement = { x: (canvas.width - meta.width * s) / 2, y: (canvas.height - meta.height * s) / 2, scale: s };
  const taken = new Set(doc.parts.map((p) => p.id));
  const sourceId = uniqueId('logo', new Set(doc.sources.map((x) => x.id)));
  const ops: Op[] = [];
  if (first) ops.push({ op: 'setCanvas', width: canvas.width, height: canvas.height });
  ops.push({ op: 'addSource', source: { id: sourceId, asset: meta.hash, kind: meta.kind, width: meta.width, height: meta.height, placement } });
  const zBase = doc.parts.reduce((m, p) => Math.max(m, p.z + 1), 0);

  if (meta.kind === 'png') {
    const res = await fetchAsset(meta.hash);
    const bbox: Rect = { x: placement.x, y: placement.y, width: meta.width * s, height: meta.height * s };
    ops.push({ op: 'addPart', part: { id: uniqueId('imagen', taken), name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Imagen', source: sourceId, crop: { x: 0, y: 0, width: meta.width, height: meta.height }, bbox, pivot: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height }, parent: null, z: zBase, visible: true } });
    return { ops, asset: { hash: meta.hash, loaded: { type: 'image/png', url: URL.createObjectURL(await res.blob()) } }, parts: 1, note: 'Una imagen entra como una sola pieza; separarla en piezas llegará con el recorte por capas.' };
  }

  const text = await (await fetchAsset(meta.hash)).text();
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  // Measure in the page at 1:1 so the browser applies every transform exactly as it will later.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none';
  svg.setAttribute('width', String(meta.width));
  svg.setAttribute('height', String(meta.height));
  host.appendChild(svg);
  document.body.appendChild(host);
  let note: string | null = null;
  try {
    const outer = svg.getBoundingClientRect();
    const k = meta.width / Math.max(outer.width, 1e-6);
    const measure = (el: Element): Rect | null => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { x: placement.x + s * (r.left - outer.left) * k, y: placement.y + s * (r.top - outer.top) * k, width: s * r.width * k, height: s * r.height * k };
    };

    const { el: layer, path } = mainLayer(svg);
    let pieces = drawingChildren(layer).map((el) => ({ el, path: [...path, [...layer.children].indexOf(el)] }));
    if (pieces.length > MAX_PARTS) {
      note = `El logo tiene ${pieces.length} formas sueltas: entra como una sola pieza. Agrúpalas por capas en tu programa de diseño para animarlas por separado.`;
      pieces = [];
    }
    let n = 0;
    for (const { el, path: p } of pieces) {
      const bbox = measure(el);
      if (!bbox) continue;
      n++;
      ops.push({ op: 'addPart', part: { id: uniqueId(`p${n}`, taken), name: partName(el, n), source: sourceId, nodes: [p], bbox, pivot: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }, parent: null, z: zBase + n, visible: true } });
    }
    if (n === 0) {
      const bbox = measure(svg) ?? { x: placement.x, y: placement.y, width: meta.width * s, height: meta.height * s };
      ops.push({ op: 'addPart', part: { id: uniqueId('logo', taken), name: 'Logo', source: sourceId, bbox, pivot: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height }, parent: null, z: zBase, visible: true } });
      n = 1;
    }
    return { ops, asset: { hash: meta.hash, loaded: { type: 'image/svg+xml', text } }, parts: n, note };
  } finally {
    host.remove();
  }
}
