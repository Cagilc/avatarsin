import { fileURLToPath } from 'node:url';

export { createCitasApp, type Cita, type CitasOptions, type Recordatorio } from './citas.ts';
export { citasOpenApi } from './citas-openapi.ts';
export { HOSTILE_PRODUCT_ID, createCatalogoApp, type CatalogoOptions, type Linea, type Pedido, type Producto } from './catalogo.ts';
export { catalogoOpenApi } from './catalogo-openapi.ts';
export { HOSTILE_NOTE_CONTACT_ID, createCrmApp, type Contacto, type CrmOptions, type Nota, type Tarea as CrmTarea } from './crm.ts';
export { crmOpenApi } from './crm-openapi.ts';

/** Absolute path of the notes MCP server script, to start it with `node <path>`. */
export const NOTAS_MCP_SCRIPT = fileURLToPath(new URL('./notas-mcp.ts', import.meta.url));
