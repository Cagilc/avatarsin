// Flattens the hand-drawn Vex rig (assets/vex-2d/vex-rig.svg) into the sample the studio imports
// (public/samples/vex.svg): one top-level group per rig part, each holding only its own shapes.
// The studio's format draws a part by copying its node with its ancestors, so nested rig groups
// would draw their children twice; the pivots, poses and faces come from the format's sample
// module instead. SMIL animations, inline CSS poses, effects and the pivot overlay are dropped.
//
//   node scripts/vex-sample.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer, type Document as XDocument, type Element as XElement, type Node as XNode } from '@xmldom/xmldom';

const here = fileURLToPath(new URL('.', import.meta.url));
const IN = fileURLToPath(new URL('../../../assets/vex-2d/vex-rig.svg', import.meta.url));
const OUT = fileURLToPath(new URL('../public/samples/vex.svg', import.meta.url));

/** Groups that become parts, in the order they are written. Anything else with an id is left out. */
const PARTS = [
  'vx-hover',
  'vx-thruster',
  'vx-flame',
  'vx-torso',
  'vx-core',
  'vx-arm-L',
  'vx-elbow-L',
  'vx-hand-L',
  'vx-arm-R',
  'vx-elbow-R',
  'vx-hand-R',
  'vx-head',
  'vx-fin-L',
  'vx-fin-R',
  'vx-ear-L',
  'vx-ear-R',
  'vx-helmet',
  'vx-visor',
  'vx-eyes-neutral',
  'vx-eyes-happy',
  'vx-eyes-thinking',
  'vx-eyes-wow',
  'vx-eyes-success',
  'vx-mouth-neutral',
  'vx-mouth-happy',
  'vx-mouth-thinking',
  'vx-mouth-wow',
  'vx-mouth-success',
  'vx-vis-X',
  'vx-vis-A',
  'vx-vis-B',
  'vx-vis-C',
  'vx-vis-D',
  'vx-vis-E',
  'vx-vis-F',
  'vx-vis-G',
  'vx-vis-H',
];
/** Ids that are structure, not drawing: their own shapes are dropped with them. */
const SKIP = new Set(['vx-fx-curve', 'vx-fx-tablet', 'vx-pen', 'vx-pivots', 'vx-root', 'vx-face', 'vx-mouth']);
const DROP_ELEMENTS = new Set(['animate', 'animateTransform', 'metadata', 'title', 'desc']);
const DROP_ATTRS = new Set(['style', 'display', 'data-pivot', 'filter']);

const text = readFileSync(IN, 'utf8');
const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
const root = doc.documentElement!;

function children(n: XNode): XElement[] {
  const out: XElement[] = [];
  for (let i = 0; i < n.childNodes.length; i++) {
    const c = n.childNodes[i]!;
    if (c.nodeType === 1) out.push(c as XElement);
  }
  return out;
}

function byId(): Map<string, XElement> {
  const map = new Map<string, XElement>();
  const walk = (el: XElement) => {
    const id = el.getAttribute('id');
    if (id) map.set(id, el);
    for (const c of children(el)) walk(c);
  };
  walk(root);
  return map;
}

const isRigNode = (el: XElement) => {
  const id = el.getAttribute('id');
  return id !== null && (PARTS.includes(id) || SKIP.has(id));
};

/** A deep copy of `el` without nested rig groups, animations and inline poses. */
function ownCopy(out: XDocument, el: XElement): XElement {
  const copy = out.createElementNS('http://www.w3.org/2000/svg', el.localName!);
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i]!;
    if (DROP_ATTRS.has(a.name) || a.name.startsWith('xmlns')) continue;
    copy.setAttribute(a.name, a.value);
  }
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i]!;
    if (c.nodeType !== 1) continue;
    const ce = c as XElement;
    if (DROP_ELEMENTS.has(ce.localName!) || isRigNode(ce)) continue;
    copy.appendChild(ownCopy(out, ce));
  }
  return copy;
}

/** Wraps `inner` in shallow copies of the non-rig ancestors of `el` (their transforms and paint still apply). */
function withAncestors(out: XDocument, el: XElement, inner: XElement): XElement {
  let wrapped = inner;
  for (let p = el.parentNode as XElement | null; p && p !== root; p = p.parentNode as XElement | null) {
    if (isRigNode(p)) break;
    const wrap = out.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (let i = 0; i < p.attributes.length; i++) {
      const a = p.attributes[i]!;
      if (DROP_ATTRS.has(a.name) || a.name === 'id') continue;
      wrap.setAttribute(a.name, a.value);
    }
    wrap.appendChild(wrapped);
    wrapped = wrap;
  }
  return wrapped;
}

/** A shape itself, or a group with a shape somewhere inside. */
const hasShapes = (el: XElement): boolean => (el.localName !== 'g' ? !DROP_ELEMENTS.has(el.localName!) : children(el).some(hasShapes));

const out = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" width="400" height="500"></svg>', 'image/svg+xml');
const outRoot = out.documentElement!;
const ids = byId();

// Gradients, without the glow filter: the studio's materials take over the effects.
const defs = out.createElementNS('http://www.w3.org/2000/svg', 'defs');
for (const d of children(ids.get('vx-body')!.parentNode as XElement)) {
  if (d.localName === 'linearGradient') defs.appendChild(ownCopy(out, d));
}
outRoot.appendChild(defs);

let written = 0;
for (const id of PARTS) {
  const el = ids.get(id);
  if (!el) throw new Error(`Falta ${id} en el rig.`);
  const own = ownCopy(out, el);
  own.removeAttribute('id');
  if (!hasShapes(own)) throw new Error(`${id} no tiene formas propias.`);
  const g = out.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', id);
  g.appendChild(withAncestors(out, el, own));
  outRoot.appendChild(g);
  written += 1;
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generado por apps/studio/scripts/vex-sample.ts a partir de assets/vex-2d/vex-rig.svg: no editar a mano. -->\n${new XMLSerializer().serializeToString(out)}\n`;
writeFileSync(OUT, svg);
console.log(`${written} grupos → ${OUT} (${svg.length} bytes) desde ${here}`);
