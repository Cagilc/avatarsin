import { useEffect, useState } from 'react';
import { api, type Revision, type Saved } from '../api.ts';

/** Every saved change, newest first; going back creates a new version (nothing is erased). */
export function HistoryPanel({ avatarId, revision, onRestored }: { avatarId: string; revision: number; onRestored: (saved: Saved) => void }) {
  const [history, setHistory] = useState<Revision[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .history(avatarId)
      .then((r) => setHistory(r.history))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [avatarId, revision]);

  return (
    <div className="history" data-testid="history">
      {error && <p className="error">{error}</p>}
      <ol>
        {history.map((h) => (
          <li key={h.n} className={h.n === revision ? 'current' : ''}>
            <span className="rev">v{h.n}</span>
            <span className={`who ${h.actor}`}>{h.actor === 'ai' ? 'Asistente' : 'Persona'}</span>
            <span className="what">{h.summary}</span>
            <span className="when muted small">{new Date(h.createdAt).toLocaleString('es-ES')}</span>
            {h.n !== revision && (
              <button type="button" className="link" onClick={() => api.revert(avatarId, h.n, revision).then(onRestored).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                Volver aquí
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
