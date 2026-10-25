import type { Risk } from '@vex/operator';

/**
 * The registry of page elements Vex may know about. A host names them (`data-vex-id="…"` in the
 * markup, or `registry.register(id, element)` from code); nothing else on the page exists for
 * Vex. A snapshot describes each one (role, label, value) and is what later workflows read
 * (tours point at them, the DOM driver acts only on them).
 *
 * Private fields are never read: an element marked `data-vex-private`, anything inside one, and
 * form fields that hold secrets by their own type (passwords, card data, one-time codes) are left
 * out of the snapshot altogether, id included. Their value, label and text are not touched.
 */

export interface RegisterOptions {
  /** The risk of acting on this element, as the host declares it (`data-vex-risk`). */
  risk?: Risk;
  label?: string;
}

export interface ElementSnapshot {
  id: string;
  /** ARIA role, or one derived from the tag: button, link, textbox, combobox, checkbox, region… */
  role: string;
  label: string;
  /** Current value of a form field. */
  value?: string;
  /** Visible text of anything that is not a form field. */
  text?: string;
  risk?: Risk;
}

const RISKS = new Set<string>(['read', 'write', 'irreversible']);
const SECRET_TYPES = new Set(['password', 'hidden', 'file']);
const SECRET_AUTOCOMPLETE = /^(cc-|one-time-code$|current-password$|new-password$)/;
const MAX_ELEMENTS = 200;
const MAX_TEXT = 200;

function asRisk(value: string | null | undefined): Risk | undefined {
  return value && RISKS.has(value) ? (value as Risk) : undefined;
}

/** Fields a snapshot never reads, whatever the host says about them. */
export function isSecretField(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    if (SECRET_TYPES.has(el.type)) return true;
    if (SECRET_AUTOCOMPLETE.test(el.autocomplete)) return true;
  }
  return false;
}

/** Marked private by the host, directly or through an ancestor. */
export function isPrivate(el: Element): boolean {
  return el.closest('[data-vex-private]') !== null || isSecretField(el);
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return 'checkbox';
    if (el.type === 'radio') return 'radio';
    if (el.type === 'submit' || el.type === 'button') return 'button';
    return 'textbox';
  }
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'table') return 'table';
  if (tag === 'ul' || tag === 'ol') return 'list';
  return 'region';
}

const clip = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

function labelOf(el: Element, root: ParentNode): string {
  const own = el.getAttribute('aria-label') ?? el.getAttribute('data-vex-label');
  if (own) return clip(own);
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => root.querySelector(`#${CSS.escape(id)}`)?.textContent ?? '')
      .join(' ');
    if (clip(text)) return clip(text);
  }
  if (el.id) {
    const label = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent && clip(label.textContent)) return clip(label.textContent);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return clip(el.placeholder);
    const wrapping = el.closest('label');
    if (wrapping?.textContent && clip(wrapping.textContent)) return clip(wrapping.textContent);
  }
  if (el instanceof HTMLImageElement && el.alt) return clip(el.alt);
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || tag === 'a' || /^h[1-6]$/.test(tag)) return clip(el.textContent ?? '');
  return clip(el.getAttribute('title') ?? '');
}

function isField(el: Element): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

export class ElementRegistry {
  private readonly root: ParentNode;
  private readonly explicit = new Map<string, { element: Element; opts: RegisterOptions }>();

  constructor(root: ParentNode = document) {
    this.root = root;
  }

  /** Registers an element from code. The same id from markup is replaced by this one. */
  register(id: string, element: Element, opts: RegisterOptions = {}): void {
    if (!/^[A-Za-z][\w.-]{0,63}$/.test(id)) throw new Error(`Id de elemento no válido: ${id}`);
    this.explicit.set(id, { element, opts });
  }

  unregister(id: string): void {
    this.explicit.delete(id);
  }

  /** Every registered element still attached to the page: markup first, then code. Private ones are left out. */
  entries(): Array<{ id: string; element: Element; opts: RegisterOptions }> {
    const out = new Map<string, { id: string; element: Element; opts: RegisterOptions }>();
    for (const el of this.root.querySelectorAll('[data-vex-id]')) {
      const id = el.getAttribute('data-vex-id');
      if (!id || isPrivate(el)) continue;
      const opts: RegisterOptions = {};
      const risk = asRisk(el.getAttribute('data-vex-risk'));
      if (risk) opts.risk = risk;
      out.set(id, { id, element: el, opts });
    }
    for (const [id, { element, opts }] of this.explicit) {
      if (!element.isConnected || isPrivate(element)) continue;
      out.set(id, { id, element, opts });
    }
    return [...out.values()].slice(0, MAX_ELEMENTS);
  }

  get(id: string): Element | undefined {
    return this.entries().find((e) => e.id === id)?.element;
  }

  /** What Vex may know about the page right now. Reads only registered, non-private elements. */
  snapshot(): ElementSnapshot[] {
    return this.entries().map(({ id, element, opts }) => {
      const item: ElementSnapshot = { id, role: roleOf(element), label: opts.label ?? labelOf(element, this.root) };
      if (isField(element)) {
        if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) item.value = element.checked ? 'on' : 'off';
        else item.value = clip(element.value);
      } else if (item.role !== 'button' && item.role !== 'link' && item.role !== 'heading') {
        const text = clip(element.textContent ?? '');
        if (text) item.text = text;
      }
      if (opts.risk) item.risk = opts.risk;
      return item;
    });
  }
}
