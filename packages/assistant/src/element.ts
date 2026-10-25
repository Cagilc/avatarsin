import type { ActionOutcome, ActionRequest, Phase, Principal, QuickAction, TourStep } from '@vex/operator';
import type { StateName } from '@vexstudio/format';
import { OperatorClient, type OperatorInfo, type StreamEvent, type VisibleAnnouncement, type VisibleTour } from './client.ts';
import { Director, PHASE_LABEL } from './director.ts';
import { ElementRegistry } from './registry.ts';
import { STYLES } from './styles.ts';
import { TourRun, type TourEvent } from './tour.ts';

/** What the panel keeps while a tour is on: its engine, the stage it draws on, and how to undo it. */
interface ActiveTour {
  run: TourRun;
  stage: HTMLDivElement;
  highlight: HTMLDivElement;
  bubble: HTMLDivElement;
  mascot: HTMLDivElement;
  target: Element | null;
  /** Listeners on the current target (click / input) and on the window. */
  undo: Array<() => void>;
  reduced: boolean;
}

const MASCOT_PX = 96;

/**
 * <vex-assistant api="https://vex.example">
 *
 * The whole operator panel in one tag: the chat, the steps of each run, the confirmation card
 * with what will really happen, Detener, and the avatar the studio published for this host,
 * driven by the operator's phases. Framework-free; a React page uses it like any element.
 *
 * The session token is never an attribute: the host sets the `getToken` property (a function that
 * returns the user's token for Vex Core), so nothing readable in the DOM carries it. On a local
 * Vex Core the `demo-user` attribute logs in as a demo user instead.
 *
 * Properties: getToken, context (screen context sent with every message), suggestions, registry.
 * Events: vex-ready, vex-phase, vex-turn, vex-error. Methods: send, stop, reset.
 */

export interface Step {
  id: string;
  summary: string;
  risk: ActionRequest['risk'];
  outcome: ActionOutcome | 'pending' | 'confirming';
  detail?: string;
}

export interface Turn {
  id: string;
  user: string;
  reply: string;
  steps: Step[];
  error?: string;
  cancelled?: boolean;
  done: boolean;
}

const OUTCOME_LABEL: Record<Step['outcome'], string> = {
  pending: 'en curso',
  confirming: 'espera tu OK',
  ok: 'hecho',
  error: 'error',
  denied: 'denegado',
  rejected: 'rechazado',
  invalid: 'inválido',
  cancelled: 'detenido',
};

/** Field names of a confirmation preview, as the card shows them. */
const DETAIL_LABEL: Record<string, string> = {
  para: 'Para',
  asunto: 'Asunto',
  cuerpo: 'Mensaje',
  servicio: 'Servicio',
  metodo: 'Método',
  url: 'URL',
  herramienta: 'Herramienta',
  argumentos: 'Datos',
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

export class VexAssistantElement extends HTMLElement {
  static observedAttributes = ['api', 'demo-user', 'avatar'];

  /** Returns the user's session token for Vex Core. Set by the host; never an attribute. */
  getToken: (() => Promise<string>) | null = null;
  /** The page elements Vex may know about (`data-vex-id`, `register`). */
  readonly registry: ElementRegistry;
  private ctx: Record<string, unknown> = {};
  private hints: string[] = [];
  private who: Principal | null = null;
  private news: VisibleAnnouncement[] = [];
  private actions: QuickAction[] = [];
  private tourList: VisibleTour[] = [];
  private tour: ActiveTour | null = null;
  /** Tours the person said "not now" to, for this page only. */
  private readonly laterTours = new Set<string>();
  /** The director's state while a tour holds the avatar, applied when the tour ends. */
  private heldState: StateName | null = null;

  private readonly shadow: ShadowRoot;
  private readonly els: {
    avatar: HTMLDivElement;
    name: HTMLElement;
    label: HTMLSpanElement;
    who: HTMLSpanElement;
    log: HTMLDivElement;
    actions: HTMLDivElement;
    form: HTMLFormElement;
    input: HTMLTextAreaElement;
    send: HTMLButtonElement;
    stop: HTMLButtonElement;
    hint: HTMLElement;
  };
  private client: OperatorClient | null = null;
  private infoData: OperatorInfo | null = null;
  private director: Director | null = null;
  private avatarEl: HTMLElement | null = null;
  private turns: Turn[] = [];
  private pending: ActionRequest | null = null;
  private phaseName: Phase = 'idle';
  private busy = false;
  private session: string | null = null;
  private loadSeq = 0;
  private settle = 0;

  constructor() {
    super();
    this.registry = new ElementRegistry(document);
    this.shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    const avatar = h('div', { class: 'avatar', 'aria-hidden': 'true' });
    const name = h('strong', { class: 'name' }, 'Vex');
    const label = h('span', { class: 'label', 'data-phase': 'idle' }, 'Vex');
    const who = h('span', { class: 'muted who' });
    const head = h('div', { class: 'vex-head' }, avatar, h('div', { class: 'vex-meta' }, name, label, who));
    const log = h('div', { class: 'log' });
    const input = h('textarea', { rows: '2', placeholder: 'Conectando…', disabled: '' });
    const send = h('button', { type: 'submit', class: 'btn primary', disabled: '' }, 'Enviar');
    const stop = h('button', { type: 'button', class: 'btn danger', hidden: '' }, 'Detener');
    const form = h('form', { class: 'composer' }, input, send, stop);
    const actions = h('div', { class: 'quick-actions', hidden: '', role: 'toolbar', 'aria-label': 'Accesos rápidos' });
    const hint = h('p', { class: 'hint' });
    this.shadow.append(style, head, log, actions, form, hint);
    this.els = { avatar, name, label, who, log, actions, form, input, send, stop, hint };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.send(input.value);
      }
    });
    stop.addEventListener('click', () => void this.stop());
  }

  /** What the user is looking at; travels with every message and shows in the footer. */
  get context(): Record<string, unknown> {
    return this.ctx;
  }
  set context(value: Record<string, unknown>) {
    this.ctx = value ?? {};
    this.renderHead();
  }

  /** Example requests shown while the conversation is empty. */
  get suggestions(): string[] {
    return this.hints;
  }
  set suggestions(value: string[]) {
    this.hints = value ?? [];
    if (this.turns.length === 0) this.renderLog();
  }

  /** Who Vex acts as, for the header. The demo login fills it; a host with its own token sets it. */
  get principal(): Principal | null {
    return this.who;
  }
  set principal(value: Principal | null) {
    this.who = value;
    this.renderHead();
  }

  /** The announcements the server gave this person (dismissed ones included). */
  get announcements(): VisibleAnnouncement[] {
    return this.news;
  }

  /** The quick-action buttons the server gave this person. */
  get quickActions(): QuickAction[] {
    return this.actions;
  }

  /** The tours the server gave this person, with whether they completed each. */
  get tours(): VisibleTour[] {
    return this.tourList;
  }

  /** The tour in progress, if any: its id and the index of the current step. */
  get activeTour(): { id: string; index: number } | null {
    return this.tour ? { id: this.tour.run.tour.id, index: this.tour.run.index } : null;
  }

  get phase(): Phase {
    return this.phaseName;
  }

  get sessionId(): string | null {
    return this.session;
  }

  /** What Vex Core said about itself and its host, once connected. */
  get info(): OperatorInfo | null {
    return this.infoData;
  }

  get avatar(): HTMLElement | null {
    return this.avatarEl;
  }

  connectedCallback(): void {
    void this.connect();
  }

  disconnectedCallback(): void {
    this.tour?.run.skip();
    this.director?.dispose();
    this.director = null;
    window.clearTimeout(this.settle);
  }

  attributeChangedCallback(_name: string, before: string | null, after: string | null): void {
    if (before !== after && this.isConnected) void this.connect();
  }

  /** Forgets the conversation (e.g. after the host switches user). */
  reset(): void {
    this.session = null;
    this.turns = [];
    this.pending = null;
    this.busy = false;
    this.setPhase('idle');
    this.renderLog();
    this.renderComposer();
  }

  /** Reconnects: reads /operator/info again and refreshes the avatar and the principal. */
  async refresh(): Promise<void> {
    await this.connect();
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private tokenFn(): (() => Promise<string>) | null {
    if (this.getToken) return this.getToken;
    const demo = this.getAttribute('demo-user');
    const api = this.getAttribute('api');
    if (demo && api) {
      let cached: Promise<string> | null = null;
      return () => {
        cached ??= OperatorClient.demoLogin(api, demo).then((r) => {
          this.principal = r.principal;
          return r.token;
        });
        return cached;
      };
    }
    return null;
  }

  private async connect(): Promise<void> {
    const api = this.getAttribute('api');
    const seq = ++this.loadSeq;
    this.client = null;
    if (!api) return;
    const token = this.tokenFn();
    try {
      const info = await OperatorClient.info(api);
      if (seq !== this.loadSeq) return;
      this.infoData = info;
      this.client = token ? new OperatorClient(api, token) : null;
      if (token) await token();
      if (seq !== this.loadSeq) return;
      this.director?.dispose();
      this.director = new Director({ greets: info.personality.greets, talkMs: info.personality.talkMs, onState: (s) => this.setAvatarState(s) });
      this.mountAvatar(info);
      this.renderHead();
      this.renderComposer();
      this.renderLog();
      this.emit('vex-ready', { info, principal: this.who });
      await this.loadEngage(info);
      if (seq !== this.loadSeq) return;
      this.renderActions();
      this.renderLog();
      this.emit('vex-engage', { announcements: this.news, quickActions: this.actions, tours: this.tourList });
      // A first-visit tour starts by itself, once, until the person completes it.
      const first = this.tourList.find((t) => t.when === 'first' && !t.done);
      if (first && !this.tour) void this.startTour(first.id);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      const message = `No llego a Vex Core (${err instanceof Error ? err.message : String(err)}).`;
      this.els.hint.replaceChildren(h('span', { class: 'error' }, message));
      this.emit('vex-error', { message });
    }
  }

  /** Announcements and buttons, only when the host switched them on; a failure leaves the panel usable. */
  private async loadEngage(info: OperatorInfo): Promise<void> {
    const client = this.client;
    if (!client) return;
    const features = info.host.features;
    try {
      [this.news, this.actions, this.tourList] = await Promise.all([
        features?.announcements ? client.announcements() : Promise.resolve([]),
        features?.quickActions ? client.quickActions() : Promise.resolve([]),
        features?.tours ? client.tours() : Promise.resolve([]),
      ]);
    } catch (err) {
      this.emit('vex-error', { message: `Novedades: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** Presses a quick action: a prompt goes to the chat; a tool runs through the operator loop. */
  async runQuickAction(id: string): Promise<void> {
    const action = this.actions.find((q) => q.id === id);
    if (!action || this.busy || !this.client) return;
    if (action.prompt !== undefined) return this.send(action.prompt);
    const client = this.client;
    await this.runTurn(`Botón: ${action.label}`, (onEvent) => client.runQuickAction(action.id, { ...(this.session ? { sessionId: this.session } : {}), context: this.ctx }, onEvent));
  }

  /** "Entendido": the announcement leaves the tray and the server remembers it for this person. */
  async dismiss(id: string): Promise<void> {
    const item = this.news.find((n) => n.id === id);
    if (!item || item.seen) return;
    item.seen = true;
    this.renderLog();
    try {
      await this.client?.markSeen(id);
    } catch {
      // Seen on this page anyway; the server will offer it again next time.
    }
  }

  private mountAvatar(info: OperatorInfo): void {
    this.avatarEl?.remove();
    this.avatarEl = null;
    const ref = info.host.avatar;
    if (!ref || this.getAttribute('avatar') === 'off' || !customElements.get('vex-avatar')) return;
    const el = document.createElement('vex-avatar');
    el.setAttribute('endpoint', ref.endpoint);
    el.setAttribute('public-key', ref.publicKey);
    el.setAttribute('key-id', ref.keyId);
    el.setAttribute('state', this.director?.state ?? 'idle');
    el.addEventListener('vex-ready', (e) => this.emit('vex-avatar', (e as CustomEvent).detail));
    el.addEventListener('vex-error', (e) => this.emit('vex-error', { message: `Avatar: ${(e as CustomEvent<{ reason: string }>).detail.reason}` }));
    this.els.avatar.replaceChildren(el);
    this.avatarEl = el;
  }

  private setAvatarState(state: StateName): void {
    // While a tour holds the avatar, the steps decide its pose; the phase is applied afterwards.
    if (this.tour) {
      this.heldState = state;
      return;
    }
    this.avatarEl?.setAttribute('state', state);
    this.emit('vex-state', { state });
  }

  // ── Tours ──────────────────────────────────────────────────────────────────

  /** Starts one of this person's tours (a completed one can be taken again). */
  async startTour(id: string): Promise<void> {
    const tour = this.tourList.find((t) => t.id === id);
    if (!tour) return;
    if (this.tour) this.tour.run.skip();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stage = h('div', { class: `tour-stage${reduced ? ' reduced' : ''}`, 'data-tour': tour.id });
    const highlight = h('div', { class: 'tour-highlight', hidden: '' });
    const bubble = h('div', { class: 'tour-bubble', role: 'dialog', 'aria-live': 'polite', 'aria-label': tour.title });
    const mascot = h('div', { class: 'tour-mascot', hidden: '' });
    stage.append(highlight, mascot, bubble);
    this.shadow.appendChild(stage);
    const active: ActiveTour = { run: new TourRun(tour, { exists: (t) => this.registry.get(t) !== undefined, onEvent: (e) => this.onTourEvent(e) }), stage, highlight, bubble, mascot, target: null, undo: [], reduced };
    this.tour = active;
    const reposition = () => this.placeTour();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') active.run.skip();
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('keydown', onKey);
    active.undo.push(() => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('keydown', onKey);
    });
    this.emit('vex-tour', { id: tour.id, event: 'start' });
    active.run.start();
  }

  private onTourEvent(event: TourEvent): void {
    const active = this.tour;
    if (!active) return;
    if (event.type === 'step') {
      this.showTourStep(active, event.step, event.index, event.of);
      this.emit('vex-tour', { id: active.run.tour.id, event: 'step', index: event.index, target: event.step.target ?? null });
      return;
    }
    void this.finishTour(active, event.completed, event.skipped);
  }

  private showTourStep(active: ActiveTour, step: TourStep, index: number, of: number): void {
    // Listeners of the previous target go; the window ones (first entry) stay.
    for (const undo of active.undo.splice(1)) undo();
    const target = step.target !== undefined ? (this.registry.get(step.target) ?? null) : null;
    active.target = target;
    if (target) {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: active.reduced ? 'auto' : 'smooth' });
      if (step.advanceOn === 'click' || step.advanceOn === 'input') {
        const type = step.advanceOn;
        const go = () => active.run.next();
        target.addEventListener(type, go, { once: true });
        active.undo.push(() => target.removeEventListener(type, go));
      }
    }
    // The avatar travels to the target; without one it speaks from its place in the panel.
    if (this.avatarEl) {
      if (target) {
        if (this.avatarEl.parentElement !== active.mascot) active.mascot.appendChild(this.avatarEl);
        active.mascot.hidden = false;
      } else {
        if (this.avatarEl.parentElement !== this.els.avatar) this.els.avatar.appendChild(this.avatarEl);
        active.mascot.hidden = true;
        this.avatarEl.removeAttribute('aim');
      }
      this.avatarEl.setAttribute('state', step.pose);
    }
    const last = index === of - 1;
    const next = h('button', { type: 'button', class: 'btn primary' }, last ? 'Terminar' : 'Siguiente');
    next.addEventListener('click', () => active.run.next());
    const skip = h('button', { type: 'button', class: 'btn' }, 'Saltar');
    skip.addEventListener('click', () => active.run.skip());
    const buttons = step.advanceOn === 'next' ? [next, skip] : [skip];
    const hint = step.advanceOn === 'click' ? 'Pulsa el elemento señalado para seguir.' : step.advanceOn === 'input' ? 'Escribe en el elemento señalado para seguir.' : null;
    active.bubble.replaceChildren(
      h('span', { class: 'tour-count' }, `${active.run.tour.title} · ${index + 1} de ${of}`),
      h('p', {}, step.say),
      ...(hint ? [h('p', { class: 'muted' }, hint)] : []),
      h('div', { class: 'tour-actions' }, ...buttons),
    );
    active.highlight.hidden = !target;
    this.placeTour();
    (step.advanceOn === 'next' ? next : skip).focus({ preventScroll: true });
  }

  /** Puts highlight, mascot and bubble around the current target (or by the panel's avatar). */
  private placeTour(): void {
    const active = this.tour;
    if (!active) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 6;
    const anchor = active.target ? active.target.getBoundingClientRect() : this.els.avatar.getBoundingClientRect();
    if (active.target) {
      Object.assign(active.highlight.style, { left: `${anchor.left - pad}px`, top: `${anchor.top - pad}px`, width: `${anchor.width + 2 * pad}px`, height: `${anchor.height + 2 * pad}px` });
      // The mascot stands at the side with room, at the target's height, and points across.
      const left = anchor.left - MASCOT_PX - 14 >= 0 ? anchor.left - MASCOT_PX - 14 : Math.min(anchor.right + 14, vw - MASCOT_PX);
      const top = Math.max(8, Math.min(anchor.top + anchor.height / 2 - MASCOT_PX / 2, vh - MASCOT_PX - 8));
      Object.assign(active.mascot.style, { left: `${left}px`, top: `${top}px` });
      const dx = anchor.left + anchor.width / 2 - (left + MASCOT_PX / 2);
      const dy = anchor.top + anchor.height / 2 - (top + MASCOT_PX / 2);
      this.avatarEl?.setAttribute('aim', String(Math.round((Math.atan2(dy, dx) * 180) / Math.PI)));
    }
    const bubbleW = Math.min(340, vw - 32);
    const bubbleH = active.bubble.offsetHeight || 120;
    const below = anchor.bottom + 12 + bubbleH <= vh;
    const top = below ? anchor.bottom + 12 : Math.max(8, anchor.top - 12 - bubbleH);
    const left = Math.max(16, Math.min(anchor.left, vw - bubbleW - 16));
    Object.assign(active.bubble.style, { left: `${left}px`, top: `${top}px`, width: `${bubbleW}px` });
  }

  private async finishTour(active: ActiveTour, completed: boolean, skipped: string[]): Promise<void> {
    for (const undo of active.undo) undo();
    active.stage.remove();
    if (this.avatarEl) {
      if (this.avatarEl.parentElement !== this.els.avatar) this.els.avatar.appendChild(this.avatarEl);
      this.avatarEl.removeAttribute('aim');
    }
    this.tour = null;
    const held = this.heldState ?? this.director?.state ?? 'idle';
    this.heldState = null;
    this.setAvatarState(held);
    const tour = this.tourList.find((t) => t.id === active.run.tour.id);
    if (completed) {
      this.director?.celebrate();
      if (tour) tour.done = true;
      try {
        await this.client?.markTourDone(active.run.tour.id);
      } catch {
        // Done on this page anyway; the server will offer it again next time.
      }
    }
    this.renderLog();
    this.emit('vex-tour', { id: active.run.tour.id, event: completed ? 'done' : 'skipped', skipped });
  }

  private setPhase(phase: Phase): void {
    this.phaseName = phase;
    this.director?.setPhase(phase);
    this.els.label.dataset['phase'] = phase;
    this.els.label.textContent = phase === 'idle' ? this.infoData?.personality.name ?? 'Vex' : PHASE_LABEL[phase];
    this.emit('vex-phase', { phase });
  }

  /** Sends a request. Does nothing while a run is in progress. */
  async send(message: string): Promise<void> {
    const text = message.trim();
    if (!text || this.busy || !this.client) return;
    const client = this.client;
    await this.runTurn(text, (onEvent) => client.chat({ ...(this.session ? { sessionId: this.session } : {}), message: text, context: this.ctx }, onEvent));
  }

  /** One turn of the conversation, whatever started it: the stream's events drive the log and the phases. */
  private async runTurn(text: string, start: (onEvent: (event: StreamEvent) => void) => Promise<void>): Promise<void> {
    const turnId = crypto.randomUUID();
    const turn: Turn = { id: turnId, user: text, reply: '', steps: [], done: false };
    this.turns.push(turn);
    this.busy = true;
    this.pending = null;
    this.els.input.value = '';
    this.setPhase('thinking');
    this.renderComposer();
    this.renderLog();

    const onEvent = (event: StreamEvent) => {
      switch (event.type) {
        case 'session':
          this.session = event.sessionId;
          break;
        case 'phase':
          this.setPhase(event.phase);
          break;
        case 'text':
          turn.reply += event.delta;
          break;
        case 'confirm':
          this.pending = event.action;
          turn.steps.push({ id: event.action.id, summary: event.action.summary, risk: event.action.risk, outcome: 'confirming' });
          break;
        case 'tool_call': {
          this.pending = null;
          const step = turn.steps.find((s) => s.id === event.action.id);
          if (step) step.outcome = 'pending';
          else turn.steps.push({ id: event.action.id, summary: event.action.summary, risk: event.action.risk, outcome: 'pending' });
          break;
        }
        case 'tool_result': {
          this.pending = null;
          const step = turn.steps.find((s) => s.id === event.id);
          if (step) {
            step.outcome = event.outcome;
            step.detail = event.summary;
          } else turn.steps.push({ id: event.id, summary: event.summary, risk: 'read', outcome: event.outcome, detail: event.summary });
          break;
        }
        case 'done':
          turn.reply = event.reply;
          turn.done = true;
          break;
        case 'error':
          turn.error = event.message;
          turn.done = true;
          break;
        case 'cancelled':
          this.pending = null;
          turn.cancelled = true;
          turn.done = true;
          break;
        case 'progress':
          break;
      }
      this.renderLog();
    };

    try {
      await start(onEvent);
      const allOk = !turn.error && !turn.cancelled && turn.steps.length > 0 && turn.steps.every((s) => s.outcome === 'ok');
      this.busy = false;
      this.pending = null;
      this.setPhase(allOk ? 'success' : this.phaseName === 'error' ? 'error' : 'idle');
      window.clearTimeout(this.settle);
      this.settle = window.setTimeout(() => {
        if (!this.busy) this.setPhase('idle');
      }, 1200);
    } catch (err) {
      turn.error = err instanceof Error ? err.message : String(err);
      turn.done = true;
      this.busy = false;
      this.pending = null;
      this.setPhase('error');
    } finally {
      this.renderComposer();
      this.renderLog();
      this.emit('vex-turn', { turn });
    }
  }

  /** The user's answer to the pending confirmation. */
  async decide(approved: boolean): Promise<void> {
    const pending = this.pending;
    if (!this.client || !pending || !this.session) return;
    this.pending = null;
    this.setPhase(approved ? 'working' : 'thinking');
    this.renderLog();
    await this.client.confirm(this.session, pending.id, approved);
  }

  /** Detener: Vex Core aborts the run; the stream then ends with `cancelled`. */
  async stop(): Promise<void> {
    if (!this.client || !this.session) return;
    this.pending = null;
    this.renderLog();
    await this.client.stop(this.session);
  }

  private renderHead(): void {
    const name = this.infoData?.personality.name ?? 'Vex';
    this.els.name.textContent = name;
    if (this.phaseName === 'idle') this.els.label.textContent = name;
    this.els.who.textContent = this.who ? `actúa como ${this.who.name}` : '';
    this.els.hint.replaceChildren('Contexto que viaja con el mensaje: ', h('code', {}, JSON.stringify(this.ctx)));
  }

  private renderComposer(): void {
    const ready = this.client !== null;
    const name = this.infoData?.personality.name ?? 'Vex';
    this.els.input.placeholder = ready ? `Dile a ${name} qué hacer…` : 'Conectando…';
    this.els.input.disabled = !ready || this.busy;
    this.els.send.hidden = this.busy;
    this.els.send.disabled = !ready;
    this.els.stop.hidden = !this.busy;
    for (const b of this.els.actions.querySelectorAll('button')) b.disabled = !ready || this.busy;
    this.renderHead();
  }

  private renderActions(): void {
    const row = this.els.actions;
    row.replaceChildren();
    for (const q of this.actions) {
      const b = h('button', { type: 'button', class: 'quick-action', 'data-id': q.id, title: q.tool ? `Herramienta: ${q.tool}` : 'Pregunta al chat' }, q.icon ? `${q.icon} ${q.label}` : q.label);
      b.disabled = this.busy || this.client === null;
      b.addEventListener('click', () => void this.runQuickAction(q.id));
      row.appendChild(b);
    }
    row.hidden = this.actions.length === 0;
  }

  private renderLog(): void {
    const log = this.els.log;
    const frag = document.createDocumentFragment();
    const unseen = this.news.filter((n) => !n.seen);
    if (unseen.length > 0) {
      // Plain text from the administrator, built as text nodes: never HTML.
      const tray = h('div', { class: 'news', role: 'region', 'aria-label': 'Novedades' });
      for (const n of unseen) {
        const item = h('article', { class: 'news-item', 'data-id': n.id }, h('strong', {}, n.title), h('p', {}, n.body));
        const actions = h('div', { class: 'news-actions' });
        if (n.cta?.kind === 'quickAction') {
          const id = n.cta.id;
          const go = h('button', { type: 'button', class: 'btn primary' }, this.actions.find((q) => q.id === id)?.label ?? 'Probar');
          go.addEventListener('click', () => void this.runQuickAction(id));
          actions.appendChild(go);
        } else if (n.cta?.kind === 'link') {
          actions.appendChild(h('a', { class: 'btn', href: n.cta.url, target: '_blank', rel: 'noopener noreferrer' }, n.cta.label));
        }
        const ok = h('button', { type: 'button', class: 'btn' }, 'Entendido');
        ok.addEventListener('click', () => void this.dismiss(n.id));
        actions.appendChild(ok);
        item.appendChild(actions);
        tray.appendChild(item);
      }
      frag.appendChild(tray);
    }
    const offered = this.tourList.filter((t) => !t.done && !this.laterTours.has(t.id));
    if (offered.length > 0) {
      const tray = h('div', { class: 'news', role: 'region', 'aria-label': 'Tours' });
      for (const t of offered) {
        const go = h('button', { type: 'button', class: 'btn primary' }, 'Empezar');
        go.addEventListener('click', () => void this.startTour(t.id));
        const later = h('button', { type: 'button', class: 'btn' }, 'Ahora no');
        later.addEventListener('click', () => {
          this.laterTours.add(t.id);
          this.renderLog();
        });
        tray.appendChild(h('article', { class: 'news-item tour-card', 'data-id': t.id }, h('strong', {}, `Tour: ${t.title}`), h('p', {}, `${t.steps.length} ${t.steps.length === 1 ? 'paso' : 'pasos'}. Te lo enseño señalando en la página.`), h('div', { class: 'news-actions' }, go, later)));
      }
      frag.appendChild(tray);
    }
    if (this.turns.length === 0) {
      const empty = h('div', { class: 'empty' }, h('p', {}, 'Pídeme algo sobre la plataforma.' + (this.hints.length ? ' Por ejemplo:' : '')));
      for (const s of this.hints) {
        const b = h('button', { type: 'button', class: 'suggestion' }, s);
        b.addEventListener('click', () => {
          this.els.input.value = s;
          this.els.input.focus();
        });
        empty.appendChild(b);
      }
      frag.appendChild(empty);
    }
    for (const turn of this.turns) {
      const box = h('div', { class: 'turn' }, h('div', { class: 'msg user' }, turn.user));
      if (turn.steps.length > 0) {
        const ol = h('ol', { class: 'steps' });
        for (const s of turn.steps) {
          const text = h('span', { class: 'step-text' }, s.summary);
          if (s.outcome !== 'ok' && s.outcome !== 'pending' && s.detail && s.detail !== s.summary) text.appendChild(h('em', {}, ` · ${s.detail}`));
          ol.appendChild(h('li', { class: `step is-${s.outcome}` }, h('span', { class: 'step-dot', 'aria-hidden': 'true' }), text, h('span', { class: 'step-state' }, OUTCOME_LABEL[s.outcome])));
        }
        box.appendChild(ol);
      }
      if (this.pending && !turn.done) box.appendChild(this.renderConfirm(this.pending));
      if (turn.cancelled) box.appendChild(h('div', { class: 'msg vex is-stopped' }, 'Detenido. No he hecho nada más.'));
      else if (turn.reply || turn.error) box.appendChild(h('div', { class: `msg vex${turn.error ? ' is-error' : ''}` }, turn.error ?? turn.reply));
      frag.appendChild(box);
    }
    log.replaceChildren(frag);
    log.scrollTo({ top: log.scrollHeight });
  }

  private renderConfirm(action: ActionRequest): HTMLElement {
    const id = `c-${action.id}`;
    const card = h('div', { class: 'confirm', role: 'alertdialog', 'aria-labelledby': id }, h('p', { id }, h('strong', {}, 'Necesito tu OK:'), ` ${action.summary}`));
    if (action.details) {
      const dl = h('dl', { class: 'confirm-details' });
      for (const [key, value] of Object.entries(action.details)) {
        dl.appendChild(h('div', { class: `confirm-row is-${key}` }, h('dt', {}, DETAIL_LABEL[key] ?? key), h('dd', {}, typeof value === 'string' ? value : JSON.stringify(value))));
      }
      card.appendChild(dl);
    } else card.appendChild(h('p', { class: 'muted' }, `Parámetros: ${JSON.stringify(action.params)}`));
    card.appendChild(h('p', { class: 'muted' }, `Acción irreversible (${action.tool}). Esto es lo que se enviará tal cual.`));
    const yes = h('button', { type: 'button', class: 'btn primary' }, 'Aprobar');
    const no = h('button', { type: 'button', class: 'btn' }, 'Rechazar');
    yes.addEventListener('click', () => void this.decide(true));
    no.addEventListener('click', () => void this.decide(false));
    card.appendChild(h('div', { class: 'confirm-actions' }, yes, no));
    return card;
  }
}

export function defineVexAssistant(tag = 'vex-assistant'): void {
  if (!customElements.get(tag)) customElements.define(tag, VexAssistantElement);
}
