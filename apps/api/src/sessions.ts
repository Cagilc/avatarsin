import type { ActionRequest, ChatMessage, Principal } from '@vex/operator';

export interface Session {
  id: string;
  principal: Principal;
  history: ChatMessage[];
  /** Confirmations the loop is waiting for, by action id. */
  pending: Map<string, { action: ActionRequest; resolve: (approved: boolean) => void }>;
  busy: boolean;
  createdAt: number;
}

/** In-memory sessions. One per chat; the host keeps the id. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  getOrCreate(id: string | undefined, principal: Principal): Session {
    if (id) {
      const existing = this.sessions.get(id);
      if (existing) {
        if (existing.principal.id !== principal.id) throw new Error('La sesión pertenece a otro usuario.');
        return existing;
      }
    }
    const session: Session = { id: id ?? crypto.randomUUID(), principal, history: [], pending: new Map(), busy: false, createdAt: Date.now() };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
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
}
