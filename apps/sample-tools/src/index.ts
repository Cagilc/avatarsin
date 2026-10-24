import { fileURLToPath } from 'node:url';

export { createCitasApp, type Cita, type CitasOptions, type Recordatorio } from './citas.ts';
export { citasOpenApi } from './citas-openapi.ts';

/** Absolute path of the notes MCP server script, to start it with `node <path>`. */
export const NOTAS_MCP_SCRIPT = fileURLToPath(new URL('./notas-mcp.ts', import.meta.url));
