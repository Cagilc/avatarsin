// A minimal MCP server over stdio (newline-delimited JSON-RPC): a team notes board.
// It stands in for any third-party MCP server; run it with `node src/notas-mcp.ts`.
import { createInterface } from 'node:readline';

interface Nota {
  id: string;
  texto: string;
  autor: string;
  creadaEn: string;
}

const notas = new Map<string, Nota>([['N-1', { id: 'N-1', texto: 'Revisar los expedientes de arraigo pendientes', autor: 'sistema', creadaEn: '2026-10-20T09:00:00Z' }]]);
let seq = 1;

const TOOLS = [
  {
    name: 'listar_notas',
    title: 'Listar notas',
    description: 'Devuelve todas las notas del tablón del equipo.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'buscar_notas',
    title: 'Buscar notas',
    description: 'Busca notas que contengan un texto.',
    inputSchema: { type: 'object', properties: { texto: { type: 'string', minLength: 2 } }, required: ['texto'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'crear_nota',
    title: 'Crear nota',
    description: 'Añade una nota al tablón del equipo.',
    inputSchema: { type: 'object', properties: { texto: { type: 'string', minLength: 3, maxLength: 500 }, autor: { type: 'string' } }, required: ['texto'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'borrar_nota',
    title: 'Borrar nota',
    description: 'Borra una nota del tablón. No se puede deshacer.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
];

function text(value: unknown, isError = false) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

function call(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'listar_notas':
      return text({ notas: [...notas.values()] });
    case 'buscar_notas': {
      const q = String(args['texto'] ?? '').toLowerCase();
      return text({ notas: [...notas.values()].filter((n) => n.texto.toLowerCase().includes(q)) });
    }
    case 'crear_nota': {
      seq += 1;
      const nota: Nota = { id: `N-${seq}`, texto: String(args['texto']), autor: String(args['autor'] ?? 'Vex'), creadaEn: new Date().toISOString() };
      notas.set(nota.id, nota);
      return text(nota);
    }
    case 'borrar_nota': {
      const id = String(args['id']);
      if (!notas.delete(id)) return text(`No existe la nota ${id}.`, true);
      return text({ borrada: id });
    }
    default:
      return null;
  }
}

function send(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (msg.id === undefined) return; // notifications (initialized, cancelled)
  const reply = (result: unknown) => send({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize':
      reply({
        protocolVersion: (msg.params?.['protocolVersion'] as string | undefined) ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'notas', title: 'Tablón de notas del equipo', version: '0.1.0' },
      });
      return;
    case 'ping':
      reply({});
      return;
    case 'tools/list':
      reply({ tools: TOOLS });
      return;
    case 'tools/call': {
      const result = call(String(msg.params?.['name']), (msg.params?.['arguments'] as Record<string, unknown> | undefined) ?? {});
      if (!result) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Herramienta desconocida: ${String(msg.params?.['name'])}` } });
      else reply(result);
      return;
    }
    default:
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Método no soportado: ${msg.method}` } });
  }
});
