import type { Actor, BorradorCorreo, Contacto, CorreoEnviado, Expediente, PlatformClient, Tarea } from './types.ts';

const EQUIPOS = ['extranjeria', 'marketing', 'administracion', 'ventas'];

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** In-memory platform with seed data so the demo can be driven end to end without a backend. */
export class MockPlatform implements PlatformClient {
  private readonly contactosById = new Map<string, Contacto>();
  private readonly expedientesById = new Map<string, Expediente>();
  private readonly tareasById = new Map<string, Tarea>();
  private readonly borradores = new Map<string, BorradorCorreo>();
  private readonly enviados: CorreoEnviado[] = [];
  private seq = 100;
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
    const seedContactos: Contacto[] = [
      { id: 'c-001', nombre: 'Laura Pérez', email: 'laura.perez@ejemplo.es', telefono: '+34 600 111 222', nacionalidad: 'Colombia', etiquetas: ['residencia', 'lead-web'] },
      { id: 'c-002', nombre: 'Marco Rossi', email: 'marco.rossi@ejemplo.it', telefono: '+39 333 444 555', nacionalidad: 'Italia', etiquetas: ['autonomo'] },
      { id: 'c-003', nombre: 'Aisha Rahman', email: 'aisha.rahman@ejemplo.com', nacionalidad: 'Bangladés', etiquetas: ['arraigo'] },
      { id: 'c-004', nombre: 'Daniel Okafor', email: 'daniel.okafor@ejemplo.com', nacionalidad: 'Nigeria', etiquetas: ['nacionalidad', 'cliente'] },
    ];
    for (const c of seedContactos) this.contactosById.set(c.id, c);
    const e1: Expediente = { id: 'EXP-2026-041', contactoId: 'c-004', tipo: 'nacionalidad', estado: 'en_tramite', notas: 'Pendiente de certificado de antecedentes.', creadoPor: 'sistema', creadoEn: '2026-09-02T09:00:00.000Z' };
    this.expedientesById.set(e1.id, e1);
    const t1: Tarea = { id: 'T-900', titulo: 'Revisar antecedentes penales', equipo: 'extranjeria', expedienteId: e1.id, estado: 'pendiente', creadaPor: 'sistema', creadaEn: '2026-09-03T09:00:00.000Z' };
    this.tareasById.set(t1.id, t1);
  }

  /** Seeding for tests and evals; not part of PlatformClient. */
  agregarContacto(contacto: Contacto): void {
    this.contactosById.set(contacto.id, contacto);
  }

  /** Seeding for tests and evals; not part of PlatformClient. */
  editarContacto(id: string, patch: Partial<Omit<Contacto, 'id'>>): void {
    const c = this.contactosById.get(id);
    if (c) this.contactosById.set(id, { ...c, ...patch });
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async buscar(consulta: string, tipo: 'contactos' | 'expedientes' | 'todo') {
    const q = normalize(consulta);
    const words = q.split(/\s+/).filter(Boolean);
    const matches = (hay: string) => words.length > 0 && words.every((w) => normalize(hay).includes(w));
    const resultados: Array<Contacto | Expediente> = [];
    if (tipo !== 'expedientes') {
      for (const c of this.contactosById.values()) {
        if (matches(`${c.nombre} ${c.email} ${c.etiquetas.join(' ')}`)) resultados.push(c);
      }
    }
    if (tipo !== 'contactos') {
      for (const e of this.expedientesById.values()) {
        const c = this.contactosById.get(e.contactoId);
        if (matches(`${e.id} ${e.tipo} ${e.notas} ${c?.nombre ?? ''}`)) resultados.push(e);
      }
    }
    return { resultados };
  }

  async obtenerExpediente(id: string) {
    const e = this.expedientesById.get(id);
    if (!e) return null;
    return { ...e, contacto: this.contactosById.get(e.contactoId) ?? null, tareas: [...this.tareasById.values()].filter((t) => t.expedienteId === id) };
  }

  async crearExpediente(input: { contactoId: string; tipo: string; notas: string }, actor: Actor) {
    if (!this.contactosById.has(input.contactoId)) throw new Error(`No existe el contacto ${input.contactoId}.`);
    const year = this.now().getUTCFullYear();
    const e: Expediente = { id: this.nextId(`EXP-${year}`), contactoId: input.contactoId, tipo: input.tipo, estado: 'abierto', notas: input.notas, creadoPor: actor.id, creadoEn: this.now().toISOString() };
    this.expedientesById.set(e.id, e);
    return e;
  }

  async crearTarea(input: { titulo: string; equipo: string; expedienteId: string | null }, actor: Actor) {
    if (!EQUIPOS.includes(input.equipo)) throw new Error(`Equipo desconocido: ${input.equipo}. Equipos: ${EQUIPOS.join(', ')}.`);
    if (input.expedienteId && !this.expedientesById.has(input.expedienteId)) throw new Error(`No existe el expediente ${input.expedienteId}.`);
    const t: Tarea = { id: this.nextId('T'), titulo: input.titulo, equipo: input.equipo, expedienteId: input.expedienteId, estado: 'pendiente', creadaPor: actor.id, creadaEn: this.now().toISOString() };
    this.tareasById.set(t.id, t);
    return t;
  }

  async redactarCorreo(input: { para: string; proposito: string; expedienteId: string | null }, actor: Actor) {
    const contacto = [...this.contactosById.values()].find((c) => c.email === input.para);
    const nombre = contacto?.nombre.split(' ')[0] ?? 'Hola';
    const ref = input.expedienteId ? ` (expediente ${input.expedienteId})` : '';
    const asunto = `${input.proposito.charAt(0).toUpperCase()}${input.proposito.slice(1)}${ref}`;
    const cuerpo = `Hola ${nombre},\n\nTe escribo para ${input.proposito}${ref}. Cuando puedas, respóndeme a este correo y seguimos.\n\nUn saludo,\n${actor.name}`;
    const b: BorradorCorreo = { id: this.nextId('B'), para: input.para, asunto, cuerpo, expedienteId: input.expedienteId, creadoPor: actor.id };
    this.borradores.set(b.id, b);
    return b;
  }

  async enviarCorreo(borradorId: string, actor: Actor) {
    const b = this.borradores.get(borradorId);
    if (!b) throw new Error(`No existe el borrador ${borradorId}.`);
    if (b.creadoPor !== actor.id) throw new Error('Solo quien redactó el borrador puede enviarlo.');
    this.borradores.delete(borradorId);
    const sent: CorreoEnviado = { ...b, enviadoEn: this.now().toISOString() };
    this.enviados.push(sent);
    return sent;
  }

  async obtenerBorrador(borradorId: string) {
    return this.borradores.get(borradorId) ?? null;
  }

  async contactos() {
    return [...this.contactosById.values()];
  }
  async expedientes() {
    return [...this.expedientesById.values()];
  }
  async tareas() {
    return [...this.tareasById.values()];
  }
  async correos() {
    return [...this.enviados];
  }
  async equipos() {
    return [...EQUIPOS];
  }
}
