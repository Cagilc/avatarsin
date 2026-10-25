import { effectiveMaterial, type AvatarDocument, type Clip, type Part, type StateName } from '@vexstudio/format';
import { toSvg } from './math.ts';
import { materialFilter } from './materials.ts';
import { Rig, type PartPose, type Pose } from './rig.ts';
import { detachedCopy, prepareSvg, resolveNodes, SVG_NS, type PreparedSource } from './svgsource.ts';
import { blend, clipPhase, sampleClip, type Sample } from './timeline.ts';

/** A loaded asset: SVG text, or an object URL for a PNG. */
export type LoadedAsset = { type: 'image/svg+xml'; text: string } | { type: 'image/png'; url: string };

export interface PlayerOptions {
  /** Static avatar: no animation and no physics (users who ask the system for less motion). */
  reducedMotion?: boolean;
  /** Called after each frame with the pose, e.g. to draw editor handles on top. */
  onFrame?: (pose: Pose) => void;
  /** Start playing at once (default true). */
  autoplay?: boolean;
}

const FADE_S = 0.25;
let instances = 0;

/**
 * Draws an avatar document and plays its states. The DOM is built once per document; each frame
 * only updates the transform and opacity of every part.
 */
export class AvatarPlayer {
  readonly svg: SVGSVGElement;
  private doc: AvatarDocument;
  private assets: Map<string, LoadedAsset>;
  private readonly opts: PlayerOptions;
  private readonly rig: Rig;
  private readonly uid = `vx${(instances++).toString(36)}`;
  private nodes = new Map<string, SVGGElement>();
  private stateName: StateName = 'idle';
  private current: { clip: Clip | undefined; start: number } = { clip: undefined, start: 0 };
  private previous: { clip: Clip | undefined; start: number; until: number } | null = null;
  private clock = 0;
  private last: number | null = null;
  private raf = 0;
  private playing = false;
  private rest = false;
  private lastPose: Pose = new Map();

  constructor(container: Element, doc: AvatarDocument, assets: Map<string, LoadedAsset>, opts: PlayerOptions = {}) {
    this.doc = doc;
    this.assets = assets;
    this.opts = opts;
    this.rig = new Rig(doc);
    this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');
    this.svg.style.display = 'block';
    this.svg.style.overflow = 'visible';
    container.appendChild(this.svg);
    this.build();
    this.selectClip(true);
    this.renderAt(0);
    if (opts.autoplay !== false && !opts.reducedMotion) this.play();
  }

  get document(): AvatarDocument {
    return this.doc;
  }

  get state(): StateName {
    return this.stateName;
  }

  /** Replace the document (live editing). Physics state is kept for parts that still exist. */
  setDocument(doc: AvatarDocument, assets?: Map<string, LoadedAsset>): void {
    this.doc = doc;
    if (assets) this.assets = assets;
    this.rig.setDocument(doc);
    this.build();
    this.selectClip(true);
    this.draw(this.rig.frame(this.sample(), 0, !this.rest));
  }

  setState(state: StateName): void {
    if (state === this.stateName) return;
    this.stateName = state;
    this.selectClip(false);
  }

  /** Editor mode: draw the rest pose (no animation, no physics). */
  showRest(rest: boolean): void {
    this.rest = rest;
    if (rest) this.rig.reset();
    this.draw(this.rig.frame(this.sample(), 0, !rest));
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.last = null;
    const tick = (now: number) => {
      if (!this.playing) return;
      const dt = this.last === null ? 0 : (now - this.last) / 1000;
      this.last = now;
      this.advance(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Advance the clock by `dt` seconds and draw (also used by tests for deterministic frames). */
  advance(dt: number): void {
    this.clock += dt;
    // A one-shot clip (attention, error) returns to idle when it ends.
    const c = this.current.clip;
    if (c && !c.loop && this.clock - this.current.start >= c.duration) {
      const idle = this.clipFor('idle');
      if (idle && idle !== c) this.fadeTo(idle);
    }
    this.draw(this.rig.frame(this.sample(), this.rest ? 0 : dt, !this.rest && !this.opts.reducedMotion));
  }

  /** Draw at an absolute time from the start of the current clip, without physics. */
  renderAt(seconds: number): void {
    this.clock = this.current.start + seconds;
    this.draw(this.rig.frame(this.sample(), 0, false));
  }

  poseOf(id: string): PartPose | undefined {
    return this.lastPose.get(id);
  }

  dispose(): void {
    this.pause();
    this.svg.remove();
  }

  private clipFor(state: StateName): Clip | undefined {
    const id = this.doc.states[state] ?? this.doc.states.idle;
    return this.doc.clips.find((c) => c.id === id);
  }

  private selectClip(immediate: boolean): void {
    const clip = this.clipFor(this.stateName);
    if (immediate) {
      this.current = { clip, start: this.clock };
      this.previous = null;
    } else this.fadeTo(clip);
  }

  private fadeTo(clip: Clip | undefined): void {
    this.previous = { ...this.current, until: this.clock + FADE_S };
    this.current = { clip, start: this.clock };
  }

  private sample(): Sample {
    if (this.rest || this.opts.reducedMotion) return new Map();
    const now = this.current.clip ? sampleClip(this.current.clip, this.clock - this.current.start) : new Map();
    if (this.previous && this.clock < this.previous.until) {
      const before = this.previous.clip ? sampleClip(this.previous.clip, this.clock - this.previous.start) : new Map();
      return blend(before, now, 1 - (this.previous.until - this.clock) / FADE_S);
    }
    this.previous = null;
    return now;
  }

  /** Normalized time of the current clip (for the editor's timeline). */
  get phase(): number {
    return this.current.clip ? clipPhase(this.current.clip, this.clock - this.current.start) : 0;
  }

  private draw(pose: Pose): void {
    this.lastPose = pose;
    for (const [id, p] of pose) {
      const g = this.nodes.get(id);
      if (!g) continue;
      g.setAttribute('transform', toSvg(p.world));
      if (p.opacity < 0.999) g.setAttribute('opacity', p.opacity.toFixed(3));
      else g.removeAttribute('opacity');
    }
    this.opts.onFrame?.(pose);
  }

  private build(): void {
    const { doc, svg, uid } = this;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${doc.canvas.width} ${doc.canvas.height}`);
    const defs = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(defs);

    const prepared = new Map<string, PreparedSource>();
    for (const source of doc.sources) {
      const asset = this.assets.get(source.asset);
      if (!asset) continue;
      if (asset.type === 'image/svg+xml') {
        try {
          const p = prepareSvg(asset.text, `${uid}-${source.id}-`);
          prepared.set(source.id, p);
          // A hidden full copy keeps every id resolvable (gradients, clip paths, <use> targets).
          const hidden = document.createElementNS(SVG_NS, 'g');
          for (const child of [...p.root.children]) hidden.appendChild(document.importNode(child, true));
          defs.appendChild(hidden);
        } catch {
          // An unreadable source draws nothing; the rest of the avatar still works.
        }
      } else prepared.set(source.id, { kind: 'png', url: asset.url, width: source.width, height: source.height });
    }

    this.nodes = new Map();
    const parts = doc.parts.map((p, i) => ({ p, i })).sort((a, b) => a.p.z - b.p.z || a.i - b.i);
    for (const { p: part } of parts) {
      const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      g.setAttribute('data-part', part.id);
      if (!part.visible) g.setAttribute('display', 'none');
      const content = this.partContent(part, prepared, defs);
      if (content) g.appendChild(content);
      svg.appendChild(g);
      this.nodes.set(part.id, g);
    }
  }

  private partContent(part: Part, prepared: Map<string, PreparedSource>, defs: Element): Element | null {
    const source = this.doc.sources.find((s) => s.id === part.source);
    const prep = source && prepared.get(source.id);
    if (!source || !prep) return null;
    // Canvas coordinates at rest: the source placed where the document says.
    const placed = document.createElementNS(SVG_NS, 'g');
    const { x, y, scale } = source.placement;
    if (prep.kind === 'svg') {
      placed.setAttribute('transform', `translate(${x} ${y}) scale(${scale}) translate(${-prep.viewBox.x} ${-prep.viewBox.y})`);
      for (const node of resolveNodes(prep.root, part.nodes)) placed.appendChild(document.importNode(detachedCopy(prep.root, node), true));
    } else {
      placed.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
      const crop = part.crop ?? { x: 0, y: 0, width: prep.width, height: prep.height };
      const view = document.createElementNS(SVG_NS, 'svg');
      for (const [k, v] of Object.entries({ x: crop.x, y: crop.y, width: crop.width, height: crop.height, viewBox: `${crop.x} ${crop.y} ${crop.width} ${crop.height}`, overflow: 'hidden' })) view.setAttribute(k, String(v));
      const img = document.createElementNS(SVG_NS, 'image');
      for (const [k, v] of Object.entries({ x: 0, y: 0, width: prep.width, height: prep.height, href: prep.url })) img.setAttribute(k, String(v));
      view.appendChild(img);
      placed.appendChild(view);
    }

    const filter = materialFilter(`${this.uid}-m-${part.id}`, effectiveMaterial(part, this.doc), part.bbox);
    if (!filter) return placed;
    defs.appendChild(filter);
    const wrap = document.createElementNS(SVG_NS, 'g');
    wrap.setAttribute('filter', `url(#${filter.getAttribute('id')})`);
    wrap.appendChild(placed);
    return wrap;
  }
}
