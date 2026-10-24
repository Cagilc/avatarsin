import Fastify, { type FastifyInstance } from 'fastify';
import { citasOpenApi } from './citas-openapi.ts';

export interface Cita {
  id: string;
  cliente: string;
  email: string;
  inicio: string;
  motivo: string;
  estado: 'confirmada' | 'cancelada';
}

export interface Recordatorio {
  citaId: string;
  canal: 'sms' | 'email';
  para: string;
  enviadoEn: string;
}

export interface CitasOptions {
  /** URL the OpenAPI document advertises in `servers`. */
  baseUrl: string;
  /** When set, every call needs `Authorization: Bearer <token>`. */
  token?: string;
}

const HOURS = [9, 10, 11, 12, 13];

function slotsFor(fecha: string): string[] {
  return HOURS.map((h) => `${fecha}T${String(h).padStart(2, '0')}:00:00+01:00`);
}

/** The appointments service: an in-memory third-party API Vex has no code for. */
export function createCitasApp(opts: CitasOptions): FastifyInstance & { estado: () => { citas: Cita[]; recordatorios: Recordatorio[] } } {
  const app = Fastify({ logger: false });
  const citas = new Map<string, Cita>();
  const recordatorios: Recordatorio[] = [];
  let seq = 0;

  app.addHook('onRequest', async (req, reply) => {
    if (!opts.token || req.url === '/openapi.json') return;
    if (req.headers.authorization !== `Bearer ${opts.token}`) await reply.code(401).send({ error: 'Credencial no válida' });
  });

  app.get('/openapi.json', async () => citasOpenApi(opts.baseUrl));

  app.get('/huecos', async (req, reply) => {
    const fecha = (req.query as { fecha?: string }).fecha ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return reply.code(400).send({ error: 'fecha debe ser AAAA-MM-DD' });
    const ocupados = new Set([...citas.values()].filter((c) => c.estado === 'confirmada').map((c) => c.inicio));
    return { fecha, huecos: slotsFor(fecha).filter((s) => !ocupados.has(s)) };
  });

  app.get('/citas', async (req) => {
    const email = (req.query as { email?: string }).email;
    return { citas: [...citas.values()].filter((c) => !email || c.email === email) };
  });

  app.post('/citas', async (req, reply) => {
    const b = (req.body ?? {}) as Partial<Cita>;
    if (!b.cliente || !b.email || !b.inicio || !b.motivo) return reply.code(400).send({ error: 'Faltan cliente, email, inicio o motivo' });
    const fecha = b.inicio.slice(0, 10);
    if (!slotsFor(fecha).includes(b.inicio)) return reply.code(400).send({ error: `Hora no válida; usa una de: ${slotsFor(fecha).join(', ')}` });
    if ([...citas.values()].some((c) => c.estado === 'confirmada' && c.inicio === b.inicio)) return reply.code(409).send({ error: 'Ese hueco ya está ocupado' });
    seq += 1;
    const cita: Cita = { id: `CITA-${100 + seq}`, cliente: b.cliente, email: b.email, inicio: b.inicio, motivo: b.motivo, estado: 'confirmada' };
    citas.set(cita.id, cita);
    return reply.code(201).send(cita);
  });

  app.get('/citas/:id', async (req, reply) => {
    const cita = citas.get((req.params as { id: string }).id);
    return cita ?? reply.code(404).send({ error: 'No existe esa cita' });
  });

  app.delete('/citas/:id', async (req, reply) => {
    const cita = citas.get((req.params as { id: string }).id);
    if (!cita) return reply.code(404).send({ error: 'No existe esa cita' });
    cita.estado = 'cancelada';
    return cita;
  });

  app.post('/citas/:id/recordatorio', async (req, reply) => {
    const cita = citas.get((req.params as { id: string }).id);
    if (!cita) return reply.code(404).send({ error: 'No existe esa cita' });
    const canal = ((req.body ?? {}) as { canal?: string }).canal;
    if (canal !== 'sms' && canal !== 'email') return reply.code(400).send({ error: 'canal debe ser sms o email' });
    const r: Recordatorio = { citaId: cita.id, canal, para: canal === 'email' ? cita.email : `teléfono de ${cita.cliente}`, enviadoEn: new Date().toISOString() };
    recordatorios.push(r);
    return { enviado: true, ...r };
  });

  // Not in the OpenAPI document: for tests and the demo to look inside.
  app.get('/_estado', async () => ({ citas: [...citas.values()], recordatorios }));

  return Object.assign(app, { estado: () => ({ citas: [...citas.values()], recordatorios: [...recordatorios] }) });
}
