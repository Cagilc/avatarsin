import { describe, expect, it } from 'vitest';
import type { Tour } from '@vex/operator';
import { TourRun, type TourEvent } from './tour.ts';

const TOUR: Tour = {
  id: 'paseo',
  title: 'Un paseo',
  when: 'manual',
  steps: [
    { target: 'titulo', say: 'El título.', pose: 'point', advanceOn: 'next' },
    { target: 'no-existe', say: 'Esto no está.', pose: 'point', advanceOn: 'click' },
    { say: 'Desde el panel.', pose: 'talk', advanceOn: 'next' },
    { target: 'tampoco', say: 'Ni esto.', pose: 'point', advanceOn: 'next' },
  ],
};

function run(exists: (t: string) => boolean = (t) => t === 'titulo') {
  const events: TourEvent[] = [];
  const r = new TourRun(TOUR, { exists, onEvent: (e) => events.push(e) });
  return { r, events };
}

describe('the tour engine', () => {
  it('walks the steps whose target is on the page and lists the ones it skipped', () => {
    const { r, events } = run();
    r.start();
    expect(r.index).toBe(0);
    expect(events).toEqual([{ type: 'step', index: 0, step: TOUR.steps[0], of: 4 }]);
    r.next();
    expect(r.index).toBe(2);
    expect(r.current?.say).toBe('Desde el panel.');
    expect(r.skipped).toEqual(['no-existe']);
    r.next();
    expect(r.done).toBe(true);
    expect(r.current).toBeUndefined();
    expect(events.at(-1)).toEqual({ type: 'done', completed: true, skipped: ['no-existe', 'tampoco'] });
    // Nothing happens after the end.
    r.next();
    r.skip();
    expect(events).toHaveLength(3);
  });

  it('completes at once when no step can be shown, and skipping does not count as completing', () => {
    const seen: TourEvent[] = [];
    const targetsOnly = new TourRun({ ...TOUR, steps: TOUR.steps.filter((s) => s.target !== undefined) }, { exists: () => false, onEvent: (e) => seen.push(e) });
    targetsOnly.start();
    expect(seen).toEqual([{ type: 'done', completed: true, skipped: ['titulo', 'no-existe', 'tampoco'] }]);
    // A step without a target speaks from the panel: it always shows.
    const fromPanel = run(() => false);
    fromPanel.r.start();
    expect(fromPanel.r.current?.say).toBe('Desde el panel.');
    const { r, events } = run();
    r.start();
    r.skip();
    expect(events.at(-1)).toEqual({ type: 'done', completed: false, skipped: [] });
    expect(r.index).toBe(-1);
  });

  it('starts only once', () => {
    const { r, events } = run();
    r.next();
    expect(events).toEqual([]);
    r.start();
    r.start();
    expect(events).toHaveLength(1);
  });
});
