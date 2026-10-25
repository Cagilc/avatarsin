import { describe, expect, it } from 'vitest';
import { Director, TIMING } from './director.ts';

/** A clock the test moves by hand. */
function clock() {
  let now = 0;
  const due: Array<{ at: number; fn: () => void; id: number }> = [];
  let seq = 0;
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const id = ++seq;
      due.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (id: unknown) => {
      const i = due.findIndex((d) => d.id === id);
      if (i >= 0) due.splice(i, 1);
    },
    advance(ms: number) {
      now += ms;
      for (const d of [...due].sort((a, b) => a.at - b.at)) {
        if (d.at <= now) {
          due.splice(due.indexOf(d), 1);
          d.fn();
        }
      }
    },
  };
}

function setup(greets = true) {
  const c = clock();
  const states: string[] = [];
  const d = new Director({ greets, talkMs: 1000, onState: (s) => states.push(s), setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  return { c, d, states };
}

describe('the director', () => {
  it('waves on load, then rests', () => {
    const { c, d, states } = setup();
    expect(states).toEqual(['wave']);
    c.advance(TIMING.greetingMs);
    expect(d.state).toBe('idle');
    expect(states).toEqual(['wave', 'idle']);
    expect(setup(false).states).toEqual(['idle']);
  });

  it('follows the run: thinking, working, waiting for the OK, talking, done', () => {
    const { c, d, states } = setup(false);
    d.setPhase('thinking');
    d.setPhase('working');
    d.setPhase('awaiting_confirmation');
    d.setPhase('working');
    d.setPhase('talking');
    expect(states).toEqual(['idle', 'think', 'attention', 'think', 'talk']);
    // The reply is done but the mouth keeps moving for talkMs.
    d.setPhase('idle');
    expect(d.state).toBe('talk');
    c.advance(999);
    expect(d.state).toBe('talk');
    c.advance(1);
    expect(d.state).toBe('idle');
  });

  it('celebrates a success briefly and shows an error', () => {
    const { c, d } = setup(false);
    d.setPhase('working');
    d.setPhase('success');
    expect(d.state).toBe('happy');
    d.setPhase('idle');
    expect(d.state).toBe('happy');
    c.advance(TIMING.successMs);
    expect(d.state).toBe('idle');
    d.setPhase('error');
    expect(d.state).toBe('error');
  });

  it('a request interrupts the greeting, and dispose drops every timer', () => {
    const { c, d, states } = setup();
    d.setPhase('thinking');
    expect(d.state).toBe('think');
    d.setPhase('talking');
    d.dispose();
    c.advance(10_000);
    expect(states.at(-1)).toBe('talk');
  });

  it('celebrates for a moment and then goes back to the phase', () => {
    const { c, d, states } = setup(false);
    d.setPhase('thinking');
    d.celebrate();
    expect(d.state).toBe('celebrate');
    c.advance(TIMING.celebrateMs);
    expect(d.state).toBe('think');
    expect(states).toEqual(['idle', 'think', 'celebrate', 'think']);
  });

  it('reports each state once', () => {
    const { d, states } = setup(false);
    d.setPhase('thinking');
    d.setPhase('working');
    expect(states).toEqual(['idle', 'think']);
  });
});
