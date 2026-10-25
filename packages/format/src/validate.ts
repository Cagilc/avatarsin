import { documentSchema, STATES, type AvatarDocument } from './schema.ts';

export interface Issue {
  path: string;
  message: string;
}

export type ParseResult = { ok: true; doc: AvatarDocument } | { ok: false; issues: Issue[] };

/** Shape (Zod) plus the rules a schema cannot express: unique ids, references, no cycles. */
export function parseDocument(input: unknown): ParseResult {
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  const issues = checkReferences(parsed.data);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, doc: parsed.data };
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

export function checkReferences(doc: AvatarDocument): Issue[] {
  const issues: Issue[] = [];
  for (const id of duplicates(doc.sources.map((s) => s.id))) issues.push({ path: 'sources', message: `Fuente repetida: ${id}.` });
  for (const id of duplicates(doc.parts.map((p) => p.id))) issues.push({ path: 'parts', message: `Pieza repetida: ${id}.` });
  for (const id of duplicates(doc.clips.map((c) => c.id))) issues.push({ path: 'clips', message: `Animación repetida: ${id}.` });

  const sources = new Map(doc.sources.map((s) => [s.id, s]));
  const parts = new Map(doc.parts.map((p) => [p.id, p]));

  doc.parts.forEach((part, i) => {
    const source = sources.get(part.source);
    if (!source) issues.push({ path: `parts.${i}.source`, message: `La pieza ${part.id} usa una fuente que no existe (${part.source}).` });
    else if (source.kind === 'png' && part.nodes) issues.push({ path: `parts.${i}.nodes`, message: `La pieza ${part.id} es una imagen: no lleva nodos SVG.` });
    else if (source.kind === 'svg' && part.crop) issues.push({ path: `parts.${i}.crop`, message: `La pieza ${part.id} es vectorial: no lleva recorte.` });
    if (part.parent !== null && !parts.has(part.parent)) issues.push({ path: `parts.${i}.parent`, message: `La pieza ${part.id} cuelga de una pieza que no existe (${part.parent}).` });
  });

  // Each chain of parents must end at a root.
  for (const part of doc.parts) {
    const seen = new Set<string>([part.id]);
    let cursor = part.parent;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        issues.push({ path: 'parts', message: `El esqueleto tiene un ciclo en ${part.id}.` });
        break;
      }
      seen.add(cursor);
      cursor = parts.get(cursor)?.parent ?? null;
    }
  }

  doc.clips.forEach((clip, i) => {
    clip.tracks.forEach((track, j) => {
      if (!parts.has(track.part)) issues.push({ path: `clips.${i}.tracks.${j}.part`, message: `La animación ${clip.id} mueve una pieza que no existe (${track.part}).` });
      for (let k = 1; k < track.keys.length; k++) {
        if (track.keys[k]!.t < track.keys[k - 1]!.t) {
          issues.push({ path: `clips.${i}.tracks.${j}.keys`, message: `Las claves de ${clip.id}/${track.part}.${track.prop} no están en orden.` });
          break;
        }
      }
    });
  });

  const clips = new Set(doc.clips.map((c) => c.id));
  for (const state of STATES) {
    const clip = doc.states[state];
    if (clip !== undefined && !clips.has(clip)) issues.push({ path: `states.${state}`, message: `El estado ${state} apunta a una animación que no existe (${clip}).` });
  }
  return issues;
}
