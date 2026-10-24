/**
 * The platform adapter: everything the operator can do on the business platform.
 * `MockPlatform` implements it in memory for the demo; the real one calls your backend
 * over HTTP with the user's token (one method = one endpoint).
 */
export interface Contacto {
  id: string;
  nombre: string;
  email: string;
  telefono?: string;
  nacionalidad?: string;
  etiquetas: string[];
}

export interface Expediente {
  id: string;
  contactoId: string;
  tipo: string;
  estado: 'abierto' | 'en_tramite' | 'cerrado';
  notas: string;
  creadoPor: string;
  creadoEn: string;
}

export interface Tarea {
  id: string;
  titulo: string;
  equipo: string;
  expedienteId: string | null;
  estado: 'pendiente' | 'hecha';
  creadaPor: string;
  creadaEn: string;
}

export interface BorradorCorreo {
  id: string;
  para: string;
  asunto: string;
  cuerpo: string;
  expedienteId: string | null;
  creadoPor: string;
}

export interface CorreoEnviado extends BorradorCorreo {
  enviadoEn: string;
}

export interface Actor {
  id: string;
  name: string;
}

export interface PlatformClient {
  buscar(consulta: string, tipo: 'contactos' | 'expedientes' | 'todo'): Promise<{ resultados: Array<Contacto | Expediente> }>;
  obtenerExpediente(id: string): Promise<(Expediente & { contacto: Contacto | null; tareas: Tarea[] }) | null>;
  crearExpediente(input: { contactoId: string; tipo: string; notas: string }, actor: Actor): Promise<Expediente>;
  crearTarea(input: { titulo: string; equipo: string; expedienteId: string | null }, actor: Actor): Promise<Tarea>;
  redactarCorreo(input: { para: string; proposito: string; expedienteId: string | null }, actor: Actor): Promise<BorradorCorreo>;
  enviarCorreo(borradorId: string, actor: Actor): Promise<CorreoEnviado>;
  /** A draft as it would be sent; null when it does not exist. Used for the confirmation card. */
  obtenerBorrador(borradorId: string): Promise<BorradorCorreo | null>;
  /** Read models for the demo screen. */
  contactos(): Promise<Contacto[]>;
  expedientes(): Promise<Expediente[]>;
  tareas(): Promise<Tarea[]>;
  correos(): Promise<CorreoEnviado[]>;
  equipos(): Promise<string[]>;
}
