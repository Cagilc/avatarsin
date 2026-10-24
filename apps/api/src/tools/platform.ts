import { z } from 'zod';
import { defineTool, type AnyTool } from '@vex/operator';
import type { PlatformClient } from '../platform/types.ts';

/**
 * The first six tools of the platform driver. Descriptions are what the model reads:
 * say what each one does and when to use it. Risk decides the permission flow.
 */
export function platformTools(platform: PlatformClient): AnyTool[] {
  const buscar = defineTool({
    name: 'buscar',
    description: 'Busca contactos y expedientes por nombre, email, etiqueta o referencia. Úsala antes de crear nada cuando el usuario nombra a alguien y no hay contacto abierto en pantalla.',
    driver: 'platform',
    risk: 'read',
    input: z.object({
      consulta: z.string().min(1).max(200).describe('Texto a buscar: nombre, email, etiqueta o referencia de expediente.'),
      tipo: z.enum(['contactos', 'expedientes', 'todo']).describe('Qué buscar.'),
    }),
    summarize: (i) => `Buscar "${i.consulta}" en ${i.tipo}`,
    execute: (i) => platform.buscar(i.consulta, i.tipo),
  });

  const leerExpediente = defineTool({
    name: 'leer_expediente',
    description: 'Devuelve un expediente con su contacto y sus tareas. Úsala para responder preguntas sobre un expediente o antes de actuar sobre él.',
    driver: 'platform',
    risk: 'read',
    input: z.object({ expedienteId: z.string().min(1).describe('Referencia del expediente, p. ej. EXP-2026-041.') }),
    summarize: (i) => `Leer expediente ${i.expedienteId}`,
    execute: async (i) => (await platform.obtenerExpediente(i.expedienteId)) ?? { error: `No existe el expediente ${i.expedienteId}.` },
  });

  const crearExpediente = defineTool({
    name: 'crear_expediente',
    description: 'Abre un expediente nuevo para un contacto existente. Necesita el id del contacto (búscalo si no lo tienes).',
    driver: 'platform',
    risk: 'write',
    input: z.object({
      contactoId: z.string().min(1).describe('Id del contacto, p. ej. c-001.'),
      tipo: z.string().min(1).max(60).describe('Tipo de trámite: residencia, arraigo, nacionalidad, visado, general…'),
      notas: z.string().max(2000).describe('Resumen de lo que pide el cliente.'),
    }),
    summarize: (i) => `Abrir expediente de ${i.tipo} para el contacto ${i.contactoId}`,
    execute: (i, ctx) => platform.crearExpediente(i, { id: ctx.principal.id, name: ctx.principal.name }),
  });

  const crearTarea = defineTool({
    name: 'crear_tarea',
    description: 'Crea una tarea y la asigna a un equipo (extranjeria, marketing, administracion, ventas), opcionalmente ligada a un expediente.',
    driver: 'platform',
    risk: 'write',
    input: z.object({
      titulo: z.string().min(3).max(200),
      equipo: z.enum(['extranjeria', 'marketing', 'administracion', 'ventas']),
      expedienteId: z.string().nullable().describe('Expediente al que pertenece, o null.'),
    }),
    summarize: (i) => `Crear tarea "${i.titulo}" para el equipo de ${i.equipo}${i.expedienteId ? ` (${i.expedienteId})` : ''}`,
    execute: (i, ctx) => platform.crearTarea(i, { id: ctx.principal.id, name: ctx.principal.name }),
  });

  const redactarCorreo = defineTool({
    name: 'redactar_correo',
    description: 'Redacta un borrador de correo (no lo envía). Devuelve el borrador con su id; para enviarlo usa enviar_correo.',
    driver: 'platform',
    risk: 'write',
    input: z.object({
      para: z.string().email().describe('Dirección del destinatario.'),
      proposito: z.string().min(3).max(300).describe('Qué debe conseguir el correo, p. ej. "pedir documentación para el arraigo".'),
      expedienteId: z.string().nullable(),
    }),
    summarize: (i) => `Redactar correo a ${i.para} para ${i.proposito}`,
    execute: (i, ctx) => platform.redactarCorreo(i, { id: ctx.principal.id, name: ctx.principal.name }),
  });

  const enviarCorreo = defineTool({
    name: 'enviar_correo',
    description: 'Envía un borrador redactado antes con redactar_correo. Es irreversible: el usuario tendrá que confirmarlo.',
    driver: 'platform',
    risk: 'irreversible',
    input: z.object({ borradorId: z.string().min(1).describe('Id del borrador devuelto por redactar_correo.') }),
    summarize: (i) => `Enviar el correo ${i.borradorId}`,
    // The card shows the draft as stored, not what the model says it contains.
    preview: async (i, ctx) => {
      const draft = await platform.obtenerBorrador(i.borradorId);
      if (!draft) throw new Error(`No existe el borrador ${i.borradorId}.`);
      if (draft.creadoPor !== ctx.principal.id) throw new Error('Solo quien redactó el borrador puede enviarlo.');
      return { para: draft.para, asunto: draft.asunto, cuerpo: draft.cuerpo };
    },
    execute: (i, ctx) => platform.enviarCorreo(i.borradorId, { id: ctx.principal.id, name: ctx.principal.name }),
  });

  return [buscar, leerExpediente, crearExpediente, crearTarea, redactarCorreo, enviarCorreo];
}
