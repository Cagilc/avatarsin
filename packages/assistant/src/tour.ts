import type { TourStep } from '@vex/operator';

/**
 * The tour engine: a deterministic walk through a list of steps (a tour's, or a demo script's
 * scenes). It knows nothing about the page; the panel tells it which targets exist and draws what
 * it reports. Steps whose target is not on the page are skipped and listed, so the walk never
 * stalls on a missing element.
 */

export interface Walk<T> {
  id: string;
  title: string;
  steps: T[];
}

export type TourEvent<T = TourStep> = { type: 'step'; index: number; step: T; of: number } | { type: 'done'; completed: boolean; skipped: string[] };

export interface TourRunOptions<T> {
  /** Is the element with this id on the page right now? */
  exists: (target: string) => boolean;
  onEvent: (event: TourEvent<T>) => void;
}

export class TourRun<T extends { target?: string | undefined } = TourStep> {
  readonly tour: Walk<T>;
  private readonly opts: TourRunOptions<T>;
  private position = -1;
  private readonly missing: string[] = [];
  private finished = false;

  constructor(tour: Walk<T>, opts: TourRunOptions<T>) {
    this.tour = tour;
    this.opts = opts;
  }

  /** Index of the current step, or -1 before the start and after the end. */
  get index(): number {
    return this.finished ? -1 : this.position;
  }

  get current(): T | undefined {
    return this.finished || this.position < 0 ? undefined : this.tour.steps[this.position];
  }

  /** Targets that were not on the page when their step came up. */
  get skipped(): readonly string[] {
    return this.missing;
  }

  get done(): boolean {
    return this.finished;
  }

  start(): void {
    if (this.position >= 0 || this.finished) return;
    this.advance(0);
  }

  /** On to the next step that can be shown; the end of the list completes the walk. */
  next(): void {
    if (this.finished || this.position < 0) return;
    this.advance(this.position + 1);
  }

  /** Back to the previous step that can be shown (a presenter rewinds); the first step stays. */
  back(): void {
    if (this.finished || this.position <= 0) return;
    for (let i = this.position - 1; i >= 0; i -= 1) {
      const step = this.tour.steps[i]!;
      if (step.target !== undefined && !this.opts.exists(step.target)) continue;
      this.position = i;
      this.opts.onEvent({ type: 'step', index: i, step, of: this.tour.steps.length });
      return;
    }
  }

  /** Leaves the walk where it is; it does not count as completed. */
  skip(): void {
    if (this.finished) return;
    this.end(false);
  }

  private advance(from: number): void {
    for (let i = from; i < this.tour.steps.length; i += 1) {
      const step = this.tour.steps[i]!;
      if (step.target !== undefined && !this.opts.exists(step.target)) {
        if (!this.missing.includes(step.target)) this.missing.push(step.target);
        continue;
      }
      this.position = i;
      this.opts.onEvent({ type: 'step', index: i, step, of: this.tour.steps.length });
      return;
    }
    this.end(true);
  }

  private end(completed: boolean): void {
    this.finished = true;
    this.opts.onEvent({ type: 'done', completed, skipped: [...this.missing] });
  }
}
