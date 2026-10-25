import { emptyDocument, type AvatarDocument, type Part } from './schema.ts';

/** A small three-part avatar used by tests across the workspace. */
export const FIXTURE_HASH = 'a'.repeat(64);

export function fixturePart(id: string, over: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    source: 'logo',
    nodes: [[0]],
    bbox: { x: 100, y: 100, width: 100, height: 100 },
    pivot: { x: 150, y: 200 },
    parent: null,
    z: 0,
    visible: true,
    ...over,
  };
}

export function fixtureDocument(): AvatarDocument {
  const doc = emptyDocument('mascota', 'Mascota');
  doc.sources.push({ id: 'logo', asset: FIXTURE_HASH, kind: 'svg', width: 512, height: 512, placement: { x: 0, y: 0, scale: 1 } });
  doc.parts.push(
    fixturePart('cuerpo', { role: 'body', nodes: [[0]], bbox: { x: 156, y: 220, width: 200, height: 220 }, pivot: { x: 256, y: 440 } }),
    fixturePart('cabeza', { role: 'head', nodes: [[1]], parent: 'cuerpo', z: 1, bbox: { x: 176, y: 90, width: 160, height: 140 }, pivot: { x: 256, y: 225 } }),
    fixturePart('antena', { role: 'antenna', nodes: [[2]], parent: 'cabeza', z: 2, bbox: { x: 248, y: 30, width: 16, height: 64 }, pivot: { x: 256, y: 94 }, physics: { enabled: true } }),
  );
  return doc;
}
