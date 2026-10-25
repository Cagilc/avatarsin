import { useCallback, useEffect, useState } from 'react';
import { api, type EmbedKey } from '../api.ts';

export interface PublishPanelProps {
  avatarId: string;
  revision: number;
  published: Array<{ revision: number; createdAt: string }>;
  publicUrl: string;
  runtimeReady: boolean;
  onPublished: () => void;
}

const RISK_LABEL: Record<EmbedKey['maxRisk'], string> = { read: 'Solo consultar', write: 'Consultar y modificar', irreversible: 'Todo (con confirmación)' };

/** Publish a signed version and manage the sites allowed to show it. Owner only. */
export function PublishPanel({ avatarId, revision, published, publicUrl, runtimeReady, onPublished }: PublishPanelProps) {
  const [keys, setKeys] = useState<EmbedKey[]>([]);
  const [signing, setSigning] = useState<{ publicKey: string; keyId: string } | null>(null);
  const [label, setLabel] = useState('');
  const [origins, setOrigins] = useState('');
  const [tools, setTools] = useState('');
  const [maxRisk, setMaxRisk] = useState<EmbedKey['maxRisk']>('read');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.keys(avatarId);
    setKeys(r.keys);
    setSigning({ publicKey: r.publicKey, keyId: r.keyId });
  }, [avatarId]);

  useEffect(() => {
    load().catch((err: unknown) => setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) }));
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const latest = published[0]?.revision ?? null;
  const snippet = (k: EmbedKey) =>
    signing
      ? `<script type="module" src="${publicUrl}/v1/vex-avatar.js"></script>\n<vex-avatar\n  endpoint="${publicUrl}/v1/embed/${k.id}"\n  public-key="${signing.publicKey}"\n  key-id="${signing.keyId}"\n  state="idle"\n  style="width:160px;height:160px"></vex-avatar>`
      : '';

  return (
    <div className="publish" data-testid="publish-panel">
      <section>
        <h3>Publicar</h3>
        <p className="hint">
          Publicar firma una copia de la versión actual ({revision}). Los sitios integrados verán esa copia; lo que sigas editando no les llega hasta que vuelvas a publicar.
        </p>
        <p>{latest ? `Publicada: versión ${latest}${latest === revision ? ' (al día)' : ' — hay cambios sin publicar'}` : 'Aún no se ha publicado.'}</p>
        <button
          type="button"
          disabled={busy || latest === revision}
          data-testid="publish"
          onClick={() =>
            void run(async () => {
              const r = await api.publish(avatarId);
              setMessage({ kind: 'ok', text: `Versión ${r.revision} publicada y firmada (clave ${r.keyId}).` });
              onPublished();
            })
          }
        >
          Publicar versión {revision}
        </button>
      </section>

      <section>
        <h3>Integraciones</h3>
        <p className="hint">Cada integración es una clave ligada a los dominios que indiques. Otro sitio no puede mostrar el avatar, y puedes revocarla al momento.</p>
        <div className="key-form">
          <input placeholder="Nombre (p. ej. Web del cliente)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} data-testid="key-label" />
          <textarea placeholder={'Dominios, uno por línea\nhttps://app.ejemplo.com'} rows={2} value={origins} onChange={(e) => setOrigins(e.target.value)} data-testid="key-origins" />
          <textarea placeholder="Herramientas que puede usar aquí (vacío = las del avatar)" rows={2} value={tools} onChange={(e) => setTools(e.target.value)} />
          <select value={maxRisk} onChange={(e) => setMaxRisk(e.target.value as EmbedKey['maxRisk'])}>
            {(Object.keys(RISK_LABEL) as EmbedKey['maxRisk'][]).map((r) => (
              <option key={r} value={r}>
                Riesgo máximo: {RISK_LABEL[r]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !label.trim() || !origins.trim()}
            data-testid="key-create"
            onClick={() =>
              void run(async () => {
                const list = tools.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean);
                const r = await api.createKey(avatarId, { label: label.trim(), origins: origins.split(/[\n,\s]+/).filter(Boolean), ...(list.length > 0 ? { tools: list } : {}), maxRisk });
                setLabel('');
                setOrigins('');
                setTools('');
                setShown(r.key.id);
                await load();
              })
            }
          >
            Crear integración
          </button>
        </div>
        {!runtimeReady && <p className="warn">El servidor no encuentra el script del avatar: ejecuta «pnpm build» para que los sitios puedan cargarlo.</p>}
        <ul className="keys">
          {keys.map((k) => (
            <li key={k.id} className={k.revokedAt ? 'revoked' : ''} data-testid="key-item">
              <div className="key-head">
                <strong>{k.label}</strong>
                <span className="muted small">{k.origins.join(', ')}</span>
                <span className="muted small">{RISK_LABEL[k.maxRisk]}{k.tools ? ` · ${k.tools.join(', ')}` : ''}</span>
                {k.revokedAt ? (
                  <span className="badge">Revocada</span>
                ) : (
                  <span className="key-actions">
                    <button type="button" className="link" onClick={() => setShown(shown === k.id ? null : k.id)}>
                      {shown === k.id ? 'Ocultar código' : 'Ver código'}
                    </button>
                    <button type="button" className="link danger" onClick={() => void run(async () => { await api.revokeKey(k.id); await load(); })}>
                      Revocar
                    </button>
                  </span>
                )}
              </div>
              {shown === k.id && !k.revokedAt && (
                <>
                  <pre className="snippet" data-testid="snippet">{snippet(k)}</pre>
                  <button type="button" className="secondary small" onClick={() => void navigator.clipboard?.writeText(snippet(k))}>
                    Copiar
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
      {message && <p className={message.kind === 'ok' ? 'ok' : 'error'}>{message.text}</p>}
    </div>
  );
}
