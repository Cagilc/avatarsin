import { useEffect, useState } from 'react';
import { POSES, STATE_FACES, Vex, lodForHeight, type VexExpression, type VexState, type Viseme } from '@vex/avatar';

const STATES = Object.keys(POSES) as VexState[];
const EXPRESSIONS: VexExpression[] = ['neutral', 'happy', 'thinking', 'wow', 'success'];
const VISEMES: Viseme[] = ['X', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** What a real run looks like, phase by phase, so the whole sequence can be reviewed without the API. */
const SEQUENCE: Array<{ state: VexState; label: string; ms: number }> = [
  { state: 'greeting', label: 'saluda al cargar', ms: 1800 },
  { state: 'listening', label: 'escucha la petición', ms: 1200 },
  { state: 'thinking', label: 'piensa qué hacer', ms: 1400 },
  { state: 'working', label: 'ejecuta los pasos', ms: 1800 },
  { state: 'listening', label: 'espera tu OK', ms: 1600 },
  { state: 'working', label: 'envía el correo', ms: 1200 },
  { state: 'talking', label: 'cuenta el resultado', ms: 1600 },
  { state: 'success', label: 'celebra', ms: 1200 },
  { state: 'idle', label: 'en reposo', ms: 1500 },
];

/** Visual test bench for the rig: every state, face and mouth shape, the LOD by size, and a scripted run. */
export function StatesLab() {
  const [height, setHeight] = useState(150);
  const [animate, setAnimate] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [viseme, setViseme] = useState<Viseme | null>(null);

  useEffect(() => {
    if (!playing) return undefined;
    const current = SEQUENCE[step % SEQUENCE.length]!;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % SEQUENCE.length), current.ms);
    return () => window.clearTimeout(id);
  }, [playing, step]);

  useEffect(() => {
    const current = SEQUENCE[step % SEQUENCE.length]!;
    if (!playing || current.state !== 'talking') {
      setViseme(null);
      return undefined;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setViseme(VISEMES[i % VISEMES.length] ?? null);
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, step]);

  const current = SEQUENCE[step % SEQUENCE.length]!;

  return (
    <div className="lab">
      <header className="lab-head">
        <div>
          <h1>Laboratorio del avatar</h1>
          <p className="muted">Todos los estados del rig, para revisarlos sin pasar por el operador. Vuelve a la demo con el enlace de la derecha.</p>
        </div>
        <a className="btn" href="#">
          ← Demo del operador
        </a>
      </header>

      <section className="lab-section">
        <h2>Secuencia de una petición</h2>
        <div className="lab-run">
          <div className="lab-stage">
            <Vex state={current.state} viseme={viseme} height={220} animate={animate} title="" />
          </div>
          <div className="lab-run-side">
            <p>
              <strong>{current.state}</strong> · {current.label}
            </p>
            <ol className="lab-seq">
              {SEQUENCE.map((s, i) => (
                <li key={`${s.state}-${i}`} className={i === step % SEQUENCE.length ? 'is-current' : ''}>
                  {s.state} <span className="muted">· {s.label}</span>
                </li>
              ))}
            </ol>
            <div className="lab-controls">
              <button type="button" className="btn primary" onClick={() => setPlaying((p) => !p)}>
                {playing ? 'Pausar' : 'Reproducir'}
              </button>
              <button type="button" className="btn" onClick={() => setStep((s) => (s + 1) % SEQUENCE.length)}>
                Siguiente paso
              </button>
              <label className="muted">
                <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} /> bucles (flotar, llama, parpadeo)
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="lab-section">
        <h2>Estados ({STATES.length})</h2>
        <div className="lab-grid">
          {STATES.map((s) => (
            <figure key={s} className="lab-card">
              <Vex state={s} height={150} animate={animate} title="" />
              <figcaption>
                <strong>{s}</strong>
                <span className="muted">cara: {STATE_FACES[s]}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="lab-section">
        <h2>Expresiones ({EXPRESSIONS.length})</h2>
        <div className="lab-grid">
          {EXPRESSIONS.map((e) => (
            <figure key={e} className="lab-card">
              <Vex state="idle" expression={e} height={120} lod="head" animate={animate} title="" />
              <figcaption>
                <strong>{e}</strong>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="lab-section">
        <h2>Visemas (boca al hablar, {VISEMES.length})</h2>
        <div className="lab-grid">
          {VISEMES.map((v) => (
            <figure key={v} className="lab-card">
              <Vex state="talking" viseme={v} height={110} lod="head" animate={false} title="" />
              <figcaption>
                <strong>{v}</strong>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="lab-section">
        <h2>Tamaño y nivel de detalle</h2>
        <div className="lab-run">
          <div className="lab-stage" style={{ minHeight: 260 }}>
            <Vex state="idle" height={height} animate={animate} title="" />
          </div>
          <div className="lab-run-side">
            <label>
              Altura: <strong>{height} px</strong> → nivel <strong>{lodForHeight(height)}</strong>
              <input type="range" min={32} max={260} value={height} onChange={(e) => setHeight(Number(e.target.value))} />
            </label>
            <p className="muted">Cuerpo entero a partir de 160 px, busto entre 64 y 160, solo cabeza por debajo de 64. Así cabe en una barra, una burbuja o una esquina.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
