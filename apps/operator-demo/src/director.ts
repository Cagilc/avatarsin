import { useEffect, useRef, useState } from 'react';
import { TIMING, type VexState, type Viseme } from '@vex/avatar';
import type { Phase } from '@vex/operator';

const VISEMES: readonly Viseme[] = ['D', 'B', 'C', 'A', 'E', 'B', 'H', 'C', 'X'];

/**
 * The host's director: translates operator phases into avatar states.
 * This is the only piece a host writes for the avatar; the rig and the agent stay shared.
 */
export function useVexDirector(phase: Phase, opts: { greets: boolean; talkMs: number }): { state: VexState; viseme: Viseme | null } {
  const [greeting, setGreeting] = useState(opts.greets);
  const [talking, setTalking] = useState(false);
  const [success, setSuccess] = useState(false);
  const [viseme, setViseme] = useState<Viseme | null>(null);
  const prevPhase = useRef<Phase>(phase);

  useEffect(() => {
    if (!opts.greets) return undefined;
    const id = window.setTimeout(() => setGreeting(false), TIMING.greetingWaveMs * TIMING.greetingWaves);
    return () => window.clearTimeout(id);
  }, [opts.greets]);

  // talking: the reply arrived → lip-sync for a moment; success: a run ended with everything done.
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (phase === 'talking' && was !== 'talking') {
      setTalking(true);
      let i = 0;
      const tick = window.setInterval(() => {
        i += 1;
        setViseme(VISEMES[i % VISEMES.length] ?? null);
      }, 100);
      const stop = window.setTimeout(() => {
        window.clearInterval(tick);
        setViseme(null);
        setTalking(false);
      }, opts.talkMs);
      return () => {
        window.clearInterval(tick);
        window.clearTimeout(stop);
      };
    }
    if (phase === 'success') {
      setSuccess(true);
      const id = window.setTimeout(() => setSuccess(false), TIMING.successHoldMs + TIMING.returnToIdleMs);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [phase, opts.talkMs]);

  let state: VexState = 'idle';
  if (success) state = 'success';
  else if (greeting) state = 'greeting';
  else if (phase === 'thinking') state = 'thinking';
  else if (phase === 'working') state = 'working';
  else if (phase === 'awaiting_confirmation' || phase === 'listening') state = 'listening';
  else if (phase === 'error') state = 'thinking';
  else if (talking) state = 'talking';

  return { state, viseme: state === 'talking' ? viseme : null };
}

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
