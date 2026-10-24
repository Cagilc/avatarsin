import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Principal, Risk } from '@vex/operator';
import { demoUsers, login } from './api';
import { deleteConnector, importMcp, importOpenApi, listConnectors, refreshConnector, reviewConnector, type ConnectorView, type Decision } from './connectorsApi';

const RISK_LABEL: Record<Risk, string> = { read: 'Lectura', write: 'Escritura', irreversible: 'Irreversible' };
const RISK_ORDER: Record<Risk, number> = { read: 0, write: 1, irreversible: 2 };
const RISK_HELP: Record<Risk, string> = {
  read: 'se ejecuta sin preguntar',
  write: 'se ejecuta sin preguntar y queda en la auditoría',
  irreversible: 'Vex pide tu OK enseñando lo que va a enviar',
};

function sourceText(c: ConnectorView): string {
  if (c.source.kind === 'openapi') return `OpenAPI · ${c.source.url ?? 'pegada'}`;
  if (c.source.kind === 'mcp-stdio') return `MCP local · ${[c.source.command, ...c.source.args].join(' ')}`;
  return `MCP remoto · ${c.source.url}`;
}

function bindingText(t: ConnectorView['tools'][number]): string {
  return t.binding.kind === 'http' ? `${t.binding.method} ${t.binding.path}` : `MCP ${t.binding.tool}`;
}

/** One connector: the review table where a person decides risk and on/off for each action. */
function ConnectorCard({ connector, token, onChange }: { connector: ConnectorView; token: string; onChange: () => void }) {
  const initial = useMemo(
    () => Object.fromEntries(connector.tools.map((t) => [t.name, { name: t.name, risk: t.risk ?? t.suggestedRisk, enabled: t.enabled, lowerRiskReason: t.review?.lowerRiskReason ?? '' }])),
    [connector],
  );
  const [decisions, setDecisions] = useState<Record<string, Decision>>(initial);
  const [guide, setGuide] = useState(connector.guide);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDecisions(initial);
    setGuide(connector.guide);
  }, [initial, connector.guide]);

  const set = (name: string, patch: Partial<Decision>) => setDecisions((d) => ({ ...d, [name]: { ...d[name]!, ...patch } }));
  const lowered = connector.tools.filter((t) => RISK_ORDER[decisions[t.name]!.risk] < RISK_ORDER[t.suggestedRisk]);
  const missingReason = lowered.some((t) => !decisions[t.name]!.lowerRiskReason?.trim());
  const live = connector.tools.filter((t) => t.enabled && t.review).length;

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const list = connector.tools.map((t) => {
        const d = decisions[t.name]!;
        const lower = RISK_ORDER[d.risk] < RISK_ORDER[t.suggestedRisk];
        return { name: d.name, risk: d.risk, enabled: d.enabled, ...(lower ? { lowerRiskReason: d.lowerRiskReason ?? '' } : {}) };
      });
      await reviewConnector(token, connector.id, { decisions: list, guide });
      setNotice('Revisión guardada. Vex la usa desde el siguiente mensaje.');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await refreshConnector(token, connector.id);
      setNotice(`Actualizado: ${r.added.length} nuevas, ${r.changed.length} cambiadas (vuelven a revisión), ${r.removed.length} quitadas.`);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`¿Borrar el conector ${connector.name}? Vex dejará de poder usarlo.`)) return;
    try {
      await deleteConnector(token, connector.id);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="conn-card" aria-labelledby={`conn-${connector.id}`}>
      <header className="conn-head">
        <div>
          <h3 id={`conn-${connector.id}`}>
            {connector.name} <span className="muted">· {connector.id}</span>
          </h3>
          <p className="muted">{sourceText(connector)}</p>
          {connector.description && <p className="muted">{connector.description}</p>}
        </div>
        <div className="conn-actions">
          <span className={`pill ${live ? 'pill-on' : ''}`}>
            {live} de {connector.tools.length} activas
          </span>
          <button type="button" className="btn" onClick={() => void refresh()} disabled={busy}>
            Actualizar
          </button>
          <button type="button" className="btn" onClick={() => void remove()} disabled={busy}>
            Borrar
          </button>
        </div>
      </header>

      <table className="conn-table">
        <thead>
          <tr>
            <th>Acción</th>
            <th>Sugerido</th>
            <th>Riesgo aprobado</th>
            <th>Activa</th>
          </tr>
        </thead>
        <tbody>
          {connector.tools.map((t) => {
            const d = decisions[t.name]!;
            const lower = RISK_ORDER[d.risk] < RISK_ORDER[t.suggestedRisk];
            return (
              <tr key={t.name} data-tool={t.name}>
                <td>
                  <strong>{t.name}</strong>
                  <span className="muted conn-binding">{bindingText(t)}</span>
                  <span className="conn-desc">{t.description}</span>
                  {t.review ? (
                    <span className="muted conn-review">
                      Revisada por {t.review.by} el {new Date(t.review.at).toLocaleString('es-ES')}
                    </span>
                  ) : (
                    <span className="conn-review is-pending">Sin revisar</span>
                  )}
                </td>
                <td>
                  <span className={`risk risk-${t.suggestedRisk}`}>{RISK_LABEL[t.suggestedRisk]}</span>
                  <span className="muted conn-reason">{t.riskReason}</span>
                </td>
                <td>
                  <label className="visually-hidden" htmlFor={`risk-${t.name}`}>
                    Riesgo de {t.name}
                  </label>
                  <select id={`risk-${t.name}`} value={d.risk} onChange={(e) => set(t.name, { risk: e.target.value as Risk })}>
                    {(['read', 'write', 'irreversible'] as const).map((r) => (
                      <option key={r} value={r}>
                        {RISK_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <span className="muted conn-reason">{RISK_HELP[d.risk]}</span>
                  {lower && (
                    <input
                      className="conn-why"
                      aria-label={`Motivo para bajar el riesgo de ${t.name}`}
                      placeholder="¿Por qué es menos arriesgada de lo que parece?"
                      value={d.lowerRiskReason ?? ''}
                      onChange={(e) => set(t.name, { lowerRiskReason: e.target.value })}
                    />
                  )}
                </td>
                <td>
                  <input type="checkbox" aria-label={`Activar ${t.name}`} checked={d.enabled} onChange={(e) => set(t.name, { enabled: e.target.checked })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <label className="conn-guide">
        Guía para Vex <span className="muted">(se carga solo cuando una petición necesita este conector)</span>
        <textarea rows={3} value={guide} onChange={(e) => setGuide(e.target.value)} placeholder="Para qué sirve, flujos típicos y trampas. Ej.: reserva siempre un hueco que devuelva listar_huecos." />
      </label>

      {error && <p className="error">{error}</p>}
      {notice && <p className="conn-notice">{notice}</p>}
      <div className="conn-footer">
        {missingReason && <span className="error">Explica por qué bajas el riesgo antes de guardar.</span>}
        <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || missingReason}>
          Guardar revisión
        </button>
      </div>
    </section>
  );
}

/** #conectores: connect a tool Vex was never coded for, and decide what it may do. */
export function ConnectorsPage() {
  const [auth, setAuth] = useState<{ token: string; principal: Principal } | null>(null);
  const [list, setList] = useState<ConnectorView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'openapi' | 'mcp'>('openapi');
  const [form, setForm] = useState({ id: 'citas', url: 'http://127.0.0.1:8790/openapi.json', baseUrl: '', authEnv: '', command: 'node', args: '', mcpId: 'notas' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    demoUsers()
      .then((users) => {
        const admin = users.find((u) => u.role === 'admin') ?? users[0];
        return admin ? login(admin.id).then(setAuth) : undefined;
      })
      .catch((e: Error) => setError(`No llego a Vex Core (${e.message}).`));
  }, []);

  const reload = useCallback(() => {
    if (!auth) return;
    listConnectors(auth.token)
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }, [auth]);
  useEffect(reload, [reload]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'openapi') {
        await importOpenApi(auth.token, {
          id: form.id.trim(),
          url: form.url.trim(),
          ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
          ...(form.authEnv.trim() ? { auth: { kind: 'bearer', env: form.authEnv.trim() } } : {}),
        });
      } else {
        await importMcp(auth.token, { id: form.mcpId.trim(), transport: 'stdio', command: form.command.trim(), args: form.args.split('\n').map((a) => a.trim()).filter(Boolean) });
      }
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })) });

  return (
    <div className="lab conn">
      <header className="lab-head">
        <div>
          <h1>Conectores</h1>
          <p className="muted">
            Conecta una herramienta que Vex no conoce. Vex propone el riesgo de cada acción; una persona lo aprueba y decide qué se activa. Nada se activa solo.
            {auth && ` Revisas como ${auth.principal.name} (${auth.principal.role}).`}
          </p>
        </div>
        <a className="btn" href="#">
          ← Demo del operador
        </a>
      </header>

      <form className="conn-import" onSubmit={(e) => void submit(e)}>
        <div className="conn-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={kind === 'openapi'} className={`btn ${kind === 'openapi' ? 'primary' : ''}`} onClick={() => setKind('openapi')}>
            API con OpenAPI
          </button>
          <button type="button" role="tab" aria-selected={kind === 'mcp'} className={`btn ${kind === 'mcp' ? 'primary' : ''}`} onClick={() => setKind('mcp')}>
            Servidor MCP local
          </button>
        </div>
        {kind === 'openapi' ? (
          <div className="conn-fields">
            <label>
              Id <input {...field('id')} placeholder="citas" />
            </label>
            <label className="wide">
              URL de la especificación (JSON) <input {...field('url')} />
            </label>
            <label>
              URL base <span className="muted">(si la especificación no la trae)</span>
              <input {...field('baseUrl')} placeholder="https://api.ejemplo.com" />
            </label>
            <label>
              Variable con el token <span className="muted">(opcional)</span>
              <input {...field('authEnv')} placeholder="CITAS_TOKEN" />
            </label>
          </div>
        ) : (
          <div className="conn-fields">
            <label>
              Id <input {...field('mcpId')} placeholder="notas" />
            </label>
            <label>
              Comando <input {...field('command')} />
            </label>
            <label className="wide">
              Argumentos <span className="muted">(uno por línea)</span>
              <textarea rows={2} {...field('args')} placeholder="ruta/a/apps/sample-tools/src/notas-mcp.ts" />
            </label>
            <p className="muted wide">El comando tiene que estar en VEX_MCP_ALLOW del servidor: arrancar un proceso es ejecutar código en esa máquina.</p>
          </div>
        )}
        <button type="submit" className="btn primary" disabled={!auth || busy}>
          {kind === 'openapi' ? 'Importar' : 'Conectar'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {list.length === 0 && <p className="muted">Todavía no hay conectores.</p>}
      {auth && list.map((c) => <ConnectorCard key={c.id} connector={c} token={auth.token} onChange={reload} />)}
    </div>
  );
}
