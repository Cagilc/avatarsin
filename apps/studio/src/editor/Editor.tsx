import { STATES, type AvatarDocument, type Part, type StateName } from '@vexstudio/format';
import { useMemo, useRef, useState } from 'react';
import type { Config, User } from '../api.ts';
import { AssistantPanel } from './AssistantPanel.tsx';
import { useAssets } from './assets.ts';
import { HistoryPanel } from './HistoryPanel.tsx';
import { importLogo } from './importLogo.ts';
import { Inspector, ROLE_LABEL, STATE_LABEL } from './Inspector.tsx';
import { PublishPanel } from './PublishPanel.tsx';
import { Stage } from './Stage.tsx';
import { useAvatar } from './useAvatar.ts';

function PartsTree({ doc, selected, onSelect }: { doc: AvatarDocument; selected: string | null; onSelect: (id: string) => void }) {
  const children = new Map<string | null, Part[]>();
  for (const p of doc.parts) {
    const key = p.parent && doc.parts.some((q) => q.id === p.parent) ? p.parent : null;
    children.set(key, [...(children.get(key) ?? []), p]);
  }
  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((p) => (
      <li key={p.id}>
        <button type="button" className={`part-row${selected === p.id ? ' selected' : ''}${p.visible ? '' : ' hidden'}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onSelect(p.id)} data-testid={`part-${p.id}`}>
          <span className="part-name">{p.name}</span>
          <span className="part-meta">
            {p.role ? ROLE_LABEL[p.role] : ''}
            {p.physics?.enabled ? ' · muelle' : ''}
          </span>
        </button>
        {children.has(p.id) && <ul>{render(p.id, depth + 1)}</ul>}
      </li>
    ));
  return doc.parts.length === 0 ? <p className="muted">Sin piezas todavía.</p> : <ul className="parts-tree">{render(null, 0)}</ul>;
}

export function Editor({ avatarId, user, config, onBack }: { avatarId: string; user: User; config: Config; onBack: () => void }) {
  const avatar = useAvatar(avatarId);
  const { assets, version } = useAssets(avatar.doc);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'rest' | 'play'>('play');
  const [state, setState] = useState<StateName>('idle');
  const [drawer, setDrawer] = useState<'history' | 'publish' | null>(null);
  const [preview, setPreview] = useState<{ doc: AvatarDocument; banner: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isOwner = user.role === 'owner';

  const doc = avatar.doc;
  const shown = preview?.doc ?? doc;
  const selectedPart = useMemo(() => doc?.parts.find((p) => p.id === selected) ?? null, [doc, selected]);

  if (!doc || !shown) return <div className="loading">{avatar.error ?? 'Cargando…'}</div>;

  const onFile = async (file: File) => {
    setImporting(true);
    setNotice(null);
    try {
      const r = await importLogo(file, doc);
      assets.set(r.asset.hash, r.asset.loaded);
      avatar.apply(r.ops, { lock: false, summary: `Importado: ${file.name}`.slice(0, 300) });
      setNotice(r.note ?? `Importado en ${r.parts} piezas. Pide al asistente que lo prepare, o monta el esqueleto a mano.`);
      setMode('rest');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="editor">
      <header className="topbar">
        <button type="button" className="link" onClick={onBack}>
          ← Avatares
        </button>
        <h1>{doc.name}</h1>
        <span className="muted small" data-testid="revision">
          v{avatar.revision} {avatar.saving ? '· guardando…' : '· guardado'}
        </span>
        <div className="spacer" />
        <div className="segmented" role="group" aria-label="Modo">
          <button type="button" className={mode === 'rest' ? 'active' : ''} onClick={() => setMode('rest')} data-testid="mode-rest">
            Reposo
          </button>
          <button type="button" className={mode === 'play' ? 'active' : ''} onClick={() => setMode('play')} data-testid="mode-play">
            Animación
          </button>
        </div>
        <select value={state} onChange={(e) => { setState(e.target.value as StateName); setMode('play'); }} aria-label="Estado" data-testid="state-select">
          {STATES.map((s) => (
            <option key={s} value={s}>
              {STATE_LABEL[s]}
            </option>
          ))}
        </select>
        <input ref={fileInput} type="file" accept=".svg,image/svg+xml,image/png,image/jpeg" hidden data-testid="file-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={importing}>
          {importing ? 'Subiendo…' : 'Subir logo'}
        </button>
        <button type="button" className={`secondary${drawer === 'history' ? ' active' : ''}`} onClick={() => setDrawer(drawer === 'history' ? null : 'history')}>
          Historial
        </button>
        {isOwner && (
          <button type="button" className={`secondary${drawer === 'publish' ? ' active' : ''}`} onClick={() => setDrawer(drawer === 'publish' ? null : 'publish')} data-testid="open-publish">
            Publicar
          </button>
        )}
      </header>
      {(avatar.error || notice) && (
        <div className={avatar.error ? 'banner error' : 'banner'} role="status">
          {avatar.error ?? notice}
          <button type="button" className="link" onClick={() => { avatar.clearError(); setNotice(null); }}>
            Cerrar
          </button>
        </div>
      )}
      <div className="editor-main">
        <aside className="left">
          <section>
            <h2>Piezas</h2>
            <PartsTree doc={doc} selected={selected} onSelect={setSelected} />
          </section>
          <AssistantPanel
            avatarId={avatarId}
            doc={doc}
            revision={avatar.revision}
            assistantName={config.assistant}
            onPreview={(d, banner) => setPreview(d ? { doc: d, banner } : null)}
            onAccepted={(saved) => {
              avatar.replace(saved);
              setMode('play');
            }}
          />
        </aside>
        <main className="center">
          {doc.parts.length === 0 ? (
            <div className="empty">
              <p>Sube un logo (SVG, PNG o JPEG). Cada grupo o forma del SVG será una pieza animable.</p>
              <button type="button" onClick={() => fileInput.current?.click()} disabled={importing}>
                Subir logo
              </button>
              <button
                type="button"
                className="secondary"
                disabled={importing}
                data-testid="use-sample"
                onClick={() =>
                  void fetch('/samples/mascota.svg')
                    .then((r) => r.blob())
                    .then((b) => onFile(new File([b], 'mascota.svg', { type: 'image/svg+xml' })))
                }
              >
                Probar con la mascota de ejemplo
              </button>
            </div>
          ) : (
            <Stage
              doc={shown}
              assets={assets}
              assetsVersion={version}
              selected={selected}
              onSelect={setSelected}
              mode={preview ? 'play' : mode}
              state={state}
              banner={preview?.banner ?? (mode === 'rest' ? 'Reposo: arrastra el punto azul para mover el pivote de la pieza seleccionada' : null)}
              onPivot={(id, p, commit) => avatar.apply([{ op: 'updatePart', id, patch: { pivot: p } }], { commit, summary: 'Pivote' })}
            />
          )}
        </main>
        <Inspector
          doc={doc}
          selected={selectedPart}
          apply={avatar.apply}
          isOwner={isOwner}
          onPreviewState={(s) => {
            setState(s);
            setMode('play');
          }}
        />
        {drawer && (
          <aside className="drawer">
            <header>
              <h2>{drawer === 'history' ? 'Historial' : 'Publicar e integrar'}</h2>
              <button type="button" className="link" onClick={() => setDrawer(null)}>
                Cerrar
              </button>
            </header>
            {drawer === 'history' ? (
              <HistoryPanel avatarId={avatarId} revision={avatar.revision} onRestored={avatar.replace} />
            ) : (
              <PublishPanel avatarId={avatarId} revision={avatar.revision} published={avatar.published} publicUrl={config.publicUrl} runtimeReady={config.runtimeReady} onPublished={() => void avatar.reload()} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
