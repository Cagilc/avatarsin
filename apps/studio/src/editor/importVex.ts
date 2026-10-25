import { VEX_PARTS, vexSampleOps, type AvatarDocument, type Rect } from '@vexstudio/format';
import { api, fetchAsset } from '../api.ts';
import type { ImportResult } from './importLogo.ts';

const CANVAS = 512;

/**
 * Imports Vex, the operator's own avatar, from the flattened sample: the server sanitizes the
 * SVG like any upload, then the browser finds each rig group by id in the sanitized file and
 * measures it, and the format's sample module adds the skeleton, pivots, faces and the 8 states.
 */
export async function importVexSample(doc: AvatarDocument): Promise<ImportResult> {
  const blob = await (await fetch('/samples/vex.svg')).blob();
  const meta = await api.upload(blob);
  if (meta.kind !== 'svg') throw new Error('La muestra de Vex no es un SVG.');
  const first = doc.sources.length === 0;
  const canvas = first ? { width: CANVAS, height: CANVAS } : doc.canvas;
  const s = Math.min((canvas.width * 0.84) / meta.width, (canvas.height * 0.84) / meta.height);
  const placement = { x: (canvas.width - meta.width * s) / 2, y: (canvas.height - meta.height * s) / 2, scale: s };
  const sourceId = doc.sources.some((x) => x.id === 'vex') ? `vex-${doc.sources.length + 1}` : 'vex';

  const text = await (await fetchAsset(meta.hash)).text();
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none';
  svg.setAttribute('width', String(meta.width));
  svg.setAttribute('height', String(meta.height));
  host.appendChild(svg);
  document.body.appendChild(host);
  try {
    const outer = svg.getBoundingClientRect();
    const k = meta.width / Math.max(outer.width, 1e-6);
    const paths: Record<string, number[]> = {};
    const bboxes: Record<string, Rect> = {};
    for (const def of VEX_PARTS) {
      const g = [...svg.children].find((c) => c.getAttribute('id') === def.rig);
      if (!g) throw new Error(`Falta el grupo ${def.rig} en la muestra de Vex.`);
      paths[def.rig] = [[...svg.children].indexOf(g)];
      const r = g.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) bboxes[def.rig] = { x: placement.x + s * (r.left - outer.left) * k, y: placement.y + s * (r.top - outer.top) * k, width: s * r.width * k, height: s * r.height * k };
    }
    const ops = vexSampleOps({ sourceId, asset: meta.hash, width: meta.width, height: meta.height, placement, paths, bboxes, first, canvas });
    return { ops, asset: { hash: meta.hash, loaded: { type: 'image/svg+xml', text } }, parts: VEX_PARTS.length, note: `Vex importado: ${VEX_PARTS.length} piezas con su esqueleto, sus caras, sus visemas y los 8 estados.` };
  } finally {
    host.remove();
  }
}
