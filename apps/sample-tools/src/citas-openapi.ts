/**
 * OpenAPI 3.1 description of the appointments service, as a third party would publish it.
 * Vex learns the tool from this document alone.
 */
export function citasOpenApi(baseUrl: string) {
  const cita = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      cliente: { type: 'string' },
      email: { type: 'string', format: 'email' },
      inicio: { type: 'string', format: 'date-time' },
      motivo: { type: 'string' },
      estado: { type: 'string', enum: ['confirmada', 'cancelada'] },
    },
  };
  const error = { description: 'Petición no válida', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Agenda de citas',
      version: '1.2.0',
      description: 'Agenda de citas presenciales de la oficina: huecos libres, reservas, cancelaciones y recordatorios por SMS o correo.',
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/huecos': {
        get: {
          operationId: 'listarHuecos',
          summary: 'Huecos libres de un día',
          description: 'Devuelve las horas libres (de 9:00 a 14:00, citas de una hora) para la fecha indicada.',
          parameters: [{ name: 'fecha', in: 'query', required: true, description: 'Día en formato AAAA-MM-DD', schema: { type: 'string', format: 'date' } }],
          responses: { '200': { description: 'Huecos libres' }, '400': error },
        },
      },
      '/citas': {
        get: {
          operationId: 'listarCitas',
          summary: 'Citas de un cliente',
          parameters: [{ name: 'email', in: 'query', required: false, description: 'Filtra por email del cliente', schema: { type: 'string' } }],
          responses: { '200': { description: 'Citas' } },
        },
        post: {
          operationId: 'crearCita',
          summary: 'Reservar una cita',
          description: 'Reserva un hueco libre. La hora debe ser una de las que devuelve listarHuecos.',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NuevaCita' } } } },
          responses: { '201': { description: 'Cita creada', content: { 'application/json': { schema: cita } } }, '409': error },
        },
      },
      '/citas/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { operationId: 'obtenerCita', summary: 'Detalle de una cita', responses: { '200': { description: 'Cita' }, '404': error } },
        delete: { operationId: 'cancelarCita', summary: 'Cancelar una cita', responses: { '200': { description: 'Cita cancelada' }, '404': error } },
      },
      '/citas/{id}/recordatorio': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        post: {
          operationId: 'enviarRecordatorio',
          summary: 'Enviar un recordatorio al cliente',
          description: 'Envía al cliente un SMS o un correo con la fecha y hora de su cita.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['canal'], properties: { canal: { type: 'string', enum: ['sms', 'email'] } }, additionalProperties: false } } },
          },
          responses: { '200': { description: 'Recordatorio enviado' }, '404': error },
        },
      },
    },
    components: {
      schemas: {
        NuevaCita: {
          type: 'object',
          required: ['cliente', 'email', 'inicio', 'motivo'],
          additionalProperties: false,
          properties: {
            cliente: { type: 'string', minLength: 2, description: 'Nombre y apellidos' },
            email: { type: 'string', format: 'email' },
            inicio: { type: 'string', format: 'date-time', description: 'Hora de inicio, p. ej. 2026-10-27T10:00:00+01:00' },
            motivo: { type: 'string', maxLength: 200 },
          },
        },
        Error: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  };
}
