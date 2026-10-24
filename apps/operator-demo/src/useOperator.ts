import { useCallback, useRef, useState } from 'react';
import type { ActionOutcome, ActionRequest, Phase } from '@vex/operator';
import { chat, confirm as confirmAction, stop as stopRun, type StreamEvent } from './api';

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
  /** The user pressed Detener. */
  cancelled?: boolean;
  done: boolean;
}

export interface OperatorState {
  sessionId: string | null;
  phase: Phase;
  turns: Turn[];
  pending: ActionRequest | null;
  busy: boolean;
}

/** Client-side mirror of the operator run: turns, steps, the pending confirmation and the phase. */
export function useOperator(token: string | null, onDone: () => void) {
  const [state, setState] = useState<OperatorState>({ sessionId: null, phase: 'idle', turns: [], pending: null, busy: false });
  const sessionRef = useRef<string | null>(null);

  const patchTurn = useCallback((id: string, fn: (t: Turn) => Turn) => {
    setState((s) => ({ ...s, turns: s.turns.map((t) => (t.id === id ? fn(t) : t)) }));
  }, []);

  const send = useCallback(
    async (message: string, context: Record<string, unknown>) => {
      if (!token || !message.trim()) return;
      const turnId = crypto.randomUUID();
      setState((s) => ({ ...s, busy: true, phase: 'thinking', pending: null, turns: [...s.turns, { id: turnId, user: message, reply: '', steps: [], done: false }] }));

      const onEvent = (event: StreamEvent) => {
        switch (event.type) {
          case 'session':
            sessionRef.current = event.sessionId;
            setState((s) => ({ ...s, sessionId: event.sessionId }));
            break;
          case 'phase':
            setState((s) => ({ ...s, phase: event.phase }));
            break;
          case 'text':
            patchTurn(turnId, (t) => ({ ...t, reply: t.reply + event.delta }));
            break;
          case 'confirm':
            setState((s) => ({ ...s, pending: event.action }));
            patchTurn(turnId, (t) => ({ ...t, steps: [...t.steps, { id: event.action.id, summary: event.action.summary, risk: event.action.risk, outcome: 'confirming' }] }));
            break;
          case 'tool_call':
            setState((s) => ({ ...s, pending: null }));
            patchTurn(turnId, (t) =>
              t.steps.some((st) => st.id === event.action.id)
                ? { ...t, steps: t.steps.map((st) => (st.id === event.action.id ? { ...st, outcome: 'pending' } : st)) }
                : { ...t, steps: [...t.steps, { id: event.action.id, summary: event.action.summary, risk: event.action.risk, outcome: 'pending' }] },
            );
            break;
          case 'tool_result':
            setState((s) => ({ ...s, pending: null }));
            patchTurn(turnId, (t) =>
              t.steps.some((st) => st.id === event.id)
                ? { ...t, steps: t.steps.map((st) => (st.id === event.id ? { ...st, outcome: event.outcome, detail: event.summary } : st)) }
                : { ...t, steps: [...t.steps, { id: event.id, summary: event.summary, risk: 'read', outcome: event.outcome, detail: event.summary }] },
            );
            break;
          case 'done':
            patchTurn(turnId, (t) => ({ ...t, reply: event.reply, done: true }));
            break;
          case 'error':
            patchTurn(turnId, (t) => ({ ...t, error: event.message, done: true }));
            break;
          case 'cancelled':
            setState((s) => ({ ...s, pending: null }));
            patchTurn(turnId, (t) => ({ ...t, cancelled: true, done: true }));
            break;
          case 'progress':
            break;
        }
      };

      try {
        await chat(token, { ...(sessionRef.current ? { sessionId: sessionRef.current } : {}), message, context }, onEvent);
        setState((s) => {
          const turn = s.turns.find((t) => t.id === turnId);
          const allOk = turn !== undefined && !turn.error && !turn.cancelled && turn.steps.length > 0 && turn.steps.every((st) => st.outcome === 'ok');
          return { ...s, busy: false, pending: null, phase: allOk ? 'success' : s.phase === 'error' ? 'error' : 'idle' };
        });
        window.setTimeout(() => setState((s) => (s.busy ? s : { ...s, phase: 'idle' })), 1200);
      } catch (err) {
        patchTurn(turnId, (t) => ({ ...t, error: err instanceof Error ? err.message : String(err), done: true }));
        setState((s) => ({ ...s, busy: false, pending: null, phase: 'error' }));
      } finally {
        onDone();
      }
    },
    [token, patchTurn, onDone],
  );

  const decide = useCallback(
    async (approved: boolean) => {
      const pending = state.pending;
      const sessionId = sessionRef.current;
      if (!token || !pending || !sessionId) return;
      setState((s) => ({ ...s, pending: null, phase: approved ? 'working' : 'thinking' }));
      await confirmAction(token, sessionId, pending.id, approved);
    },
    [token, state.pending],
  );

  /** Detener: the server aborts the run; the stream closes with `cancelled`. */
  const stop = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!token || !sessionId) return;
    setState((s) => ({ ...s, pending: null }));
    await stopRun(token, sessionId);
  }, [token]);

  const reset = useCallback(() => {
    sessionRef.current = null;
    setState({ sessionId: null, phase: 'idle', turns: [], pending: null, busy: false });
  }, []);

  return { ...state, send, decide, stop, reset };
}
