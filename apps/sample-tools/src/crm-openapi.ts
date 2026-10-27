/** OpenAPI 3.1 description of the CRM service (contacts, notes, tasks), as a third party would publish it. */
export function crmOpenApi(baseUrl: string) {
  const error = { description: 'Petición no válida', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  const id = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string' } });
  return {
    openapi: '3.1.0',
    info: {
      title: 'CRM de clientes',
      version: '1.0.0',
      description: 'Contactos de la empresa con sus notas y tareas de seguimiento.',
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/contactos': {
        get: {
          operationId: 'buscarContactos',
          summary: 'Buscar contactos',
          parameters: [{ name: 'q', in: 'query', required: false, description: 'Texto a buscar en nombre, email, empresa y etiquetas', schema: { type: 'string' } }],
          responses: { '200': { description: 'Contactos' } },
        },
        post: {
          operationId: 'crearContacto',
          summary: 'Crear un contacto',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NuevoContacto' } } } },
          responses: { '201': { description: 'Contacto creado' }, '400': error, '409': error },
        },
      },
      '/contactos/{id}': {
        parameters: [id('id')],
        get: { operationId: 'obtenerContacto', summary: 'Ficha de un contacto', responses: { '200': { description: 'Contacto' }, '404': error } },
        delete: { operationId: 'borrarContacto', summary: 'Borrar un contacto con sus notas y tareas', description: 'No se puede deshacer.', responses: { '200': { description: 'Borrado' }, '404': error } },
      },
      '/contactos/{id}/notas': {
        parameters: [id('id')],
        get: { operationId: 'listarNotas', summary: 'Notas de un contacto', responses: { '200': { description: 'Notas' }, '404': error } },
        post: {
          operationId: 'anadirNota',
          summary: 'Añadir una nota a un contacto',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['texto'], additionalProperties: false, properties: { texto: { type: 'string', maxLength: 2000 }, autor: { type: 'string' } } } } } },
          responses: { '201': { description: 'Nota añadida' }, '400': error, '404': error },
        },
      },
      '/tareas': {
        get: {
          operationId: 'listarTareas',
          summary: 'Tareas de seguimiento',
          parameters: [{ name: 'contactoId', in: 'query', required: false, schema: { type: 'string' } }],
          responses: { '200': { description: 'Tareas' } },
        },
        post: {
          operationId: 'crearTarea',
          summary: 'Crear una tarea de seguimiento',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NuevaTarea' } } } },
          responses: { '201': { description: 'Tarea creada' }, '400': error },
        },
      },
      '/tareas/{id}': {
        parameters: [id('id')],
        get: { operationId: 'obtenerTarea', summary: 'Detalle de una tarea', responses: { '200': { description: 'Tarea' }, '404': error } },
        patch: {
          operationId: 'actualizarTarea',
          summary: 'Cambiar una tarea (cerrarla, retitularla, moverla)',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { estado: { type: 'string', enum: ['pendiente', 'hecha'] }, titulo: { type: 'string' }, vence: { type: 'string', format: 'date' } } } } } },
          responses: { '200': { description: 'Tarea actualizada' }, '400': error, '404': error },
        },
      },
    },
    components: {
      schemas: {
        NuevoContacto: {
          type: 'object',
          required: ['nombre', 'email'],
          additionalProperties: false,
          properties: { nombre: { type: 'string', minLength: 2 }, email: { type: 'string', format: 'email' }, empresa: { type: 'string' }, etiquetas: { type: 'array', items: { type: 'string' } } },
        },
        NuevaTarea: {
          type: 'object',
          required: ['contactoId', 'titulo', 'vence'],
          additionalProperties: false,
          properties: { contactoId: { type: 'string', description: 'Id del contacto, p. ej. C-001' }, titulo: { type: 'string', minLength: 3 }, vence: { type: 'string', format: 'date', description: 'AAAA-MM-DD' } },
        },
        Error: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  };
}
