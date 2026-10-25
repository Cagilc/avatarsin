import {
  applyOps,
  pathsOf,
  presetOps,
  STATES,
  type AvatarDocument,
  type Material,
  type Op,
  type Part,
  type Physics,
  type Role,
} from '@vexstudio/format';
import type { Assistant, AssistantInput, Proposal, Question } from './types.ts';

/**
 * The assistant without a model: geometry and keywords. It reads the parts' shapes to build a
 * skeleton (who hangs from whom, where each part pivots, which parts swing), takes what it can
 * from the request, fills everything else with sensible defaults, and asks only about what it
 * cannot deduce and would change the result. With a Claude key the server uses the model
 * instead; both return the same kind of proposal and go through the same validation.
 */

// ── what the request says ────────────────────────────────────────────────────

export type StyleChoice = 'plano' | 'volumen' | 'realista';
export type MotionChoice = 'rebote' | 'suave' | 'rigido';
export type MaterialChoice = 'brillante' | 'mate' | 'metal' | 'tela';

export interface Intent {
  style?: StyleChoice;
  motion?: MotionChoice;
  material?: MaterialChoice;
  weight?: 'ligero' | 'pesado';
  floating?: boolean;
  tone?: 'cercano' | 'profesional' | 'divertido' | 'serio' | 'entusiasta';
  name?: string;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export function readIntent(message: string): Intent {
  const m = norm(message);
  const has = (...words: string[]) => words.some((w) => new RegExp(`(?<!\\p{L})${w}`, 'u').test(m));
  const intent: Intent = {};
  if (has('realista', 'realismo', 'fotorrealista', '3d', 'hiperrealista')) intent.style = 'realista';
  else if (has('semirrealista', 'con volumen', 'volumen', 'intermedio')) intent.style = 'volumen';
  else if (has('plano', 'flat', 'dibujo', 'cartoon', 'caricatura', 'dibujos animados', 'minimalista')) intent.style = 'plano';

  if (has('rebot', 'elastic', 'gelatina', 'blandit', 'muelle')) intent.motion = 'rebote';
  else if (has('rigid', 'firme', 'quiet', 'sin movimiento')) intent.motion = 'rigido';
  else if (has('suave', 'balance', 'ondea')) intent.motion = 'suave';

  if (has('metal', 'cromad', 'acero')) intent.material = 'metal';
  else if (has('tela', 'peluche', 'textil', 'lana', 'fieltro')) intent.material = 'tela';
  else if (has('brillante', 'brillo', 'plastico', 'pulido', 'lacado')) intent.material = 'brillante';
  else if (has('mate')) intent.material = 'mate';

  if (has('pesad', 'robust', 'macizo')) intent.weight = 'pesado';
  else if (has('liger', 'liviano')) intent.weight = 'ligero';
  if (has('flota', 'flotando', 'ingravidez', 'espacio', 'levita')) intent.floating = true;

  if (has('divertid', 'gracios', 'juguet')) intent.tone = 'divertido';
  else if (has('profesional', 'corporativ', 'formal')) intent.tone = 'profesional';
  else if (has('seri')) intent.tone = 'serio';
  else if (has('entusiasta', 'energic', 'alegre')) intent.tone = 'entusiasta';
  else if (has('cercan', 'amable', 'simpatic')) intent.tone = 'cercano';

  const named = /(?:se llam[ae]|llamad[oa]|de nombre|con el nombre(?: de)?)\s+["«]?([\p{L}][\p{L}\p{N} -]{0,30}?)["»]?(?=[,.;!?]|$|\s+(?:y|que|con|para)\s)/iu.exec(message);
  if (named?.[1]) intent.name = named[1].trim();
  return intent;
}

// ── what the shapes say ──────────────────────────────────────────────────────

const area = (p: Part) => Math.max(1, p.bbox.width * p.bbox.height);
const centre = (p: Part) => ({ x: p.bbox.x + p.bbox.width / 2, y: p.bbox.y + p.bbox.height / 2 });
const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface Rigging {
  parent: Map<string, string | null>;
  role: Map<string, Role>;
  pivot: Map<string, { x: number; y: number }>;
  swinging: Set<string>;
  root: string;
}

const SWINGS: ReadonlySet<Role> = new Set(['antenna', 'ear', 'hair', 'tail']);
const APPENDAGES: ReadonlySet<Role> = new Set(['antenna', 'ear', 'hair', 'tail', 'arm', 'hand', 'leg']);

/** Skeleton from geometry: big parts carry the small parts that touch them. */
export function inferRigging(doc: AvatarDocument): Rigging | null {
  const canvasArea = doc.canvas.width * doc.canvas.height;
  const parts = doc.parts.filter((p) => p.visible);
  if (parts.length === 0) return null;
  const role = new Map<string, Role>();
  const parent = new Map<string, string | null>();

  // A part covering most of the canvas behind several others is a background, not a body.
  const sorted = [...parts].sort((a, b) => area(b) - area(a));
  let candidates = sorted;
  if (sorted.length > 2 && area(sorted[0]!) >= 0.8 * canvasArea) {
    role.set(sorted[0]!.id, 'background');
    parent.set(sorted[0]!.id, null);
    candidates = sorted.slice(1);
  }
  const root = candidates[0]!;
  role.set(root.id, 'body');
  parent.set(root.id, null);
  const rootArea = area(root);

  // Rows of four or more small pieces side by side read as lettering.
  const small = candidates.slice(1).filter((p) => area(p) < 0.06 * rootArea);
  for (const p of small) {
    const row = small.filter((q) => Math.abs(centre(q).y - centre(p).y) < 0.06 * root.bbox.height && Math.abs(q.bbox.height - p.bbox.height) < 0.5 * p.bbox.height);
    if (row.length >= 4) for (const q of row) role.set(q.id, 'text');
  }

  const placed: Part[] = [root];
  for (const p of candidates.slice(1)) {
    const c = centre(p);
    const margin = (q: Part) => 0.1 * Math.max(q.bbox.width, q.bbox.height);
    // Hosts are bigger parts whose (slightly grown) bounds overlap this part's bounds.
    const touching = placed.filter((q) => {
      const m = margin(q);
      return p.bbox.x < q.bbox.x + q.bbox.width + m && p.bbox.x + p.bbox.width > q.bbox.x - m && p.bbox.y < q.bbox.y + q.bbox.height + m && p.bbox.y + p.bbox.height > q.bbox.y - m;
    });
    const host = touching.sort((a, b) => area(a) - area(b))[0] ?? root;
    parent.set(p.id, host.id);
    placed.push(p);
    if (role.has(p.id)) continue;

    const H = host.bbox;
    const ratio = area(p) / rootArea;
    const tall = p.bbox.height > 1.8 * p.bbox.width;
    const long = Math.max(p.bbox.width, p.bbox.height) > 1.8 * Math.min(p.bbox.width, p.bbox.height);
    let r: Role = 'other';
    if (c.y < H.y) r = ratio > 0.12 && !tall ? 'head' : tall ? 'antenna' : 'ear';
    else if (c.y > H.y + H.height) r = long ? 'leg' : 'other';
    else if (c.x < H.x || c.x > H.x + H.width) r = c.y < H.y + 0.35 * H.height && !long ? 'ear' : 'arm';
    else if (ratio < 0.03) r = c.y < H.y + 0.6 * H.height ? 'eye' : 'mouth';
    else if (ratio > 0.25 && c.y < H.y + 0.5 * H.height) r = 'head';
    role.set(p.id, r);
  }

  const pivot = new Map<string, { x: number; y: number }>();
  const byId = new Map(parts.map((p) => [p.id, p]));
  for (const p of parts) {
    const r = role.get(p.id) ?? 'other';
    const b = p.bbox;
    if (r === 'body' || r === 'head') pivot.set(p.id, { x: b.x + b.width / 2, y: b.y + b.height });
    else if (APPENDAGES.has(r)) {
      // Where the part meets its parent: the point of the part nearest to the parent's centre.
      const host = byId.get(parent.get(p.id) ?? '') ?? root;
      const hc = centre(host);
      pivot.set(p.id, { x: clampTo(hc.x, b.x, b.x + b.width), y: clampTo(hc.y, b.y, b.y + b.height) });
    } else pivot.set(p.id, centre(p));
  }

  const swinging = new Set(parts.filter((p) => SWINGS.has(role.get(p.id) ?? 'other')).map((p) => p.id));
  return { parent, role, pivot, swinging, root: root.id };
}

// ── proposal ─────────────────────────────────────────────────────────────────

const REALISM: Record<StyleChoice, number> = { plano: 0.1, volumen: 0.5, realista: 0.9 };
const MOTION: Record<MotionChoice, Physics> = {
  rebote: { enabled: true, stiffness: 0.3, damping: 0.08 },
  suave: { enabled: true, stiffness: 0.45, damping: 0.45 },
  rigido: { enabled: false },
};
const MATERIAL: Record<MaterialChoice, Material> = {
  brillante: { finish: 'gloss', texture: 'none' },
  mate: { finish: 'matte', texture: 'none' },
  metal: { finish: 'metal', texture: 'none' },
  tela: { finish: 'matte', texture: 'fabric', textureStrength: 0.35 },
};
const STYLE_LABEL: Record<StyleChoice, string> = { plano: 'Dibujo plano', volumen: 'Ilustración con volumen', realista: 'Realista' };
const MOTION_LABEL: Record<MotionChoice, string> = { rebote: 'Rebotan', suave: 'Se balancean suave', rigido: 'Rígidas' };
const MATERIAL_LABEL: Record<MaterialChoice, string> = { brillante: 'Plástico brillante', mate: 'Mate', metal: 'Metálico', tela: 'Tela' };

const isUserFixed = (doc: AvatarDocument, path: string) => doc.provenance[path]?.by === 'user';

/** Drops what a person fixed: the assistant never competes with them. */
function respectLocks(doc: AvatarDocument, ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    if (op.op === 'updatePart') {
      const patch = Object.fromEntries(Object.entries(op.patch).filter(([k]) => !isUserFixed(doc, `part:${op.id}:${k}`)));
      if (Object.keys(patch).length > 0) out.push({ ...op, patch });
    } else if (op.op === 'setPersonality') {
      const patch = Object.fromEntries(Object.entries(op.patch).filter(([k]) => !isUserFixed(doc, `personality.${k}`)));
      if (Object.keys(patch).length > 0) out.push({ ...op, patch });
    } else if (op.op === 'setStyle') {
      const style = Object.fromEntries(Object.entries(op.style).filter(([k]) => !isUserFixed(doc, `style.${k}`)));
      if (Object.keys(style).length > 0) out.push({ ...op, style });
    } else if (!pathsOf(op).some((p) => isUserFixed(doc, p))) out.push(op);
  }
  return out;
}

function physicsOps(doc: AvatarDocument, ids: Iterable<string>, choice: MotionChoice, weight?: Intent['weight']): Op[] {
  const out: Op[] = [];
  for (const id of ids) {
    const part = doc.parts.find((p) => p.id === id);
    if (!part) continue;
    const physics: Physics = { ...part.physics, ...MOTION[choice] };
    if (choice === 'rigido') {
      delete physics.stiffness;
      delete physics.damping;
    }
    if (weight) physics.weight = weight === 'pesado' ? 0.8 : 0.2;
    out.push({ op: 'setPhysics', part: id, physics });
  }
  return out;
}

function materialOps(doc: AvatarDocument, choice: MaterialChoice): Op[] {
  return doc.parts.filter((p) => p.role !== 'text' && p.role !== 'background').map((p): Op => ({ op: 'setMaterial', part: p.id, material: { ...p.material, ...MATERIAL[choice] } }));
}

export class HeuristicAssistant implements Assistant {
  readonly name = 'heuristic';

  async propose({ doc, message, answers }: AssistantInput): Promise<Proposal> {
    const summary: string[] = [];
    const questions: Question[] = [];
    if (doc.parts.length === 0) {
      return { summary: ['Aún no hay piezas: sube primero un logo o una imagen y lo preparo a partir de ahí.'], ops: [], questions: [], confidence: 1, provider: this.name };
    }
    const intent = readIntent(message);
    let work = doc;
    const ops: Op[] = [];
    const commit = (batch: Op[]) => {
      const kept = respectLocks(work, batch);
      if (kept.length === 0) return;
      const r = applyOps(work, kept, 'ai');
      if (!r.ok) throw new Error(r.issues.map((i) => i.message).join(' '));
      work = r.doc;
      ops.push(...kept);
    };

    // 1. Skeleton, roles and pivots, only on a fresh import (everything still at the root).
    const fresh = doc.parts.length > 1 && doc.parts.every((p) => p.parent === null);
    let rig = inferRigging(work);
    if (rig && fresh) {
      commit(work.parts.map((p): Op => ({ op: 'updatePart', id: p.id, patch: { parent: rig!.parent.get(p.id) ?? null, role: rig!.role.get(p.id) ?? 'other', pivot: rig!.pivot.get(p.id) ?? p.pivot } })));
      const tree = work.parts.filter((p) => p.parent !== null && p.role !== 'text').map((p) => `${p.name} cuelga de ${work.parts.find((q) => q.id === p.parent)?.name}`);
      summary.push(`Esqueleto deducido de la forma: ${tree.length > 0 ? tree.slice(0, 6).join('; ') : 'una sola pieza principal'}${tree.length > 6 ? '…' : ''}.`);
      const texts = work.parts.filter((p) => p.role === 'text').length;
      if (texts > 0) summary.push(`${texts} piezas parecen letras: se mueven con el cuerpo, sin animación propia.`);
    } else if (!fresh) {
      rig = null;
    }

    // 2. Style: from the request, an earlier answer, or ask (with a reasoned default meanwhile).
    const styleFixed = isUserFixed(work, 'style.realism');
    const style = (answers['estilo'] as StyleChoice | undefined) ?? intent.style;
    if (style && REALISM[style] !== undefined) {
      commit([{ op: 'setStyle', style: { realism: REALISM[style] } }]);
      summary.push(`Estilo: ${STYLE_LABEL[style].toLowerCase()}${answers['estilo'] ? ' (tu respuesta)' : ' (lo pediste)'}.`);
    } else if (!styleFixed) {
      const raster = work.sources.some((s) => s.kind === 'png');
      const recommended: StyleChoice = raster ? 'volumen' : 'plano';
      questions.push({
        id: 'estilo',
        text: '¿Qué acabado buscas para el avatar?',
        why: 'Cambia a la vez el movimiento (rebote, peso) y el aspecto (brillos, sombras). No se deduce del logo.',
        recommended,
        options: (Object.keys(REALISM) as StyleChoice[]).map((k) => ({ id: k, label: STYLE_LABEL[k], detail: k === 'plano' ? 'Colores planos, movimientos exagerados.' : k === 'volumen' ? 'Sombras suaves, movimiento natural.' : 'Brillos y peso realistas, movimiento contenido.', ops: [{ op: 'setStyle', style: { realism: REALISM[k] } }] })),
      });
      commit([{ op: 'setStyle', style: { realism: REALISM[recommended] } }]);
    }

    // 3. Gravity and weight.
    if (intent.floating && !isUserFixed(work, 'world.gravity')) {
      commit([{ op: 'setWorld', world: { gravity: { strength: 0.2, angle: 90 } } }]);
      summary.push('Gravedad baja: el avatar flota.');
    }

    // 4. Swinging parts: how they behave is a question unless the request says it.
    const swinging = [...(rig?.swinging ?? new Set(work.parts.filter((p) => p.physics?.enabled).map((p) => p.id)))].filter((id) => !isUserFixed(work, `part:${id}:physics`));
    if (swinging.length > 0) {
      const names = swinging.map((id) => work.parts.find((p) => p.id === id)?.name ?? id);
      const motion = (answers['movimiento'] as MotionChoice | undefined) ?? intent.motion;
      if (motion && MOTION[motion]) {
        commit(physicsOps(work, swinging, motion, intent.weight));
        summary.push(`${names.join(', ')}: ${MOTION_LABEL[motion].toLowerCase()}.`);
      } else {
        const recommended: MotionChoice = work.style.realism < 0.4 ? 'rebote' : 'suave';
        questions.push({
          id: 'movimiento',
          text: `¿Cómo se comportan ${names.length === 1 ? names[0] : names.slice(0, 3).join(', ')} al moverse?`,
          why: 'Son piezas que cuelgan o sobresalen: su reacción da mucha personalidad y depende de qué material imaginas.',
          recommended,
          options: (Object.keys(MOTION) as MotionChoice[]).map((k) => ({ id: k, label: MOTION_LABEL[k], detail: k === 'rebote' ? 'Como un muelle o una gelatina.' : k === 'suave' ? 'Se mecen y se paran pronto.' : 'Se mueven con la pieza que las sostiene.', ops: physicsOps(work, swinging, k, intent.weight) })),
        });
        commit(physicsOps(work, swinging, recommended, intent.weight));
        summary.push(`Movimiento secundario en ${names.join(', ')}.`);
      }
    }

    // 5. Material: only matters once there is some volume.
    const material = (answers['material'] as MaterialChoice | undefined) ?? intent.material;
    if (material && MATERIAL[material]) {
      commit(materialOps(work, material));
      summary.push(`Material: ${MATERIAL_LABEL[material].toLowerCase()}.`);
    } else if (work.style.realism >= 0.4 && work.parts.some((p) => !p.material && p.role !== 'text')) {
      questions.push({
        id: 'material',
        text: '¿De qué material parece hecho?',
        why: 'Con volumen, el brillo y la textura se ven mucho; el logo plano no lo dice.',
        recommended: 'mate',
        options: (Object.keys(MATERIAL) as MaterialChoice[]).map((k) => ({ id: k, label: MATERIAL_LABEL[k], detail: k === 'brillante' ? 'Reflejo marcado, como un juguete.' : k === 'mate' ? 'Sin reflejos, suave.' : k === 'metal' ? 'Reflejo intenso y frío.' : 'Textura de tejido.', ops: materialOps(work, k) })),
      });
    }

    // 6. Personality from the request.
    const personality: Record<string, string> = {};
    if (intent.tone) personality['tone'] = intent.tone;
    if (intent.name) personality['displayName'] = intent.name;
    if (Object.keys(personality).length > 0) {
      commit([{ op: 'setPersonality', patch: personality }]);
      summary.push(`Personalidad: ${[intent.name && `se llama ${intent.name}`, intent.tone && `tono ${intent.tone}`].filter(Boolean).join(', ')}.`);
    }

    // 7. Starting animations for every state, built on the final skeleton and style.
    const missing = STATES.filter((s) => !work.states[s] && !isUserFixed(work, `state:${s}`));
    if (missing.length > 0) {
      commit(presetOps(work, missing));
      summary.push(`Animaciones de partida para ${missing.length} estados (reposo, hablar, pensar…).`);
    }

    if (ops.length === 0 && questions.length === 0) summary.push('No veo nada que cambiar con esto. Dime qué quieres distinto (más peso, otro brillo, otro tono…).');
    const confidence = questions.length === 0 ? 0.75 : 0.6;
    return { summary, ops, questions: questions.slice(0, 3), confidence, provider: this.name };
  }
}
