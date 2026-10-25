import type { ProvenanceEntry } from '@vexstudio/format';
import { useState, type ReactNode } from 'react';

/** Who set a value: the person (fixed), the assistant (with its confidence) or nobody (automatic). */
export function Origin({ entry, onRelease }: { entry: ProvenanceEntry | undefined; onRelease?: () => void }) {
  if (entry?.by === 'user')
    return (
      <span className="origin user" title="Lo fijaste tú: el asistente no lo cambia">
        Tú
        {onRelease && (
          <button type="button" className="origin-release" onClick={onRelease} title="Deja que lo decida el asistente">
            ×
          </button>
        )}
      </span>
    );
  if (entry?.by === 'ai') return <span className="origin ai" title={entry.note ?? 'Lo propuso el asistente'}>IA{entry.confidence !== undefined ? ` ${Math.round(entry.confidence * 100)}%` : ''}</span>;
  return <span className="origin auto" title="Valor automático según el estilo">Auto</span>;
}

export function Field({ label, children, origin }: { label: string; children: ReactNode; origin?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {origin}
      </span>
      {children}
    </label>
  );
}

/**
 * A 0–1 (or ranged) control. While dragging only the screen changes; the value is saved when the
 * slider is released. An unset value shows the automatic one, dimmed.
 */
export function Slider(props: {
  label: string;
  value: number | undefined;
  auto: number;
  min?: number;
  max?: number;
  step?: number;
  left?: string;
  right?: string;
  origin?: ReactNode;
  testId?: string;
  onChange: (v: number, commit: boolean) => void;
}) {
  const { min = 0, max = 1, step = 0.01 } = props;
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? props.value ?? props.auto;
  const commit = (v: number) => {
    setDragging(null);
    props.onChange(v, true);
  };
  return (
    <div className={`slider${props.value === undefined ? ' is-auto' : ''}`}>
      <span className="field-label">
        {props.label}
        {props.origin}
        <span className="slider-value">{max <= 1 ? `${Math.round(shown * 100)}%` : Math.round(shown)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        data-testid={props.testId}
        aria-label={props.label}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDragging(v);
          props.onChange(v, false);
        }}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
      />
      {(props.left || props.right) && (
        <span className="slider-ends">
          <span>{props.left}</span>
          <span>{props.right}</span>
        </span>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<[T, string]>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}
