import { importPublicKey, STATES, verifyAsset, verifyPackage, type AvatarDocument, type StateName } from '@vexstudio/format';
import { AvatarPlayer, type LoadedAsset } from './player.ts';

/**
 * <vex-avatar endpoint="https://studio.example/v1/embed/<key>" public-key="…" key-id="…" state="idle">
 *
 * Downloads a published avatar, checks the studio's signature and every asset's hash, and only
 * then draws it. Anything that fails a check is not drawn and a `vex-error` event says why.
 * The host drives it through the `state` attribute (idle, talk, think, happy, wave, attention,
 * error, sleep), the same vocabulary as the Vex operator's director.
 */
export class VexAvatarElement extends HTMLElement {
  static observedAttributes = ['state', 'endpoint', 'public-key', 'key-id'];

  private player: AvatarPlayer | null = null;
  private doc: AvatarDocument | null = null;
  private loading: AbortController | null = null;
  private readonly box: HTMLDivElement;
  private urls: string[] = [];

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{display:inline-block;width:160px;height:160px;contain:content}div{width:100%;height:100%}';
    this.box = document.createElement('div');
    this.box.setAttribute('role', 'img');
    shadow.append(style, this.box);
  }

  /** The verified document (personality and capabilities for the host), once loaded. */
  get avatar(): AvatarDocument | null {
    return this.doc;
  }

  connectedCallback(): void {
    void this.load();
  }

  disconnectedCallback(): void {
    this.loading?.abort();
    this.teardown();
  }

  attributeChangedCallback(name: string, before: string | null, after: string | null): void {
    if (before === after) return;
    if (name === 'state') {
      const s = after as StateName;
      if (this.player && (STATES as readonly string[]).includes(s)) this.player.setState(s);
    } else if (this.isConnected) void this.load();
  }

  private teardown(): void {
    this.player?.dispose();
    this.player = null;
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
  }

  private fail(reason: string): void {
    this.teardown();
    this.dispatchEvent(new CustomEvent('vex-error', { detail: { reason } }));
  }

  private async load(): Promise<void> {
    const endpoint = this.getAttribute('endpoint');
    const rawKey = this.getAttribute('public-key');
    const keyId = this.getAttribute('key-id');
    if (!endpoint || !rawKey || !keyId) return;
    this.loading?.abort();
    const ctrl = new AbortController();
    this.loading = ctrl;
    const base = endpoint.replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/package`, { credentials: 'omit', signal: ctrl.signal });
      if (!res.ok) return this.fail(`El estudio respondió ${res.status}.`);
      const verified = await verifyPackage(await res.json(), await importPublicKey(rawKey), keyId);
      if (!verified.ok) return this.fail(verified.reason);

      const assets = new Map<string, LoadedAsset>();
      const urls: string[] = [];
      for (const ref of verified.pkg.assets) {
        const r = await fetch(`${base}/assets/${ref.hash}`, { credentials: 'omit', signal: ctrl.signal });
        if (!r.ok) return this.fail(`No se pudo descargar un recurso (${r.status}).`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!(await verifyAsset(bytes, ref))) return this.fail('Un recurso no coincide con su huella: se ha modificado.');
        if (ref.type === 'image/svg+xml') assets.set(ref.hash, { type: ref.type, text: new TextDecoder().decode(bytes) });
        else {
          const url = URL.createObjectURL(new Blob([bytes], { type: ref.type }));
          urls.push(url);
          assets.set(ref.hash, { type: ref.type, url });
        }
      }
      if (ctrl.signal.aborted) return;

      this.teardown();
      this.urls = urls;
      this.doc = verified.doc;
      this.box.setAttribute('aria-label', verified.doc.personality.displayName);
      const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.player = new AvatarPlayer(this.box, verified.doc, assets, { reducedMotion });
      const s = this.getAttribute('state') as StateName | null;
      if (s && (STATES as readonly string[]).includes(s)) this.player.setState(s);
      this.dispatchEvent(new CustomEvent('vex-ready', { detail: { name: verified.doc.personality.displayName, revision: verified.pkg.revision } }));
    } catch (err) {
      if (!ctrl.signal.aborted) this.fail(err instanceof Error ? err.message : String(err));
    }
  }
}

export function defineVexAvatar(tag = 'vex-avatar'): void {
  if (!customElements.get(tag)) customElements.define(tag, VexAvatarElement);
}
