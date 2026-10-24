import type { ActionRequest, ChatMessage, Principal } from '@vex/operator';
import type { OperatorStore } from './storage.ts';

export interface Session {
  id: string;
  principal: Principal;
  history: ChatMessage[];
  /** Confirmations the loop is waiting for, by action id. Memory only. */
  pending: Map<string, { action: ActionRequest; resolve: (approved: boolean) => void }>;
  busy: boolean;
  /** Set while a run is in progress; aborting it stops the run. */
  controller: AbortController | null;
}

/** Messages kept per conversation; older turns are dropped at a safe boundary. */
export const MAX_HISTORY = 40;

/**
 * Drops the oldest messages so at most `max` remain, cutting only before a user text message:
 * a tool_use is never separated from its tool_result. Returns the same array when nothing is cut.
 */
export function trimHistory(history: ChatMessage[], max = MAX_HISTORY): ChatMessage[] {
  if (history.length <= max) return history;
  for (let i = history.length - max; i < history.length; i += 1) {
    const m = history[i];
    if (m?.role === 'user' && m.content.some((b) => b.type === 'text')) return history.slice(i);
  }
  return history;
}

/** Live sessions in memory, backed by the store so conversations survive a restart. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly store: OperatorStore;

  constructor(store: OperatorStore) {
    this.store = store;
  }

  getOrCreate(id: string | undefined, principal: Principal): Session {
    if (id) {
      const live = this.sessions.get(id);
      const stored = live ? null : this.store.loadSession(id);
      const owner = live?.principal ?? stored?.principal;
      if (owner && owner.id !== principal.id) throw new Error('La sesión pertenece a otro usuario.');
      if (live) return live;
      if (stored) {
        const session: Session = { id, principal, history: stored.history, pending: new Map(), busy: false, controller: null };
        this.sessions.set(id, session);
        return session;
      }
    }
    const session: Session = { id: id ?? crypto.randomUUID(), principal, history: [], pending: new Map(), busy: false, controller: null };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Trims the conversation in place and writes it to the store. */
  save(session: Session): void {
    const trimmed = trimHistory(session.history);
    if (trimmed !== session.history) session.history.splice(0, session.history.length - trimmed.length);
    this.store.saveSession({ id: session.id, principal: session.principal, history: session.history });
  }

  /** Registers a pending confirmation and returns the promise the loop awaits. */
  waitForConfirmation(session: Session, action: ActionRequest, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        session.pending.delete(action.id);
        resolve(false);
      }, timeoutMs);
      session.pending.set(action.id, {
        action,
        resolve: (approved) => {
          clearTimeout(timer);
          session.pending.delete(action.id);
          resolve(approved);
        },
      });
    });
  }

  confirm(sessionId: string, actionId: string, approved: boolean): boolean {
    const session = this.sessions.get(sessionId);
    const pending = session?.pending.get(actionId);
    if (!pending) return false;
    pending.resolve(approved);
    return true;
  }

  /** Stops the run in progress, if any. Pending confirmations count as rejected. */
  stop(session: Session): boolean {
    if (!session.controller) return false;
    session.controller.abort();
    for (const p of [...session.pending.values()]) p.resolve(false);
    return true;
  }
}
