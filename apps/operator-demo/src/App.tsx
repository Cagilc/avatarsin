import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VexAssistantElement } from '@vex/assistant';
import type { Principal } from '@vex/operator';
import { API_URL, demoUsers, estado as fetchEstado, info as fetchInfo, login, type Estado, type OperatorInfo } from './api';

const SUGGESTIONS = [
  'Busca a Laura Pérez, abre expediente de residencia, crea una tarea para extranjería y mándale un correo pidiendo documentación',
  'Crea una tarea para marketing "Campaña de octubre" y envíale el presupuesto por correo',
  '¿Quién es Marco Rossi?',
];

/**
 * The host page: lists of the platform's records, the selection that becomes Vex's screen
 * context, and the operator panel as one tag (<vex-assistant>), which draws the avatar the studio
 * published for this host when the manifest names one.
 */
export function App() {
  const [users, setUsers] = useState<Principal[]>([]);
  const [auth, setAuth] = useState<{ token: string; principal: Principal } | null>(null);
  const [info, setInfo] = useState<OperatorInfo | null>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [selected, setSelected] = useState<{ contactoId?: string; expedienteId?: string }>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const assistant = useRef<VexAssistantElement>(null);

  const refresh = useCallback(() => {
    if (!auth) return;
    fetchEstado(auth.token)
      .then(setEstado)
      .catch((e: Error) => setApiError(e.message));
  }, [auth]);

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

  // The panel gets the token through a function, never through the DOM; a turn that ends refreshes the lists.
  useEffect(() => {
    const el = assistant.current;
    if (!el) return undefined;
    el.suggestions = SUGGESTIONS;
    const onTurn = () => refresh();
    el.addEventListener('vex-turn', onTurn);
    return () => el.removeEventListener('vex-turn', onTurn);
  }, [refresh]);

  useEffect(() => {
    const el = assistant.current;
    if (!el || !auth) return;
    const token = auth.token;
    el.getToken = async () => token;
    el.principal = auth.principal;
    el.reset();
    void el.refresh();
  }, [auth]);

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

  useEffect(() => {
    if (assistant.current) assistant.current.context = context;
  }, [context]);

  const switchUser = async (id: string) => {
    setAuth(await login(id));
  };

  const contactName = (id: string) => estado?.contactos.find((c) => c.id === id)?.nombre ?? id;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="logo">Plataforma demo</span>
          <span className="muted">plataforma · demo del operador Vex</span>
          <a className="pill" href="#estados">laboratorio del avatar</a>
          <a className="pill" href="#conectores">conectores</a>
        </div>
        <div className="top-right">
          {apiError && <span className="error">{apiError}</span>}
          {info && (
            <span className="pill" title="Proveedor del modelo">
              {info.provider === 'scripted' ? 'modo guion (sin clave)' : info.provider}
            </span>
          )}
          {info?.host.manifest && (
            <span className="pill" title="Manifiesto del host">
              {info.host.name}
              {info.host.avatar ? ' · avatar del estudio' : ''}
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
          <vex-assistant ref={assistant} api={API_URL} />
        </aside>
      </main>
    </div>
  );
}
