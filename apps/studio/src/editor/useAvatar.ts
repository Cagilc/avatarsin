import { applyOps, type AvatarDocument, type Issue, type Op } from '@vexstudio/format';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Saved } from '../api.ts';

export interface ApplyOptions {
  /** false: record as a default the assistant may still adjust (imports). */
  lock?: boolean;
  summary?: string;
  /** false: only update the screen (e.g. while dragging a slider); send later with commit. */
  commit?: boolean;
}

export interface AvatarState {
  doc: AvatarDocument | null;
  revision: number;
  published: Array<{ revision: number; createdAt: string }>;
  saving: boolean;
  error: string | null;
}

/**
 * The open avatar. Every edit is applied locally at once (same validation as the server) and then
 * sent in order; the server's answer becomes the confirmed state. A conflict reloads the latest
 * version instead of overwriting someone else's work.
 */
export function useAvatar(id: string) {
  const [state, setState] = useState<AvatarState>({ doc: null, revision: 0, published: [], saving: false, error: null });
  const confirmed = useRef<Saved | null>(null);
  const local = useRef<AvatarDocument | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  const reload = useCallback(async (message: string | null = null) => {
    const a = await api.avatar(id);
    confirmed.current = { doc: a.doc, revision: a.revision };
    local.current = a.doc;
    setState({ doc: a.doc, revision: a.revision, published: a.published, saving: false, error: message });
  }, [id]);

  useEffect(() => {
    reload().catch((err: unknown) => setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) })));
  }, [reload]);

  const apply = useCallback(
    (ops: Op[], opts: ApplyOptions = {}): Issue[] | null => {
      const base = local.current;
      if (!base || ops.length === 0) return null;
      const r = applyOps(base, ops, 'user', { lock: opts.lock });
      if (!r.ok) {
        setState((s) => ({ ...s, error: r.issues.map((i) => i.message).join(' ') }));
        return r.issues;
      }
      local.current = r.doc;
      setState((s) => ({ ...s, doc: r.doc, error: null }));
      if (opts.commit === false) return null;

      pending.current++;
      setState((s) => ({ ...s, saving: true }));
      queue.current = queue.current.then(async () => {
        try {
          const c = confirmed.current!;
          const saved = await api.ops(id, ops, c.revision, { lock: opts.lock, summary: opts.summary });
          confirmed.current = saved;
          setState((s) => ({ ...s, revision: saved.revision }));
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) await reload('Otra persona cambió el avatar: se ha cargado su última versión.');
          else {
            // Back to what the server has, so the screen never shows something unsaved as saved.
            local.current = confirmed.current!.doc;
            setState((s) => ({ ...s, doc: confirmed.current!.doc, error: err instanceof Error ? err.message : String(err) }));
          }
        } finally {
          if (--pending.current === 0) setState((s) => ({ ...s, saving: false }));
        }
      });
      return null;
    },
    [id, reload],
  );

  /** After the server changed the avatar on its own (accepting a proposal, reverting). */
  const replace = useCallback((saved: Saved) => {
    confirmed.current = saved;
    local.current = saved.doc;
    setState((s) => ({ ...s, doc: saved.doc, revision: saved.revision, error: null }));
  }, []);

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  /** Waits until everything sent has been answered. */
  const settled = useCallback(() => queue.current, []);

  return { ...state, apply, replace, reload, clearError, settled };
}
