import type { ActionOutcome, ActionRequest, Phase, Principal, QuickAction } from '@vex/operator';
import type { StateName } from '@vexstudio/format';
import { OperatorClient, type OperatorInfo, type StreamEvent, type VisibleAnnouncement } from './client.ts';
import { Director, PHASE_LABEL } from './director.ts';
import { ElementRegistry } from './registry.ts';
import { STYLES } from './styles.ts';

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
      this.emit('vex-engage', { announcements: this.news, quickActions: this.actions });
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
      [this.news, this.actions] = await Promise.all([features?.announcements ? client.announcements() : Promise.resolve([]), features?.quickActions ? client.quickActions() : Promise.resolve([])]);
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
    this.avatarEl?.setAttribute('state', state);
    this.emit('vex-state', { state });
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
