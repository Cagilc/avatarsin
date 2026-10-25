import type { Tour, TourStep } from '@vex/operator';

/**
 * The tour engine: a deterministic walk through a tour's steps. It knows nothing about the page;
 * the panel tells it which targets exist and draws what it reports. Steps whose target is not on
 * the page are skipped and listed, so the tour never stalls on a missing element.
 */

export type TourEvent = { type: 'step'; index: number; step: TourStep; of: number } | { type: 'done'; completed: boolean; skipped: string[] };

export interface TourRunOptions {
  /** Is the element with this id on the page right now? */
  exists: (target: string) => boolean;
  onEvent: (event: TourEvent) => void;
}

export class TourRun {
  readonly tour: Tour;
  private readonly opts: TourRunOptions;
  private position = -1;
  private readonly missing: string[] = [];
  private finished = false;

  constructor(tour: Tour, opts: TourRunOptions) {
    this.tour = tour;
    this.opts = opts;
  }

  /** Index of the current step, or -1 before the start and after the end. */
  get index(): number {
    return this.finished ? -1 : this.position;
  }

  get current(): TourStep | undefined {
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

  /** On to the next step that can be shown; the end of the list completes the tour. */
  next(): void {
    if (this.finished || this.position < 0) return;
    this.advance(this.position + 1);
  }

  /** Leaves the tour where it is; it does not count as completed. */
  skip(): void {
    if (this.finished) return;
    this.end(false);
  }

  private advance(from: number): void {
    for (let i = from; i < this.tour.steps.length; i += 1) {
      const step = this.tour.steps[i]!;
      if (step.target !== undefined && !this.opts.exists(step.target)) {
        this.missing.push(step.target);
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
