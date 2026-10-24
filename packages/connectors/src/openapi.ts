import { fingerprintOf, toolNameFor, type ConnectorAuth, type ConnectorManifest, type ConnectorTool } from './manifest.ts';
import { resolveRefs, type JsonSchema } from './jsonSchema.ts';
import { suggestHttpRisk } from './risk.ts';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const MAX_DESCRIPTION = 900;

export interface OpenApiImportOptions {
  id: string;
  name?: string;
  /** Overrides `servers[0].url` (or supplies it when the spec has none). */
  baseUrl?: string;
  sourceUrl?: string;
  auth?: ConnectorAuth;
  now?: () => Date;
}

interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

function asObject(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Header params that carry auth are handled by the connector's auth, not by the model. */
const AUTH_HEADER = /^(authorization|x-api-key|api-key|cookie)$/i;

/**
 * Turns an OpenAPI 3.x document (JSON) into a connector draft: one tool per operation, input
 * schema = path/query params + `body`, a suggested risk with its reason, and nothing enabled.
 */
export function importOpenApi(spec: unknown, opts: OpenApiImportOptions): ConnectorManifest {
  const doc = asObject(spec);
  const version = String(doc['openapi'] ?? '');
  if (!version.startsWith('3.')) throw new Error(`Solo se admite OpenAPI 3.x en JSON (llegó "${version || 'sin versión'}").`);
  const info = asObject(doc['info']);
  const servers = Array.isArray(doc['servers']) ? (doc['servers'] as unknown[]) : [];
  const serverUrl = typeof asObject(servers[0])['url'] === 'string' ? String(asObject(servers[0])['url']) : undefined;
  const baseUrl = opts.baseUrl ?? (serverUrl && /^https?:\/\//.test(serverUrl) ? serverUrl : undefined);
  if (!baseUrl) throw new Error('La especificación no trae una URL absoluta en "servers"; indica la URL base.');

  const taken = new Set<string>();
  const tools: ConnectorTool[] = [];
  const paths = asObject(doc['paths']);
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = asObject(resolveRefs(rawItem, doc));
    const shared = Array.isArray(item['parameters']) ? (item['parameters'] as Parameter[]) : [];
    for (const method of METHODS) {
      const op = asObject(item[method]);
      if (Object.keys(op).length === 0) continue;
      const opParams = Array.isArray(op['parameters']) ? (op['parameters'] as Parameter[]) : [];
      const byKey = new Map<string, Parameter>();
      for (const p of [...shared, ...opParams].map((x) => resolveRefs(x, doc) as Parameter)) byKey.set(`${p.in}:${p.name}`, p);
      const params = [...byKey.values()].filter((p) => p.in === 'path' || p.in === 'query' || (p.in === 'header' && !AUTH_HEADER.test(p.name)));

      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const p of params) {
        const schema = { ...(asObject(p.schema) as JsonSchema), ...(p.description ? { description: p.description } : {}) };
        properties[p.name] = schema;
        if (p.required || p.in === 'path') required.push(p.name);
      }
      const content = asObject(asObject(resolveRefs(op['requestBody'], doc))['content']);
      const json = asObject(content['application/json']);
      const hasBody = Object.keys(json).length > 0;
      if (hasBody) {
        properties['body'] = resolveRefs(json['schema'] ?? {}, doc);
        if (asObject(op['requestBody'])['required'] === true) required.push('body');
      }

      const operationId = typeof op['operationId'] === 'string' ? op['operationId'] : `${method} ${path}`;
      const summary = typeof op['summary'] === 'string' ? op['summary'] : '';
      const longText = typeof op['description'] === 'string' ? op['description'] : '';
      const description = [summary, longText].filter(Boolean).join('. ').slice(0, MAX_DESCRIPTION) || `${method.toUpperCase()} ${path}`;
      const binding = {
        kind: 'http' as const,
        method: method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path,
        pathParams: params.filter((p) => p.in === 'path').map((p) => p.name),
        queryParams: params.filter((p) => p.in === 'query').map((p) => p.name),
        body: hasBody,
      };
      const inputSchema: JsonSchema = { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
      const suggestion = suggestHttpRisk(method, path, operationId, summary);
      tools.push({
        name: toolNameFor(opts.id, operationId, taken),
        description,
        inputSchema,
        binding,
        suggestedRisk: suggestion.risk,
        riskReason: suggestion.reason,
        risk: null,
        enabled: false,
        review: null,
        fingerprint: fingerprintOf({ binding, inputSchema, description }),
      });
    }
  }
  if (tools.length === 0) throw new Error('La especificación no tiene operaciones.');

  const now = (opts.now ?? (() => new Date()))().toISOString();
  const title = typeof info['title'] === 'string' ? info['title'] : opts.id;
  return {
    id: opts.id,
    name: opts.name ?? title,
    description: (typeof info['description'] === 'string' ? info['description'] : '').slice(0, 500),
    source: { kind: 'openapi', ...(opts.sourceUrl ? { url: opts.sourceUrl } : {}), title, ...(typeof info['version'] === 'string' ? { version: info['version'] } : {}) },
    baseUrl,
    auth: opts.auth ?? { kind: 'none' },
    guide: '',
    tools,
    importedAt: now,
    updatedAt: now,
  };
}
