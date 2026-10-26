import { emptyDocument, type AvatarDocument, type Part } from '@vexstudio/format';
import { fixtureDocument } from '@vexstudio/format/fixtures';

/**
 * Starting documents for the assistant bank. `rawMascot` is the sample mascot exactly as the
 * editor imports it (every piece at the root, no roles, pivots at the centre), so the assistant
 * has to deduce the skeleton; the others start from a rigged avatar or from nothing.
 */

const CANVAS = 512;
/** The sample is 400×400; the editor fits it to 84 % of the canvas, centred. */
const S = (CANVAS * 0.84) / 400;
const OFFSET = (CANVAS - 400 * S) / 2;
const box = (x: number, y: number, w: number, h: number) => ({ x: OFFSET + S * x, y: OFFSET + S * y, width: S * w, height: S * h });

/** Bounds of each group of apps/studio/public/samples/mascota.svg, in its own 400×400 space. */
const MASCOT: Array<{ id: string; name: string; bbox: [number, number, number, number] }> = [
  { id: 'p1', name: 'brazo izquierdo', bbox: [78, 215, 34, 90] },
  { id: 'p2', name: 'brazo derecho', bbox: [288, 215, 34, 90] },
  { id: 'p3', name: 'cuerpo', bbox: [110, 200, 180, 150] },
  { id: 'p4', name: 'oreja izquierda', bbox: [112, 96, 32, 48] },
  { id: 'p5', name: 'oreja derecha', bbox: [256, 96, 32, 48] },
  { id: 'p6', name: 'antena', bbox: [188, 18, 24, 64] },
  { id: 'p7', name: 'cabeza', bbox: [130, 80, 140, 140] },
];

export const RAW_HASH = 'c'.repeat(64);

/** The mascot as a fresh import: seven loose pieces. */
export function rawMascot(): AvatarDocument {
  const doc = emptyDocument('mascota', 'Mascota');
  doc.sources.push({ id: 'logo', asset: RAW_HASH, kind: 'svg', width: 400, height: 400, placement: { x: OFFSET, y: OFFSET, scale: S } });
  doc.parts.push(
    ...MASCOT.map(({ id, name, bbox: [x, y, w, h] }, i): Part => {
      const b = box(x, y, w, h);
      return { id, name, source: 'logo', nodes: [[i + 1]], bbox: b, pivot: { x: b.x + b.width / 2, y: b.y + b.height / 2 }, parent: null, z: i + 1, visible: true };
    }),
  );
  return doc;
}

/** The raw mascot with values a person fixed: the antenna's pivot and the style. */
export function rawMascotWithLocks(): AvatarDocument {
  const doc = rawMascot();
  const antena = doc.parts.find((p) => p.id === 'p6')!;
  antena.pivot = { x: antena.bbox.x + antena.bbox.width / 2, y: antena.bbox.y + antena.bbox.height };
  doc.style = { realism: 0.7 };
  doc.provenance['part:p6:pivot'] = { by: 'user' };
  doc.provenance['style.realism'] = { by: 'user' };
  return doc;
}

/** A single raster image, as a PNG import leaves it. */
export function rawRaster(): AvatarDocument {
  const doc = emptyDocument('foto', 'Foto');
  doc.sources.push({ id: 'imagen', asset: 'd'.repeat(64), kind: 'png', width: 300, height: 300, placement: { x: 106, y: 106, scale: 1 } });
  doc.parts.push({ id: 'imagen', name: 'Imagen', source: 'imagen', crop: { x: 0, y: 0, width: 300, height: 300 }, bbox: { x: 106, y: 106, width: 300, height: 300 }, pivot: { x: 256, y: 406 }, parent: null, z: 0, visible: true });
  return doc;
}

/** Three rigged parts, no animation yet (the format's own fixture). */
export const rigged = fixtureDocument;

export const empty = () => emptyDocument('vacio', 'Vacío');
