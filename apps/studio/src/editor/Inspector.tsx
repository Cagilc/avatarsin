import {
  effectiveMaterial,
  effectivePhysics,
  effectiveSquash,
  FINISHES,
  LANGUAGES,
  presetOps,
  RISKS,
  ROLES,
  STATES,
  TEXTURES,
  TONES,
  type AvatarDocument,
  type Material,
  type Op,
  type Part,
  type Physics,
  type StateName,
} from '@vexstudio/format';
import { useState } from 'react';
import { Field, Origin, Slider, Tabs } from './controls.tsx';
import type { ApplyOptions } from './useAvatar.ts';

type Apply = (ops: Op[], opts?: ApplyOptions) => unknown;
type Tab = 'pieza' | 'estilo' | 'animacion' | 'personalidad' | 'capacidades';

export const ROLE_LABEL: Record<(typeof ROLES)[number], string> = {
  body: 'Cuerpo', head: 'Cabeza', face: 'Cara', eye: 'Ojo', mouth: 'Boca', arm: 'Brazo', hand: 'Mano', leg: 'Pierna', ear: 'Oreja',
  antenna: 'Antena', tail: 'Cola', hair: 'Pelo', accessory: 'Accesorio', text: 'Texto', background: 'Fondo', other: 'Otra',
};
export const STATE_LABEL: Record<StateName, string> = { idle: 'Reposo', talk: 'Hablando', think: 'Pensando', happy: 'Contento', wave: 'Saludando', attention: 'Atento', error: 'Error', sleep: 'Dormido', point: 'Señalando', celebrate: 'Celebrando' };
const FINISH_LABEL: Record<(typeof FINISHES)[number], string> = { flat: 'Plano', matte: 'Mate', satin: 'Satinado', gloss: 'Brillante', metal: 'Metálico' };
const TEXTURE_LABEL: Record<(typeof TEXTURES)[number], string> = { none: 'Ninguna', grain: 'Grano', fabric: 'Tela', paper: 'Papel', noise: 'Ruido' };
const TONE_LABEL: Record<(typeof TONES)[number], string> = { cercano: 'Cercano', profesional: 'Profesional', divertido: 'Divertido', serio: 'Serio', entusiasta: 'Entusiasta' };
const RISK_LABEL: Record<(typeof RISKS)[number], string> = { read: 'Solo consultar', write: 'Consultar y crear o modificar', irreversible: 'También acciones irreversibles (con confirmación)' };

export interface InspectorProps {
  doc: AvatarDocument;
  selected: Part | null;
  apply: Apply;
  isOwner: boolean;
  onPreviewState: (s: StateName) => void;
}

export function Inspector({ doc, selected, apply, isOwner, onPreviewState }: InspectorProps) {
  const [tab, setTab] = useState<Tab>('pieza');
  const tabs: Array<[Tab, string]> = [['pieza', 'Pieza'], ['estilo', 'Estilo y física'], ['animacion', 'Animación'], ['personalidad', 'Personalidad']];
  if (isOwner) tabs.push(['capacidades', 'Capacidades']);
  const release = (path: string) => apply([{ op: 'release', paths: [path] }], { summary: `Liberado ${path}` });
  const prov = (path: string) => <Origin entry={doc.provenance[path]} onRelease={() => release(path)} />;

  return (
    <aside className="inspector">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="inspector-body">
        {tab === 'pieza' && (selected ? <PartPanel doc={doc} part={selected} apply={apply} prov={prov} /> : <p className="muted">Selecciona una pieza en la escena o en la lista.</p>)}
        {tab === 'estilo' && <StylePanel doc={doc} apply={apply} prov={prov} />}
        {tab === 'animacion' && <AnimationPanel doc={doc} apply={apply} prov={prov} onPreviewState={onPreviewState} />}
        {tab === 'personalidad' && <PersonalityPanel doc={doc} apply={apply} prov={prov} />}
        {tab === 'capacidades' && isOwner && <CapabilitiesPanel doc={doc} apply={apply} />}
      </div>
    </aside>
  );
}

type Prov = (path: string) => React.ReactNode;

function PartPanel({ doc, part, apply, prov }: { doc: AvatarDocument; part: Part; apply: Apply; prov: Prov }) {
  // A part cannot hang from itself or from its own descendants.
  const descendants = new Set<string>([part.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of doc.parts) {
      if (p.parent && descendants.has(p.parent) && !descendants.has(p.id)) {
        descendants.add(p.id);
        grew = true;
      }
    }
  }
  const phys = effectivePhysics(part, doc);
  const mat = effectiveMaterial(part, doc);
  const setPhysics = (patch: Partial<Physics>, commit: boolean) => apply([{ op: 'setPhysics', part: part.id, physics: { enabled: phys.enabled, ...part.physics, ...patch } }], { commit, summary: `Física de ${part.name}` });
  const setMaterial = (patch: Partial<Material>, commit = true) => apply([{ op: 'setMaterial', part: part.id, material: { ...part.material, ...patch } }], { commit, summary: `Material de ${part.name}` });
  const update = (patch: Partial<Omit<Part, 'id' | 'physics' | 'material'>>) => apply([{ op: 'updatePart', id: part.id, patch }], { summary: `${part.name}: ${Object.keys(patch).join(', ')}` });

  return (
    <div className="panel" data-testid="part-panel">
      <Field label="Nombre" origin={prov(`part:${part.id}:name`)}>
        <input defaultValue={part.name} key={`${part.id}-name`} maxLength={60} onBlur={(e) => e.target.value !== part.name && update({ name: e.target.value })} />
      </Field>
      <div className="row">
        <Field label="Papel" origin={prov(`part:${part.id}:role`)}>
          <select value={part.role ?? 'other'} onChange={(e) => update({ role: e.target.value as Part['role'] })} data-testid="part-role">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cuelga de" origin={prov(`part:${part.id}:parent`)}>
          <select value={part.parent ?? ''} onChange={(e) => update({ parent: e.target.value || null })} data-testid="part-parent">
            <option value="">— (raíz)</option>
            {doc.parts
              .filter((p) => !descendants.has(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Pivote X" origin={prov(`part:${part.id}:pivot`)}>
          <input type="number" value={Math.round(part.pivot.x * 10) / 10} step={1} onChange={(e) => update({ pivot: { ...part.pivot, x: Number(e.target.value) } })} />
        </Field>
        <Field label="Pivote Y">
          <input type="number" value={Math.round(part.pivot.y * 10) / 10} step={1} onChange={(e) => update({ pivot: { ...part.pivot, y: Number(e.target.value) } })} />
        </Field>
        <Field label="Orden">
          <input type="number" value={part.z} step={1} onChange={(e) => update({ z: Math.round(Number(e.target.value)) })} />
        </Field>
      </div>
      <p className="hint">Arrastra el punto azul en la escena (modo Reposo) para colocar el pivote.</p>

      <h3>
        Movimiento secundario {prov(`part:${part.id}:physics`)}
      </h3>
      <label className="check">
        <input type="checkbox" checked={phys.enabled} onChange={(e) => setPhysics({ enabled: e.target.checked }, true)} data-testid="physics-enabled" /> Se balancea al moverse (muelle)
      </label>
      {phys.enabled && (
        <>
          <Slider label="Rigidez" value={part.physics?.stiffness} auto={phys.stiffness} left="Blanda" right="Rígida" onChange={(v, c) => setPhysics({ stiffness: v }, c)} />
          <Slider label="Amortiguación" value={part.physics?.damping} auto={phys.damping} left="Rebota" right="Se para" onChange={(v, c) => setPhysics({ damping: v }, c)} />
          <Slider label="Peso" value={part.physics?.weight} auto={phys.weight} left="Ligera" right="Pesada" onChange={(v, c) => setPhysics({ weight: v }, c)} />
          <Slider label="Caída por gravedad" value={part.physics?.gravity} auto={phys.gravity} left="Nada" right="Cuelga" onChange={(v, c) => setPhysics({ gravity: v }, c)} />
          <Slider label="Giro máximo (°)" value={part.physics?.limit} auto={phys.limit} min={0} max={180} step={1} onChange={(v, c) => setPhysics({ limit: v }, c)} />
        </>
      )}

      <h3>
        Material {prov(`part:${part.id}:material`)}
      </h3>
      <div className="row">
        <Field label="Acabado">
          <select value={mat.finish} onChange={(e) => setMaterial({ finish: e.target.value as Material['finish'] })} data-testid="material-finish">
            {FINISHES.map((f) => (
              <option key={f} value={f}>
                {FINISH_LABEL[f]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Textura">
          <select value={mat.texture} onChange={(e) => setMaterial({ texture: e.target.value as Material['texture'] })}>
            {TEXTURES.map((t) => (
              <option key={t} value={t}>
                {TEXTURE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {mat.texture !== 'none' && <Slider label="Intensidad de la textura" value={part.material?.textureStrength} auto={mat.textureStrength} onChange={(v, c) => setMaterial({ textureStrength: v }, c)} />}
      <Slider label="Sombra" value={part.material?.shadow} auto={mat.shadow} onChange={(v, c) => setMaterial({ shadow: v }, c)} />
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={mat.outline !== null} onChange={(e) => setMaterial({ outline: e.target.checked ? { width: 3, color: '#1f2937' } : null })} /> Contorno
        </label>
        {mat.outline && (
          <>
            <input type="number" min={0} max={20} step={0.5} value={mat.outline.width} onChange={(e) => setMaterial({ outline: { ...mat.outline!, width: Number(e.target.value) } })} aria-label="Grosor del contorno" />
            <input type="color" value={mat.outline.color} onChange={(e) => setMaterial({ outline: { ...mat.outline!, color: e.target.value } })} aria-label="Color del contorno" />
          </>
        )}
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={mat.tint !== null} onChange={(e) => setMaterial({ tint: e.target.checked ? '#ffd27a' : null })} /> Tinte
        </label>
        {mat.tint && <input type="color" value={mat.tint} onChange={(e) => setMaterial({ tint: e.target.value })} aria-label="Color del tinte" />}
      </div>
      <label className="check">
        <input type="checkbox" checked={part.visible} onChange={(e) => update({ visible: e.target.checked })} /> Visible
      </label>
    </div>
  );
}

function StylePanel({ doc, apply, prov }: { doc: AvatarDocument; apply: Apply; prov: Prov }) {
  const g = doc.world.gravity;
  return (
    <div className="panel">
      <Slider label="Estilo" value={doc.style.realism} auto={doc.style.realism} left="Dibujo plano" right="Realista" origin={prov('style.realism')} testId="realism" onChange={(v, commit) => apply([{ op: 'setStyle', style: { realism: v } }], { commit, summary: 'Estilo' })} />
      <p className="hint">Mueve a la vez el rebote, el peso, los brillos y las sombras de todas las piezas que no tengan un valor propio.</p>
      <Slider label="Estirar y encoger" value={doc.style.squash} auto={effectiveSquash(doc)} left="Nada" right="Mucho" origin={prov('style.squash')} onChange={(v, commit) => apply([{ op: 'setStyle', style: { squash: v } }], { commit, summary: 'Estirar y encoger' })} />
      <h3>Mundo {prov('world.gravity')}</h3>
      <Slider label="Gravedad" value={g.strength} auto={g.strength} min={0} max={3} step={0.05} left="Flota" right="Muy pesada" onChange={(v, commit) => apply([{ op: 'setWorld', world: { gravity: { ...g, strength: v } } }], { commit, summary: 'Gravedad' })} />
      <p className="hint">{g.strength.toFixed(2)} × la gravedad normal.</p>
      <Slider label="Dirección (°)" value={g.angle} auto={g.angle} min={-180} max={180} step={1} left="←" right="→ (90 = abajo)" onChange={(v, commit) => apply([{ op: 'setWorld', world: { gravity: { ...g, angle: v } } }], { commit, summary: 'Dirección de la gravedad' })} />
    </div>
  );
}

function AnimationPanel({ doc, apply, prov, onPreviewState }: { doc: AvatarDocument; apply: Apply; prov: Prov; onPreviewState: (s: StateName) => void }) {
  return (
    <div className="panel">
      <p className="hint">Cada estado lo activa la plataforma donde vive el avatar (habla, piensa, saluda…).</p>
      <table className="states">
        <tbody>
          {STATES.map((s) => (
            <tr key={s}>
              <td>
                <button type="button" className="link" onClick={() => onPreviewState(s)} data-testid={`preview-${s}`}>
                  ▶ {STATE_LABEL[s]}
                </button>
              </td>
              <td>
                <select value={doc.states[s] ?? ''} onChange={(e) => apply([{ op: 'setState', state: s, clip: e.target.value || null }], { summary: `Estado ${s}` })}>
                  <option value="">{s === 'idle' ? '— (sin animación)' : '— (usa Reposo)'}</option>
                  {doc.clips.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.duration}s
                    </option>
                  ))}
                </select>
              </td>
              <td>{prov(`state:${s}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="secondary" disabled={doc.parts.length === 0} onClick={() => apply(presetOps(doc, STATES), { lock: false, summary: 'Animaciones de partida' })} data-testid="regenerate-clips">
        Regenerar animaciones de partida
      </button>
      <p className="hint">Se adaptan al esqueleto y al estilo actuales. La edición fotograma a fotograma llega en la siguiente fase.</p>
    </div>
  );
}

function PersonalityPanel({ doc, apply, prov }: { doc: AvatarDocument; apply: Apply; prov: Prov }) {
  const p = doc.personality;
  const set = (patch: Partial<typeof p>, commit = true) => apply([{ op: 'setPersonality', patch }], { commit, summary: 'Personalidad' });
  return (
    <div className="panel">
      <Field label="Nombre visible" origin={prov('personality.displayName')}>
        <input defaultValue={p.displayName} key={`dn-${p.displayName}`} maxLength={40} onBlur={(e) => e.target.value !== p.displayName && set({ displayName: e.target.value })} />
      </Field>
      <div className="row">
        <Field label="Tono" origin={prov('personality.tone')}>
          <select value={p.tone} onChange={(e) => set({ tone: e.target.value as typeof p.tone })}>
            {TONES.map((t) => (
              <option key={t} value={t}>
                {TONE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Idioma">
          <select value={p.language} onChange={(e) => set({ language: e.target.value as typeof p.language })}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Slider label="Formalidad" value={p.formality} auto={p.formality} left="Tutea" right="Formal" onChange={(v, c) => set({ formality: v }, c)} />
      <Slider label="Extensión de las respuestas" value={p.verbosity} auto={p.verbosity} left="Breve" right="Detallada" onChange={(v, c) => set({ verbosity: v }, c)} />
      <label className="check">
        <input type="checkbox" checked={p.emoji} onChange={(e) => set({ emoji: e.target.checked })} /> Usa emojis
      </label>
      <Field label="Saludo">
        <input defaultValue={p.greeting} key={`gr-${p.greeting}`} maxLength={200} onBlur={(e) => e.target.value !== p.greeting && set({ greeting: e.target.value })} />
      </Field>
      <Field label="Quién es (contexto para el operador)">
        <textarea defaultValue={p.about} key={`ab-${p.about.length}`} maxLength={1000} rows={4} onBlur={(e) => e.target.value !== p.about && set({ about: e.target.value })} />
      </Field>
      <p className="hint">La personalidad cambia cómo habla, nunca lo que puede hacer.</p>
    </div>
  );
}

function CapabilitiesPanel({ doc, apply }: { doc: AvatarDocument; apply: Apply }) {
  const c = doc.capabilities;
  const [text, setText] = useState(c.tools.join('\n'));
  const tools = text
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const invalid = tools.filter((t) => !/^[a-z][a-z0-9_.-]{0,63}$/.test(t));
  return (
    <div className="panel">
      <p className="hint">Qué puede hacer como operador. Cada integración solo puede reducirlo, nunca ampliarlo. Ni el asistente ni un editor pueden cambiarlo.</p>
      <Field label="Herramientas permitidas (una por línea)">
        <textarea value={text} rows={6} onChange={(e) => setText(e.target.value)} placeholder={'buscar_contacto\ncrear_expediente'} />
      </Field>
      {invalid.length > 0 && <p className="error">Nombres no válidos: {invalid.join(', ')}</p>}
      <button type="button" disabled={invalid.length > 0} onClick={() => apply([{ op: 'setCapabilities', capabilities: { tools: [...new Set(tools)] } }], { summary: 'Capacidades: herramientas' })}>
        Guardar herramientas
      </button>
      <Field label="Riesgo máximo">
        <select value={c.maxRisk} onChange={(e) => apply([{ op: 'setCapabilities', capabilities: { maxRisk: e.target.value as typeof c.maxRisk } }], { summary: 'Capacidades: riesgo' })}>
          {RISKS.map((r) => (
            <option key={r} value={r}>
              {RISK_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
