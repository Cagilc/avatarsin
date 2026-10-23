import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Vex } from '@vex/avatar';
import type { Principal } from '@vex/operator';
import { demoUsers, estado as fetchEstado, info as fetchInfo, login, type Estado, type OperatorInfo } from './api';
import { PHASE_LABEL, useVexDirector } from './director';
import { useOperator, type Step } from './useOperator';

const AVATAR_H = 150;

const SUGGESTIONS = [
  'Busca a Laura Pérez, abre expediente de residencia, crea una tarea para extranjería y mándale un correo pidiendo documentación',
  'Crea una tarea para marketing "Campaña de octubre" y envíale el presupuesto por correo',
  '¿Quién es Marco Rossi?',
];

const OUTCOME_LABEL: Record<Step['outcome'], string> = {
  pending: 'en curso',
  confirming: 'espera tu OK',
  ok: 'hecho',
  error: 'error',
  denied: 'denegado',
  rejected: 'rechazado',
  invalid: 'inválido',
};

export function App() {
  const [users, setUsers] = useState<Principal[]>([]);
  const [auth, setAuth] = useState<{ token: string; principal: Principal } | null>(null);
  const [info, setInfo] = useState<OperatorInfo | null>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [selected, setSelected] = useState<{ contactoId?: string; expedienteId?: string }>({});
  const [draft, setDraft] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!auth) return;
    fetchEstado(auth.token)
      .then(setEstado)
      .catch((e: Error) => setApiError(e.message));
  }, [auth]);

  const op = useOperator(auth?.token ?? null, refresh);
  const { state, viseme } = useVexDirector(op.phase, { greets: info?.personality.greets ?? true, talkMs: info?.personality.talkMs ?? 1600 });

  useEffect(() => {
    Promise.all([demoUsers(), fetchInfo()])
      .then(([u, i]) => {
        setUsers(u);
        setInfo(i);
        setApiError(null);
        const first = u[0];
        if (first) return login(first.id).then(setAuth);
        return undefined;
      })
      .catch((e: Error) => setApiError(`No llego a Vex Core (${e.message}). Arranca "pnpm dev:api".`));
  }, []);

  useEffect(refresh, [refresh]);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [op.turns, op.pending]);

  const context = useMemo(() => {
    const ctx: Record<string, unknown> = { pantalla: selected.expedienteId ? 'expediente' : selected.contactoId ? 'contacto' : 'inicio' };
    if (selected.contactoId) {
      ctx['contactoId'] = selected.contactoId;
      const c = estado?.contactos.find((x) => x.id === selected.contactoId);
      if (c) ctx['contactoEmail'] = c.email;
    }
    if (selected.expedienteId) ctx['expedienteId'] = selected.expedienteId;
    return ctx;
  }, [selected, estado]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || op.busy) return;
    setDraft('');
    void op.send(text, context);
  };

  const switchUser = async (id: string) => {
    const a = await login(id);
    setAuth(a);
    op.reset();
  };

  const contactName = (id: string) => estado?.contactos.find((c) => c.id === id)?.nombre ?? id;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="logo">MNEE</span>
          <span className="muted">plataforma · demo del operador Vex</span>
          <a className="pill" href="#estados">laboratorio del avatar</a>
        </div>
        <div className="top-right">
          {apiError && <span className="error">{apiError}</span>}
          {info && (
            <span className="pill" title="Proveedor del modelo">
              {info.provider === 'scripted' ? 'modo guion (sin clave)' : info.provider}
            </span>
          )}
          <label className="muted">
            Usuario{' '}
            <select value={auth?.principal.id ?? ''} onChange={(e) => void switchUser(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <main className="grid">
        <section className="col">
          <h2>Contactos</h2>
          <ul className="list">
            {estado?.contactos.map((c) => (
              <li key={c.id}>
                <button type="button" className={`row ${selected.contactoId === c.id ? 'is-selected' : ''}`} onClick={() => setSelected(selected.contactoId === c.id ? {} : { contactoId: c.id })}>
                  <strong>{c.nombre}</strong>
                  <span className="muted">{c.email}</span>
                  <span className="tags">{c.etiquetas.join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">Selecciona un contacto: Vex lo recibe como contexto de pantalla y puede referirse a él como "este cliente".</p>
        </section>

        <section className="col">
          <h2>Expedientes</h2>
          <ul className="list">
            {estado?.expedientes.map((x) => (
              <li key={x.id}>
                <button type="button" className={`row ${selected.expedienteId === x.id ? 'is-selected' : ''}`} onClick={() => setSelected(selected.expedienteId === x.id ? {} : { expedienteId: x.id, contactoId: x.contactoId })}>
                  <strong>
                    {x.id} <span className={`badge badge-${x.estado}`}>{x.estado.replace('_', ' ')}</span>
                  </strong>
                  <span>
                    {x.tipo} · {contactName(x.contactoId)}
                  </span>
                  <span className="muted clamp">{x.notas}</span>
                </button>
              </li>
            ))}
          </ul>
          <h2>Tareas</h2>
          <ul className="list compact">
            {estado?.tareas.map((t) => (
              <li key={t.id} className="row static">
                <strong>{t.titulo}</strong>
                <span className="muted">
                  {t.equipo} · {t.expedienteId ?? 'sin expediente'} · {t.estado}
                </span>
              </li>
            ))}
          </ul>
          <h2>Correos enviados</h2>
          <ul className="list compact">
            {estado?.correos.length === 0 && <li className="muted">Ninguno todavía.</li>}
            {estado?.correos.map((m) => (
              <li key={m.id} className="row static">
                <strong>{m.asunto}</strong>
                <span className="muted">para {m.para}</span>
                <pre className="mail">{m.cuerpo}</pre>
              </li>
            ))}
          </ul>
        </section>

        <aside className="vex">
          <div className="vex-head">
            <div className="avatar" aria-hidden="true">
              <Vex state={state} viseme={viseme} height={AVATAR_H} title="" />
            </div>
            <div className="vex-meta">
              <strong>{info?.personality.name ?? 'Vex'}</strong>
              <span className="label" data-phase={op.phase}>
                {PHASE_LABEL[op.phase]}
              </span>
              {auth && <span className="muted">actúa como {auth.principal.name}</span>}
            </div>
          </div>

          <div className="log" ref={logRef}>
            {op.turns.length === 0 && (
              <div className="empty">
                <p>Pídeme algo sobre la plataforma. Por ejemplo:</p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="suggestion" onClick={() => setDraft(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {op.turns.map((turn) => (
              <div key={turn.id} className="turn">
                <div className="msg user">{turn.user}</div>
                {turn.steps.length > 0 && (
                  <ol className="steps">
                    {turn.steps.map((s) => (
                      <li key={s.id} className={`step is-${s.outcome}`}>
                        <span className="step-dot" aria-hidden="true" />
                        <span className="step-text">
                          {s.summary}
                          {s.outcome !== 'ok' && s.outcome !== 'pending' && s.detail && s.detail !== s.summary && <em> · {s.detail}</em>}
                        </span>
                        <span className="step-state">{OUTCOME_LABEL[s.outcome]}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {op.pending && !turn.done && (
                  <div className="confirm" role="alertdialog" aria-labelledby={`c-${op.pending.id}`}>
                    <p id={`c-${op.pending.id}`}>
                      <strong>Necesito tu OK:</strong> {op.pending.summary}
                    </p>
                    <p className="muted">Acción irreversible ({op.pending.tool}). Parámetros: {JSON.stringify(op.pending.params)}</p>
                    <div className="confirm-actions">
                      <button type="button" className="btn primary" onClick={() => void op.decide(true)}>
                        Aprobar
                      </button>
                      <button type="button" className="btn" onClick={() => void op.decide(false)}>
                        Rechazar
                      </button>
                    </div>
                  </div>
                )}
                {(turn.reply || turn.error) && <div className={`msg vex ${turn.error ? 'is-error' : ''}`}>{turn.error ?? turn.reply}</div>}
              </div>
            ))}
          </div>

          <form className="composer" onSubmit={submit}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit(e);
                }
              }}
              placeholder={auth ? `Dile a ${info?.personality.name ?? 'Vex'} qué hacer…` : 'Conectando…'}
              rows={2}
              disabled={!auth || op.busy}
            />
            <button type="submit" className="btn primary" disabled={!auth || op.busy || !draft.trim()}>
              Enviar
            </button>
          </form>
          <p className="hint">
            Contexto que viaja con el mensaje: <code>{JSON.stringify(context)}</code>
          </p>
        </aside>
      </main>
    </div>
  );
}
