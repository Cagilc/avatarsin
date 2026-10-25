import { cleanAttribute, SVG_ELEMENTS } from '@vexstudio/format';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export interface PreparedSvg {
  kind: 'svg';
  /** The source root after cleaning; ids are prefixed so several sources can share a page. */
  root: Element;
  viewBox: { x: number; y: number; width: number; height: number };
}
export interface PreparedPng {
  kind: 'png';
  url: string;
  width: number;
  height: number;
}
export type PreparedSource = PreparedSvg | PreparedPng;

function localName(el: Element): string {
  return el.localName;
}

/**
 * Applies the avatar SVG policy to a parsed tree. Disallowed elements become empty groups instead
 * of disappearing, so the element paths the parts point at keep their meaning.
 */
export function cleanTree(el: Element): void {
  for (const attr of [...el.attributes]) {
    const kept = cleanAttribute(localName(el), attr.name, attr.value);
    if (kept === null) el.removeAttribute(attr.name);
    else if (kept !== attr.value) el.setAttribute(attr.name, kept);
  }
  for (const child of [...el.childNodes]) {
    if (child.nodeType === 1) {
      const c = child as Element;
      if (!SVG_ELEMENTS.has(localName(c)) || c.namespaceURI !== SVG_NS) {
        el.replaceChild(el.ownerDocument.createElementNS(SVG_NS, 'g'), c);
      } else cleanTree(c);
    } else if (child.nodeType !== 3) {
      // Comments, processing instructions, CDATA: nothing to draw.
      el.removeChild(child);
    }
  }
}

/** Gives every id a prefix and rewrites the references that point at them. */
export function prefixIds(root: Element, prefix: string): void {
  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    const id = el.getAttribute('id');
    if (id) el.setAttribute('id', prefix + id);
  }
  for (const el of all) {
    for (const attr of [...el.attributes]) {
      if ((attr.name === 'href' || attr.name === 'xlink:href') && attr.value.startsWith('#')) {
        el.setAttribute(attr.name, `#${prefix}${attr.value.slice(1)}`);
      } else if (attr.value.includes('url(')) {
        el.setAttribute(attr.name, attr.value.replace(/url\(\s*(['"]?)#/g, `url($1#${prefix}`));
      }
    }
  }
}

function parseViewBox(root: Element): PreparedSvg['viewBox'] {
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) return { x: vb[0]!, y: vb[1]!, width: vb[2]!, height: vb[3]! };
  const w = parseFloat(root.getAttribute('width') ?? '') || 512;
  const h = parseFloat(root.getAttribute('height') ?? '') || 512;
  return { x: 0, y: 0, width: w, height: h };
}

export function prepareSvg(text: string, prefix: string): PreparedSvg {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NS || parsed.getElementsByTagName('parsererror').length > 0) {
    throw new Error('El recurso SVG no se puede leer.');
  }
  cleanTree(root);
  const viewBox = parseViewBox(root);
  prefixIds(root, prefix);
  return { kind: 'svg', root, viewBox };
}

/**
 * A copy of a source element ready to draw on its own: wrapped in shallow copies of its ancestors
 * so it keeps their transforms and inherited paint. Ids are dropped from the copy (the hidden
 * full copy in <defs> keeps them for references).
 */
export function detachedCopy(root: Element, el: Element): Element {
  const strip = (node: Element) => {
    node.removeAttribute('id');
    for (const d of node.querySelectorAll('[id]')) d.removeAttribute('id');
    return node;
  };
  let copy = strip(el.cloneNode(true) as Element);
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
    const wrap = strip(p.cloneNode(false) as Element);
    if (wrap.localName === 'svg' || wrap.localName === 'symbol') continue;
    wrap.appendChild(copy);
    copy = wrap;
  }
  return copy;
}

/** Elements of a source addressed by child-index paths (element children only). */
export function resolveNodes(root: Element, paths: readonly (readonly number[])[] | undefined): Element[] {
  if (!paths || paths.length === 0) return [...root.children].filter((c) => c.localName !== 'defs' && c.localName !== 'title' && c.localName !== 'desc');
  const out: Element[] = [];
  for (const path of paths) {
    let el: Element | undefined = root;
    for (const i of path) el = el?.children[i];
    if (el && el !== root) out.push(el);
  }
  return out;
}
