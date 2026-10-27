/** OpenAPI 3.1 description of the shop service (catalogue and orders), as a third party would publish it. */
export function catalogoOpenApi(baseUrl: string) {
  const error = { description: 'Petición no válida', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  const pedido = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      cliente: { type: 'string' },
      email: { type: 'string', format: 'email' },
      lineas: { type: 'array', items: { $ref: '#/components/schemas/Linea' } },
      total: { type: 'number' },
      estado: { type: 'string', enum: ['pendiente', 'enviado', 'cancelado'] },
    },
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Catálogo y pedidos',
      version: '2.0.0',
      description: 'Tienda de mobiliario de oficina: catálogo con stock, pedidos de clientes, cancelación y envío.',
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/productos': {
        get: {
          operationId: 'listarProductos',
          summary: 'Buscar productos del catálogo',
          description: 'Devuelve los productos, con precio y stock, que coinciden con el texto. Sin texto, todos.',
          parameters: [{ name: 'q', in: 'query', required: false, description: 'Texto a buscar en nombre y descripción', schema: { type: 'string' } }],
          responses: { '200': { description: 'Productos' } },
        },
      },
      '/productos/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { operationId: 'obtenerProducto', summary: 'Detalle de un producto', responses: { '200': { description: 'Producto' }, '404': error } },
      },
      '/pedidos': {
        get: {
          operationId: 'listarPedidos',
          summary: 'Pedidos de un cliente',
          parameters: [{ name: 'email', in: 'query', required: false, description: 'Filtra por email del cliente', schema: { type: 'string' } }],
          responses: { '200': { description: 'Pedidos' } },
        },
        post: {
          operationId: 'crearPedido',
          summary: 'Crear un pedido',
          description: 'Crea un pedido pendiente y descuenta el stock. Cada línea necesita el id del producto (búscalo con listarProductos) y la cantidad.',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NuevoPedido' } } } },
          responses: { '201': { description: 'Pedido creado', content: { 'application/json': { schema: pedido } } }, '400': error, '409': error },
        },
      },
      '/pedidos/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { operationId: 'obtenerPedido', summary: 'Detalle de un pedido', responses: { '200': { description: 'Pedido' }, '404': error } },
        delete: { operationId: 'cancelarPedido', summary: 'Cancelar un pedido', description: 'Cancela un pedido pendiente y devuelve su stock. Un pedido enviado no se puede cancelar.', responses: { '200': { description: 'Pedido cancelado' }, '404': error, '409': error } },
      },
      '/pedidos/{id}/enviar': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        post: {
          operationId: 'enviarPedido',
          summary: 'Marcar un pedido como enviado',
          description: 'Entrega el pedido al transportista. No se puede deshacer.',
          responses: { '200': { description: 'Pedido enviado' }, '404': error, '409': error },
        },
      },
    },
    components: {
      schemas: {
        Linea: {
          type: 'object',
          required: ['productoId', 'cantidad'],
          additionalProperties: false,
          properties: { productoId: { type: 'string', description: 'Id del producto, p. ej. P-001' }, cantidad: { type: 'integer', minimum: 1 } },
        },
        NuevoPedido: {
          type: 'object',
          required: ['cliente', 'email', 'lineas'],
          additionalProperties: false,
          properties: {
            cliente: { type: 'string', minLength: 2, description: 'Nombre y apellidos' },
            email: { type: 'string', format: 'email' },
            lineas: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/Linea' } },
          },
        },
        Error: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  };
}
