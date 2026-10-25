import { applyOps, type AvatarDocument, type Op } from '@vexstudio/format';
import { useEffect, useState } from 'react';
import { api, type Proposal, type Saved } from '../api.ts';

export interface AssistantPanelProps {
  avatarId: string;
  doc: AvatarDocument;
  revision: number;
  assistantName: string;
  /** Show a document on the stage without saving it (null = back to the real one). */
  onPreview: (doc: AvatarDocument | null, banner: string | null) => void;
  onAccepted: (saved: Saved) => void;
}

function previewOf(doc: AvatarDocument, ...batches: Op[][]): AvatarDocument | null {
  let d = doc;
  for (const ops of batches) {
    if (ops.length === 0) continue;
    const r = applyOps(d, ops, 'ai');
    if (!r.ok) return null;
    d = r.doc;
  }
  return d;
}

/**
 * Describe what you want; the assistant prepares a complete draft and asks only what it cannot
 * deduce. Nothing is saved until you accept: until then the stage shows a preview.
 */
export function AssistantPanel({ avatarId, doc, revision, assistantName, onPreview, onAccepted }: AssistantPanelProps) {
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<(Proposal & { base: number }) | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stale = proposal !== null && proposal.base !== revision;

  useEffect(() => {
    if (!proposal || stale) return onPreview(null, null);
    onPreview(previewOf(doc, proposal.ops), 'Vista previa de la propuesta · no se ha guardado nada');
    // Only when the proposal itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal, stale]);

  const ask = async (nextAnswers: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.propose(avatarId, message, nextAnswers);
      setAnswers(nextAnswers);
      setProposal({ ...p, base: revision });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!proposal) return;
    setBusy(true);
    try {
      const saved = await api.accept(avatarId, proposal.id, revision);
      setProposal(null);
      setAnswers({});
      onPreview(null, null);
      onAccepted(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    setProposal(null);
    setAnswers({});
    onPreview(null, null);
  };

  const hover = (ops: Op[] | null) => {
    if (!proposal || stale) return;
    const base = previewOf(doc, proposal.ops);
    if (!base) return;
    onPreview(ops ? previewOf(base, ops) ?? base : base, ops ? 'Vista previa de esta opción' : 'Vista previa de la propuesta · no se ha guardado nada');
  };

  return (
    <section className="assistant" data-testid="assistant">
      <header>
        <h2>Asistente</h2>
        <span className="muted small">{assistantName === 'heuristic' ? 'geométrico (sin clave de IA)' : assistantName}</span>
      </header>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Ej.: una mascota simpática para una aseguradora, estilo dibujo, que la antena rebote"
        data-testid="assistant-input"
      />
      <button type="button" onClick={() => void ask({})} disabled={busy || doc.parts.length === 0} data-testid="assistant-propose">
        {busy ? 'Preparando…' : proposal ? 'Volver a proponer' : 'Proponer'}
      </button>
      {doc.parts.length === 0 && <p className="hint">Sube primero un logo o una imagen.</p>}
      {error && <p className="error">{error}</p>}

      {proposal && (
        <div className="proposal" data-testid="proposal">
          {stale && <p className="warn">Has cambiado el avatar desde esta propuesta: pide otra.</p>}
          <ul className="summary">
            {proposal.summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {proposal.questions.map((q) => (
            <div className="question" key={q.id} data-testid={`question-${q.id}`}>
              <p className="q-text">{q.text}</p>
              <p className="hint">{q.why}</p>
              <div className="options">
                {q.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`option${answers[q.id] === o.id ? ' chosen' : ''}${q.recommended === o.id ? ' recommended' : ''}`}
                    title={o.detail}
                    disabled={busy || stale}
                    onMouseEnter={() => hover(o.ops)}
                    onMouseLeave={() => hover(null)}
                    onFocus={() => hover(o.ops)}
                    onBlur={() => hover(null)}
                    onClick={() => void ask({ ...answers, [q.id]: o.id })}
                    data-testid={`option-${q.id}-${o.id}`}
                  >
                    {o.label}
                    {q.recommended === o.id && <span className="rec">recomendada</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {proposal.questions.length > 0 && <p className="hint">Si no respondes, se queda la opción recomendada.</p>}
          <div className="actions">
            <button type="button" onClick={() => void accept()} disabled={busy || stale || proposal.ops.length === 0} data-testid="assistant-accept">
              Aceptar ({proposal.ops.length} cambios)
            </button>
            <button type="button" className="secondary" onClick={discard} disabled={busy}>
              Descartar
            </button>
          </div>
          <p className="muted small">Confianza {Math.round(proposal.confidence * 100)}% · {proposal.provider}</p>
        </div>
      )}
    </section>
  );
}
