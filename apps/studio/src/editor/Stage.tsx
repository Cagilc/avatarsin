import type { AvatarDocument, StateName } from '@vexstudio/format';
import { apply, AvatarPlayer, type LoadedAsset, type Pose } from '@vexstudio/runtime';
import { useEffect, useRef } from 'react';

export interface StageProps {
  doc: AvatarDocument;
  assets: Map<string, LoadedAsset>;
  assetsVersion: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** 'rest' shows the rest pose and lets you drag pivots; 'play' runs animation and physics. */
  mode: 'rest' | 'play';
  state: StateName;
  onPivot: (id: string, p: { x: number; y: number }, commit: boolean) => void;
  banner?: string | null;
}

/**
 * The avatar as it will look, drawn by the same runtime the host pages use, with the editor's
 * handles on top: the selected part's outline, its pivot and the link to its parent.
 */
export function Stage({ doc, assets, assetsVersion, selected, onSelect, mode, state, onPivot, banner }: StageProps) {
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<AvatarPlayer | null>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const outline = useRef<SVGPolygonElement>(null);
  const pivot = useRef<SVGCircleElement>(null);
  const link = useRef<SVGLineElement>(null);
  const live = useRef({ doc, selected });
  live.current = { doc, selected };
  const drag = useRef<string | null>(null);

  const drawHandles = (pose: Pose) => {
    const { doc: d, selected: id } = live.current;
    const part = id ? d.parts.find((p) => p.id === id) : undefined;
    const p = part && pose.get(part.id);
    const show = Boolean(part && p);
    for (const el of [outline.current, pivot.current, link.current]) el?.setAttribute('visibility', show ? 'visible' : 'hidden');
    if (!part || !p) return;
    const b = part.bbox;
    const corners = [apply(p.world, b.x, b.y), apply(p.world, b.x + b.width, b.y), apply(p.world, b.x + b.width, b.y + b.height), apply(p.world, b.x, b.y + b.height)];
    outline.current?.setAttribute('points', corners.map((c) => `${c.x},${c.y}`).join(' '));
    const pv = apply(p.world, part.pivot.x, part.pivot.y);
    pivot.current?.setAttribute('cx', String(pv.x));
    pivot.current?.setAttribute('cy', String(pv.y));
    const parent = part.parent ? d.parts.find((q) => q.id === part.parent) : undefined;
    const pp = parent && pose.get(parent.id);
    if (parent && pp) {
      const a = apply(pp.world, parent.pivot.x, parent.pivot.y);
      link.current?.setAttribute('x1', String(a.x));
      link.current?.setAttribute('y1', String(a.y));
      link.current?.setAttribute('x2', String(pv.x));
      link.current?.setAttribute('y2', String(pv.y));
    } else link.current?.setAttribute('visibility', 'hidden');
  };

  useEffect(() => {
    if (!box.current) return;
    const pl = new AvatarPlayer(box.current, doc, assets, { onFrame: drawHandles, autoplay: false });
    player.current = pl;
    return () => {
      pl.dispose();
      player.current = null;
    };
    // The player is created once; later changes go through setDocument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    player.current?.setDocument(doc, assets);
  }, [doc, assets, assetsVersion]);

  useEffect(() => {
    const pl = player.current;
    if (!pl) return;
    pl.showRest(mode === 'rest');
    if (mode === 'play') pl.play();
    else pl.pause();
  }, [mode]);

  useEffect(() => {
    player.current?.setState(state);
  }, [state]);

  useEffect(() => {
    const pl = player.current;
    if (pl) drawHandles(new Map(doc.parts.map((p) => [p.id, pl.poseOf(p.id) ?? { world: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, opacity: 1 }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, doc]);

  const toCanvas = (e: React.PointerEvent): { x: number; y: number } | null => {
    const svg = overlay.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as Element;
    if (target === pivot.current && selected && mode === 'rest') {
      drag.current = selected;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    // Pick the part under the pointer from the avatar layer below.
    const hit = document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest('[data-part]')).find(Boolean);
    onSelect(hit?.getAttribute('data-part') ?? null);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = toCanvas(e);
    if (p) onPivot(drag.current, p, false);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = toCanvas(e);
    if (p) onPivot(drag.current, p, true);
    drag.current = null;
  };

  const { width, height } = doc.canvas;
  return (
    <div className="stage">
      {banner && <div className="stage-banner">{banner}</div>}
      <div className="stage-canvas" style={{ aspectRatio: `${width} / ${height}` }}>
        <div ref={box} className="stage-avatar" />
        <svg
          ref={overlay}
          className="stage-overlay"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          data-testid="stage-overlay"
        >
          <rect x={0} y={0} width={width} height={height} className="stage-bounds" />
          <line ref={link} className="stage-link" visibility="hidden" />
          <polygon ref={outline} className="stage-outline" visibility="hidden" />
          <circle ref={pivot} r={Math.max(width, height) / 90} className={`stage-pivot${mode === 'rest' ? ' draggable' : ''}`} visibility="hidden" data-testid="pivot-handle" />
        </svg>
      </div>
    </div>
  );
}
