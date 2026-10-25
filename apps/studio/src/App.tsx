import { useEffect, useState } from 'react';
import { api, getToken, setToken, type AvatarSummary, type Config, type User } from './api.ts';
import { Editor } from './editor/Editor.tsx';

function Login({ config, onIn }: { config: Config; onIn: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enter = async (fn: () => Promise<{ token: string; user: User }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setToken(r.token);
      onIn(r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enter(() => api.login(email, password));
        }}
      >
        <h1>Vex Studio</h1>
        <p className="muted">Estudio privado de avatares. Solo cuentas creadas por el propietario.</p>
        <label className="field">
          <span className="field-label">Correo</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Contraseña</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" disabled={busy}>
          Entrar
        </button>
        {config.devLogin && (
          <button type="button" className="secondary" disabled={busy} onClick={() => void enter(api.devLogin)} data-testid="dev-login">
            Entrar en modo desarrollo (solo en este equipo)
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

function AvatarList({ user, onOpen, onLogout }: { user: User; onOpen: (id: string) => void; onLogout: () => void }) {
  const [list, setList] = useState<AvatarSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .avatars()
      .then((r) => setList(r.avatars))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  return (
    <div className="home">
      <header className="topbar">
        <h1>Vex Studio</h1>
        <div className="spacer" />
        <span className="muted small">
          {user.name} · {user.role === 'owner' ? 'propietario' : 'editor'}
        </span>
        <button type="button" className="link" onClick={onLogout}>
          Salir
        </button>
      </header>
      <main>
        <form
          className="create"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            api
              .createAvatar(name.trim())
              .then((r) => onOpen(r.id))
              .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
          }}
        >
          <input placeholder="Nombre del nuevo avatar" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="new-avatar-name" />
          <button type="submit" data-testid="new-avatar">
            Crear avatar
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        {list === null ? (
          <p className="muted">Cargando…</p>
        ) : list.length === 0 ? (
          <p className="muted">Aún no hay avatares.</p>
        ) : (
          <ul className="avatar-list">
            {list.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onOpen(a.id)}>
                  <strong>{a.name}</strong>
                  <span className="muted small">
                    v{a.revision} · {a.published ? `publicada v${a.published}` : 'sin publicar'} · {new Date(a.updatedAt).toLocaleString('es-ES')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.hash.slice(1)).get('avatar'));

  useEffect(() => {
    void api.config().then(setConfig);
    if (!getToken()) return setChecking(false);
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    history.replaceState(null, '', open ? `#avatar=${open}` : '#');
  }, [open]);

  if (!config || checking) return <div className="loading">Cargando…</div>;
  if (!user) return <Login config={config} onIn={setUser} />;
  if (open) return <Editor key={open} avatarId={open} user={user} config={config} onBack={() => setOpen(null)} />;
  return (
    <AvatarList
      user={user}
      onOpen={setOpen}
      onLogout={() => {
        setToken(null);
        setUser(null);
      }}
    />
  );
}
