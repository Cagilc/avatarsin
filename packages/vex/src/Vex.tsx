import { useEffect, useId, useState, type CSSProperties } from 'react';
import { LOD, POSES, STATE_FACES, lodForHeight, type VexExpression, type VexLod, type VexState, type Viseme } from './rig';
import './vex.css';

export interface VexProps {
  state?: VexState;
  /** Overrides the face implied by the state. */
  expression?: VexExpression;
  /** Mouth shape while speaking; replaces the expression's mouth. */
  viseme?: Viseme | null;
  /** Rendered height in px. Width follows the viewBox ratio. */
  height?: number;
  /** 'auto' picks full/bust/head from `height`. */
  lod?: VexLod | 'auto';
  /** Idle loops (float, flame, blink…). Off automatically with prefers-reduced-motion. */
  animate?: boolean;
  className?: string;
  /** Accessible name; pass '' to hide from assistive tech when a parent labels it. */
  title?: string;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

function joint(deg: number, cx: number, cy: number): CSSProperties {
  return { transform: `rotate(${deg}deg)`, transformOrigin: `${cx}px ${cy}px` };
}

/** Vex, the assistant avatar. Layered SVG rig; pose and face come from `state`. */
export function Vex({
  state = 'idle',
  expression,
  viseme = null,
  height = 500,
  lod = 'auto',
  animate = true,
  className,
  title = 'Vex, asistente de IA',
}: VexProps) {
  // Gradient/filter ids must be unique per instance; React ids contain ':' which url() dislikes.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (name: string) => `vx${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;

  const reduced = usePrefersReducedMotion();
  const begin = animate && !reduced ? '0s' : 'indefinite';

  const level = lod === 'auto' ? lodForHeight(height) : lod;
  const [vx, vy, vw, vh] = LOD[level].viewBox;
  const width = Math.round((height * vw) / vh);

  const pose = POSES[state];
  const face = expression ?? STATE_FACES[state];
  const mouth: Viseme | VexExpression = viseme ?? face;

  const showTablet = state === 'working';
  const showPen = state === 'creative';
  const showCurve = state === 'creative' && level === 'full';

  return (
    <svg
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      width={width}
      height={height}
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      data-state={state}
    >
      <defs>
        <linearGradient id={id('body')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#D3DFEE" />
        </linearGradient>
        <linearGradient id={id('blue')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6FB2FF" />
          <stop offset="1" stopColor="#1F5FE0" />
        </linearGradient>
        <linearGradient id={id('fin')} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#2E7BFF" />
          <stop offset="1" stopColor="#9AD4FF" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id={id('visor')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14204A" />
          <stop offset="1" stopColor="#060B1F" />
        </linearGradient>
        <linearGradient id={id('flame')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E9FBFF" />
          <stop offset="0.35" stopColor="#5CE1FF" />
          <stop offset="1" stopColor="#2E7BFF" stopOpacity="0" />
        </linearGradient>
        <filter id={id('glow')} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 0 · Decorative vector curve (creative pose) */}
      {showCurve && (
        <g fill="none" strokeLinecap="round">
          <path d="M30 440 C 110 330 250 480 372 352" stroke="#E25CFF" strokeWidth="4" filter={url('glow')} />
          <path d="M40 300 C 120 250 160 380 250 300" stroke="#5CE1FF" strokeWidth="3" filter={url('glow')} />
          <rect x="25" y="435" width="10" height="10" fill="#0B1636" stroke="#E25CFF" strokeWidth="2" />
          <rect x="367" y="347" width="10" height="10" fill="#0B1636" stroke="#E25CFF" strokeWidth="2" />
          <circle cx="110" cy="330" r="5" fill="#E25CFF" />
          <line x1="110" y1="330" x2="30" y2="440" stroke="#E25CFF" strokeWidth="1.5" opacity="0.6" />
        </g>
      )}

      {/* 1 · Root with hover loop (pivot 200,300) */}
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0;0 -6;0 0"
          keyTimes="0;0.5;1"
          calcMode="spline"
          keySplines="0.45 0 0.55 1;0.45 0 0.55 1"
          dur="2.4s"
          repeatCount="indefinite"
          begin={begin}
        />

        {/* 2 · Thruster (pivot 200,384) and flame (pivot 200,408) */}
        <g>
          <g transform="translate(200 408)">
            <g>
              <animateTransform
                attributeName="transform"
                type="scale"
                values="1 1;0.94 1.22;1.04 0.9;1 1"
                dur="0.36s"
                repeatCount="indefinite"
                begin={begin}
              />
              <g transform="translate(-200 -408)">
                <path
                  d="M184 404 C 186 440 196 470 200 478 C 204 470 214 440 216 404 Z"
                  fill={url('flame')}
                  filter={url('glow')}
                />
              </g>
            </g>
          </g>
          <path d="M176 380 L224 380 L216 408 L184 408 Z" fill="#9FB3CF" stroke="#7F93B3" strokeWidth="1.5" />
        </g>

        {/* 3 · Torso (pivot 200,384) */}
        <g>
          <path
            d="M146 278 C 170 266 230 266 254 278 C 270 318 262 360 240 382 C 214 396 186 396 160 382 C 138 360 130 318 146 278 Z"
            fill={url('body')}
            stroke="#B9C8DC"
            strokeWidth="2"
          />
          <path d="M240 292 C 254 320 252 354 236 376" fill="none" stroke="#C5D3E6" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
          <path d="M160 372 Q 200 388 240 372" fill="none" stroke="#B9C8DC" strokeWidth="2" />
          <g>
            <circle cx="200" cy="318" r="19" fill="#DCE8F7" stroke={url('blue')} strokeWidth="5" />
            <circle cx="200" cy="318" r="10" fill="#5CE1FF" filter={url('glow')}>
              <animate attributeName="opacity" values="1;0.55;1" dur="1.8s" repeatCount="indefinite" begin={begin} />
            </circle>
          </g>
        </g>

        {/* 4 · Holographic panel (working pose) */}
        {showTablet && (
          <g>
            <rect x="160" y="314" width="80" height="58" rx="8" fill="#5CE1FF" fillOpacity="0.16" stroke="#5CE1FF" strokeWidth="2" filter={url('glow')} />
            <path d="M170 328 h34 M170 340 h52 M170 352 h24" stroke="#5CE1FF" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
            <path d="M206 362 l7 -10 l7 5 l9 -14" stroke="#E25CFF" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}

        {/* 5 · Left arm: shoulder (146,290) › elbow (146,346) › wrist (146,394) */}
        <g className="vex-joint" style={joint(pose.armL, 146, 290)}>
          <rect x="134" y="292" width="24" height="52" rx="12" fill={url('body')} stroke="#B9C8DC" strokeWidth="1.5" />
          <g className="vex-joint" style={joint(pose.elbowL, 146, 346)}>
            <rect x="135" y="346" width="22" height="46" rx="11" fill={url('body')} stroke="#B9C8DC" strokeWidth="1.5" />
            <circle cx="146" cy="346" r="10" fill={url('blue')} />
            <g>
              <rect x="132" y="388" width="28" height="22" rx="10" fill="#3B4250" />
              <path d="M140 404 v6 M146 404 v7 M152 404 v6" stroke="#262B34" strokeWidth="2" strokeLinecap="round" />
            </g>
          </g>
        </g>

        {/* 6 · Right arm: shoulder (254,290) › elbow (254,346) › wrist (254,394) */}
        <g className="vex-joint" style={joint(pose.armR, 254, 290)}>
          <rect x="242" y="292" width="24" height="52" rx="12" fill={url('body')} stroke="#B9C8DC" strokeWidth="1.5" />
          <g
            className={state === 'greeting' && !reduced ? 'vex-joint vex-wave' : 'vex-joint'}
            style={joint(pose.elbowR, 254, 346)}
          >
            <rect x="243" y="346" width="22" height="46" rx="11" fill={url('body')} stroke="#B9C8DC" strokeWidth="1.5" />
            <circle cx="254" cy="346" r="10" fill={url('blue')} />
            <g>
              {showPen && (
                <g>
                  <line x1="254" y1="398" x2="254" y2="452" stroke={url('blue')} strokeWidth="10" strokeLinecap="round" />
                  <path d="M249 452 L254 470 L259 452 Z" fill="#E9FBFF" filter={url('glow')} />
                </g>
              )}
              <rect x="240" y="388" width="28" height="22" rx="10" fill="#3B4250" />
              <path d="M248 404 v6 M254 404 v7 M260 404 v6" stroke="#262B34" strokeWidth="2" strokeLinecap="round" />
            </g>
          </g>
        </g>

        {/* 7 · Shoulders (fixed to the torso) */}
        <circle cx="146" cy="290" r="13" fill={url('blue')} />
        <circle cx="254" cy="290" r="13" fill={url('blue')} />

        {/* 8 · Head (neck pivot 200,262) */}
        <g className="vex-joint" style={joint(pose.head, 200, 262)}>
          <circle cx="200" cy="262" r="14" fill={url('blue')} />

          <g className="vex-joint" style={joint(pose.finL, 104, 118)}>
            <g>
              <animateTransform attributeName="transform" type="rotate" values="0 104 118;-5 104 118;0 104 118" dur="3s" repeatCount="indefinite" begin={begin} />
              <path d="M98 126 C 80 98 66 58 70 22 C 90 42 112 84 122 116 Z" fill={url('fin')} stroke="#2E7BFF" strokeWidth="1.5" />
              <path d="M86 92 C 80 72 78 54 80 40" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.55" />
            </g>
          </g>
          <g className="vex-joint" style={joint(pose.finR, 296, 118)}>
            <g>
              <animateTransform attributeName="transform" type="rotate" values="0 296 118;5 296 118;0 296 118" dur="3s" repeatCount="indefinite" begin={begin} />
              <path d="M302 126 C 320 98 334 58 330 22 C 310 42 288 84 278 116 Z" fill={url('fin')} stroke="#2E7BFF" strokeWidth="1.5" />
              <path d="M314 92 C 320 72 322 54 320 40" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.55" />
            </g>
          </g>

          <g>
            <circle cx="92" cy="156" r="30" fill={url('body')} stroke="#B9C8DC" strokeWidth="2" />
            <circle cx="92" cy="156" r="16" fill="#DCE8F7" stroke={url('blue')} strokeWidth="6" />
          </g>
          <g>
            <circle cx="308" cy="156" r="30" fill={url('body')} stroke="#B9C8DC" strokeWidth="2" />
            <circle cx="308" cy="156" r="16" fill="#DCE8F7" stroke={url('blue')} strokeWidth="6" />
          </g>

          <g>
            <rect x="86" y="56" width="228" height="196" rx="104" ry="96" fill={url('body')} stroke="#B9C8DC" strokeWidth="2" />
            <path d="M122 86 Q 152 64 194 62" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" fill="none" />
          </g>

          <g>
            <rect x="112" y="94" width="176" height="128" rx="56" fill={url('visor')} stroke="#22336B" strokeWidth="2" />
            <path d="M134 112 Q 152 100 178 99" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.15" />
          </g>

          {/* 9 · Face on screen: eyes (blink pivot 200,150) and mouth (pivot 200,190) */}
          <g filter={url('glow')}>
            <g transform="translate(200 150)">
              <g>
                <animateTransform
                  attributeName="transform"
                  type="scale"
                  values="1 1;1 1;1 0.08;1 1"
                  keyTimes="0;0.94;0.97;1"
                  dur="4s"
                  repeatCount="indefinite"
                  begin={begin}
                />
                <g transform="translate(-200 -150)">
                  <Eyes expression={face} />
                </g>
              </g>
            </g>
            <g fill="none" stroke="#5CE1FF" strokeWidth="5" strokeLinecap="round">
              <Mouth shape={mouth} />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

function Eyes({ expression }: { expression: VexExpression }) {
  switch (expression) {
    case 'happy':
      return (
        <g fill="none" stroke="#5CE1FF" strokeWidth="6" strokeLinecap="round">
          <path d="M152 156 Q 166 138 180 156" />
          <path d="M220 156 Q 234 138 248 156" />
        </g>
      );
    case 'thinking':
      return (
        <g fill="none" stroke="#5CE1FF" strokeWidth="6" strokeLinecap="round">
          <path d="M153 152 Q 166 146 179 152" />
          <path d="M221 150 Q 234 156 247 150" />
        </g>
      );
    case 'wow':
      return (
        <g>
          <circle cx="166" cy="148" r="19" fill="#5CE1FF" />
          <circle cx="234" cy="148" r="19" fill="#5CE1FF" />
          <circle cx="172" cy="141" r="6" fill="#E9FBFF" />
          <circle cx="240" cy="141" r="6" fill="#E9FBFF" />
        </g>
      );
    case 'success':
      return (
        <g>
          <path d="M152 154 Q 166 140 180 154" fill="none" stroke="#5CE1FF" strokeWidth="6" strokeLinecap="round" />
          <path
            d="M234 164 C 216 152 218 136 228 136 C 232 136 234 139 234 142 C 234 139 236 136 240 136 C 250 136 252 152 234 164 Z"
            fill="#5CE1FF"
          />
        </g>
      );
    default:
      return (
        <g fill="#5CE1FF">
          <ellipse cx="166" cy="150" rx="12" ry="16" />
          <ellipse cx="234" cy="150" rx="12" ry="16" />
        </g>
      );
  }
}

function Mouth({ shape }: { shape: Viseme | VexExpression }) {
  switch (shape) {
    case 'happy':
      return <path d="M180 182 Q 200 204 220 182" />;
    case 'thinking':
      return <path strokeWidth="4" d="M184 190 q 8 -6 16 0 t 16 0" />;
    case 'wow':
      return <ellipse cx="200" cy="192" rx="9" ry="11" fill="#5CE1FF" stroke="none" />;
    case 'success':
      return <path d="M182 184 Q 200 200 218 184" />;
    case 'X':
      return <path d="M188 188 Q 200 194 212 188" />;
    case 'A':
      return <path d="M186 190 h 28" />;
    case 'B':
      return <rect x="186" y="186" width="28" height="7" rx="3.5" fill="#5CE1FF" stroke="none" />;
    case 'C':
      return <ellipse cx="200" cy="190" rx="14" ry="7" fill="#5CE1FF" stroke="none" />;
    case 'D':
      return <ellipse cx="200" cy="192" rx="15" ry="11" fill="#5CE1FF" stroke="none" />;
    case 'E':
      return <ellipse cx="200" cy="192" rx="10" ry="10" fill="#5CE1FF" stroke="none" />;
    case 'F':
      return <ellipse cx="200" cy="192" rx="6" ry="7" fill="#5CE1FF" stroke="none" />;
    case 'G':
      return (
        <g>
          <path d="M186 188 h 28" />
          <path d="M191 195 q 9 4 18 0" strokeWidth="3" />
        </g>
      );
    case 'H':
      return (
        <g>
          <ellipse cx="200" cy="190" rx="12" ry="8" fill="#5CE1FF" stroke="none" />
          <rect x="194" y="190" width="12" height="5" rx="2.5" fill="#2E7BFF" stroke="none" />
        </g>
      );
    default:
      return <path d="M186 186 Q 200 196 214 186" />;
  }
}
