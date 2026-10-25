import type { Phase } from '@vex/operator';
import type { StateName } from '@vexstudio/format';

/**
 * The director: translates operator phases into the studio avatar's states, with the moments
 * that have a duration of their own (a greeting on load, lip movement after a reply, a short
 * celebration). It is the only piece that knows both vocabularies; the avatar stays a view.
 */

export interface DirectorOptions {
  /** Wave on load. */
  greets: boolean;
  /** Milliseconds the avatar keeps talking after a reply before settling. */
  talkMs: number;
  onState: (state: StateName) => void;
  /** Injected clock for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export const TIMING = { greetingMs: 1800, successMs: 1200, celebrateMs: 1200 } as const;

const PHASE_STATE: Record<Phase, StateName> = {
  idle: 'idle',
  listening: 'attention',
  thinking: 'think',
  working: 'think',
  awaiting_confirmation: 'attention',
  talking: 'talk',
  success: 'happy',
  error: 'error',
};

export const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Vex',
  listening: 'escuchando',
  thinking: 'pensando…',
  working: 'trabajando…',
  awaiting_confirmation: 'espero tu OK',
  talking: 'listo',
  success: '¡hecho!',
  error: 'algo falló',
};

export class Director {
  private readonly opts: DirectorOptions;
  private phase: Phase = 'idle';
  private greeting: boolean;
  private talking = false;
  private success = false;
  private celebrating = false;
  private timers: unknown[] = [];
  private last: StateName | null = null;

  constructor(opts: DirectorOptions) {
    this.opts = opts;
    this.greeting = opts.greets;
    if (opts.greets) this.after(TIMING.greetingMs, () => (this.greeting = false));
    this.emit();
  }

  /** The operator moved on. */
  setPhase(phase: Phase): void {
    const was = this.phase;
    this.phase = phase;
    if (phase !== 'idle') this.greeting = false;
    if (phase === 'talking' && was !== 'talking') {
      this.talking = true;
      this.after(this.opts.talkMs, () => (this.talking = false));
    }
    if (phase === 'success' && was !== 'success') {
      this.success = true;
      this.after(TIMING.successMs, () => (this.success = false));
    }
    this.emit();
  }

  /** A short celebration (a tour completed), on top of whatever the phase says. */
  celebrate(): void {
    this.celebrating = true;
    this.after(TIMING.celebrateMs, () => (this.celebrating = false));
    this.emit();
  }

  get state(): StateName {
    if (this.celebrating) return 'celebrate';
    if (this.success) return 'happy';
    if (this.greeting) return 'wave';
    if (this.phase === 'idle' && this.talking) return 'talk';
    return PHASE_STATE[this.phase];
  }

  dispose(): void {
    for (const t of this.timers) (this.opts.clearTimeout ?? clearTimeout)(t as number);
    this.timers = [];
  }

  private after(ms: number, fn: () => void): void {
    const id = (this.opts.setTimeout ?? setTimeout)(() => {
      this.timers = this.timers.filter((t) => t !== id);
      fn();
      this.emit();
    }, ms);
    this.timers.push(id);
  }

  private emit(): void {
    const s = this.state;
    if (s === this.last) return;
    this.last = s;
    this.opts.onState(s);
  }
}
