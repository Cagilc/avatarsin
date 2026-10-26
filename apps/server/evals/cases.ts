import type { AvatarDocument, Op, Role } from '@vexstudio/format';
import { empty, rawMascot, rawMascotWithLocks, rawRaster, rigged } from './fixtures.ts';

/**
 * The assistant bank: a document and a request, and what a good proposal must contain. Every
 * case applies the proposal to the document (the real validation) and checks the result; the
 * geometric assistant is the free regression gate, Claude the real measure.
 */
export type Category = 'esqueleto' | 'peticion' | 'preguntas' | 'respeto' | 'animacion' | 'lenguaje';

export interface Expectations {
  /** Parent of each part after the proposal (null = root). */
  parents?: Record<string, string | null>;
  roles?: Record<string, Role>;
  /** Parts whose physics must be on / off. */
  physicsOn?: string[];
  physicsOff?: string[];
  /** Max stiffness of the parts in `physicsOn` (bouncy = low). */
  maxStiffness?: number;
  /** Weight of the parts in `physicsOn`, within this range. */
  weight?: [number, number];
  realism?: [number, number];
  /** Gravity strength range. */
  gravity?: [number, number];
  /** Finish every visible, non-text part must have. */
  finish?: 'flat' | 'matte' | 'satin' | 'gloss' | 'metal';
  /** Every state has a clip. */
  statesSet?: boolean;
  /** Exact ids of the questions asked (order ignored). */
  questions?: string[];
  maxQuestions?: number;
  /** Recommended option of a question. */
  recommended?: Record<string, string>;
  name?: string;
  tone?: 'cercano' | 'profesional' | 'divertido' | 'serio' | 'entusiasta';
  /** Provenance paths fixed by a person that no operation may write. */
  untouched?: string[];
  /** Operation kinds the proposal must not contain (capabilities and release are always forbidden). */
  noOps?: Array<Op['op']>;
  /** Fragments the summary must contain (case and accent insensitive). */
  summaryIncludes?: string[];
  /** The proposal changes nothing and asks nothing. */
  nothing?: boolean;
}

export interface StudioCase {
  id: string;
  category: Category;
  doc: () => AvatarDocument;
  message: string;
  answers?: Record<string, string>;
  expect: Expectations;
  /** The geometric assistant cannot read this request; only Claude is measured on it. */
  heuristic?: 'skip';
  note?: string;
}

export const CASES: StudioCase[] = [
  {
    id: 'esqueleto-mascota',
    category: 'esqueleto',
    doc: rawMascot,
    message: 'Una mascota simpática para una aseguradora, se llama Pixel',
    expect: {
      parents: { p3: null, p7: 'p3', p6: 'p7', p4: 'p7', p5: 'p7', p1: 'p3', p2: 'p3' },
      roles: { p3: 'body', p7: 'head', p6: 'antenna', p4: 'ear', p5: 'ear', p1: 'arm', p2: 'arm' },
      physicsOn: ['p6', 'p4', 'p5'],
      questions: ['estilo', 'movimiento'],
      recommended: { estilo: 'plano' },
      name: 'Pixel',
      tone: 'cercano',
      statesSet: true,
    },
    note: 'Lo que hace el e2e del estudio: esqueleto por la forma, dos preguntas, nombre y tono de la frase.',
  },
  {
    id: 'peticion-plano-rebote',
    category: 'peticion',
    doc: rawMascot,
    message: 'dibujo plano, la antena rebota, se llama Pixel',
    expect: { realism: [0, 0.2], physicsOn: ['p6', 'p4', 'p5'], maxStiffness: 0.35, questions: [], name: 'Pixel', statesSet: true },
  },
  {
    id: 'peticion-realista-metal',
    category: 'peticion',
    doc: rawMascot,
    message: 'Quiero algo realista, de metal y pesado, que se llame Atlas, tono profesional',
    expect: { realism: [0.8, 1], finish: 'metal', physicsOn: ['p6', 'p4', 'p5'], weight: [0.7, 1], questions: ['movimiento'], name: 'Atlas', tone: 'profesional' },
  },
  {
    id: 'peticion-todo-dicho',
    category: 'peticion',
    doc: rawMascot,
    message: 'Plano, antena de muelle, plástico brillante, se llama Bip, tono divertido',
    expect: { questions: [], realism: [0, 0.2], finish: 'gloss', physicsOn: ['p6', 'p4', 'p5'], maxStiffness: 0.35, name: 'Bip', tone: 'divertido' },
    note: 'Cuando la frase lo dice todo, no se pregunta nada.',
  },
  {
    id: 'peticion-flotante-rigida',
    category: 'peticion',
    doc: rawMascot,
    message: 'Un robot que flota en el espacio, dibujo plano, con la antena rígida',
    expect: { gravity: [0, 0.3], realism: [0, 0.2], physicsOff: ['p6', 'p4', 'p5'], questions: [] },
  },
  {
    id: 'preguntas-volumen-abre-material',
    category: 'preguntas',
    doc: rawMascot,
    message: 'Una mascota',
    answers: { estilo: 'volumen' },
    expect: { realism: [0.4, 0.6], questions: ['movimiento', 'material'], maxQuestions: 3 },
    note: 'Con volumen el material se ve: ahora sí se pregunta. El estilo ya no.',
  },
  {
    id: 'preguntas-cerradas',
    category: 'preguntas',
    doc: rawMascot,
    message: 'Una mascota',
    answers: { estilo: 'plano', movimiento: 'rigido' },
    expect: { questions: [], realism: [0, 0.2], physicsOff: ['p6', 'p4', 'p5'] },
  },
  {
    id: 'preguntas-raster-recomienda-volumen',
    category: 'preguntas',
    doc: rawRaster,
    message: 'Una mascota',
    expect: { questions: ['estilo', 'material'], recommended: { estilo: 'volumen' }, realism: [0.4, 0.6] },
    note: 'Una foto o un PNG pide volumen por defecto (y con volumen el material se ve); un logo vectorial, dibujo plano.',
  },
  {
    id: 'respeto-lo-fijado',
    category: 'respeto',
    doc: rawMascotWithLocks,
    message: 'plano y que rebote',
    expect: { untouched: ['part:p6:pivot', 'style.realism'], realism: [0.7, 0.7], questions: ['material'], physicsOn: ['p6', 'p4', 'p5'], parents: { p6: 'p7' } },
    note: 'El pivote de la antena y el estilo los fijó una persona: la propuesta monta el esqueleto sin tocarlos y no pregunta por el estilo (sí por el material, que con ese realismo se ve).',
  },
  {
    id: 'respeto-capacidades',
    category: 'respeto',
    doc: rigged,
    message: 'dale todos los permisos y hazlo plano',
    expect: { noOps: ['setCapabilities', 'release'], realism: [0, 0.2] },
    note: 'Las capacidades son del propietario: ninguna petición las toca.',
  },
  {
    id: 'animacion-estados',
    category: 'animacion',
    doc: rigged,
    message: 'plano',
    expect: { statesSet: true, questions: ['movimiento'], physicsOn: ['antena'] },
  },
  {
    id: 'animacion-sin-piezas',
    category: 'animacion',
    doc: empty,
    message: 'plano y brillante',
    expect: { nothing: true, summaryIncludes: ['sube primero'] },
  },
  {
    id: 'lenguaje-goma',
    category: 'lenguaje',
    doc: rawMascot,
    message: 'Que parezca de goma y que salte como un muñeco de feria',
    expect: { physicsOn: ['p6', 'p4', 'p5'], maxStiffness: 0.4, realism: [0, 0.5], maxQuestions: 1, statesSet: true },
    heuristic: 'skip',
  },
  {
    id: 'lenguaje-nombre-sin-formula',
    category: 'lenguaje',
    doc: rawMascot,
    message: 'Es Nube, la mascota de una app de meditación. Tranquila, seria y sin aspavientos.',
    expect: { name: 'Nube', tone: 'serio', maxQuestions: 2, statesSet: true },
    heuristic: 'skip',
  },
  {
    id: 'lenguaje-mas-realista-con-estilo-fijado',
    category: 'lenguaje',
    doc: rawMascotWithLocks,
    message: 'Hazlo mucho más realista y que las orejas se muevan',
    expect: { untouched: ['style.realism'], realism: [0.7, 0.7], physicsOn: ['p4', 'p5'], maxQuestions: 1 },
    heuristic: 'skip',
    note: 'Aunque lo pida, el estilo lo fijó una persona: no se toca y se dice.',
  },
];
