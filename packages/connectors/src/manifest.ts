import { z } from 'zod';
import { riskSchema, toolNameSchema } from '@vex/operator';
import { importFilterSchema } from './filter.ts';

/** Where a connector came from; enough to import it again (refresh). */
export const sourceSchema = z.discriminatedUnion('kind', [
  /** `operations`: how many the specification had, filtered or not, so the review shows "12 de 700". */
  z.object({ kind: z.literal('openapi'), url: z.string().url().optional(), title: z.string().optional(), version: z.string().optional(), operations: z.number().int().nonnegative().optional() }),
  z.object({ kind: z.literal('mcp-stdio'), command: z.string().min(1), args: z.array(z.string()) }),
  z.object({ kind: z.literal('mcp-http'), url: z.string().url() }),
]);
export type ConnectorSource = z.infer<typeof sourceSchema>;

/**
 * How Vex authenticates against the tool. Only the NAME of the environment variable is stored:
 * secrets never live in the manifest, the database or the conversation.
 */
export const authSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('bearer'), env: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }),
  z.object({ kind: z.literal('header'), name: z.string().min(1), env: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }),
]);
export type ConnectorAuth = z.infer<typeof authSchema>;

export const httpBindingSchema = z.object({
  kind: z.literal('http'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** OpenAPI path template, e.g. /citas/{id}. */
  path: z.string().startsWith('/'),
  pathParams: z.array(z.string()),
  queryParams: z.array(z.string()),
  /** The input has a `body` property sent as JSON. */
  body: z.boolean(),
});

export const mcpBindingSchema = z.object({
  kind: z.literal('mcp'),
  /** Name of the tool on the MCP server. */
  tool: z.string().min(1),
});

export const bindingSchema = z.discriminatedUnion('kind', [httpBindingSchema, mcpBindingSchema]);
export type Binding = z.infer<typeof bindingSchema>;

export const reviewSchema = z.object({
  by: z.string().min(1),
  at: z.string().datetime(),
  /** Required when the person chose a lower risk than the suggested one. */
  lowerRiskReason: z.string().min(1).optional(),
});

/**
 * How to see that a write took effect: a read tool of the same connector, with its parameters taken
 * from the write's response (`$.id`), from the write's input (`$input.id`) or written literally.
 * The importer suggests one when the paths make it obvious; the review can change or clear it.
 */
export const verifySchema = z.object({
  tool: toolNameSchema,
  params: z.record(z.string(), z.string()).default({}),
  /** What confirms the effect: the read finds it (default) or says it is gone (after a delete). */
  expect: z.enum(['exists', 'missing']).default('exists'),
  /** Registered page element (data-vex-id) the avatar points at when the effect shows. */
  target: z.string().min(1).max(80).optional(),
});
export type VerifySpec = z.infer<typeof verifySchema>;

export const connectorToolSchema = z.object({
  /** Name the model sees: `<connector>_<operation>`. */
  name: toolNameSchema,
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  binding: bindingSchema,
  /** What the importer thinks, and why. */
  suggestedRisk: riskSchema,
  riskReason: z.string(),
  /** What a person decided. Null until reviewed: an unreviewed tool can never be enabled. */
  risk: riskSchema.nullable(),
  enabled: z.boolean(),
  review: reviewSchema.nullable(),
  /** Changes when the tool's contract changes; a changed tool needs a new review. */
  fingerprint: z.string(),
  /** Not part of the contract: a changed verification does not reset the review. */
  verify: verifySchema.nullable().optional(),
});
export type ConnectorTool = z.infer<typeof connectorToolSchema>;

export const connectorManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9]{1,23}$/, 'id: minúsculas y dígitos, empieza por letra, máx. 24'),
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  source: sourceSchema,
  /** Base URL for HTTP tools. */
  baseUrl: z.string().url().optional(),
  auth: authSchema,
  /** Which operations become tools (OpenAPI only). Saved so a refresh applies the same choice. */
  filter: importFilterSchema.optional(),
  /**
   * Short guide for the model: what the tool is for, typical flows, traps. Loaded only when a
   * request needs this connector (tool `leer_guia`), so it does not grow the prompt.
   */
  guide: z.string().max(4000),
  tools: z.array(connectorToolSchema),
  importedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;

/** Small, stable, isomorphic hash (FNV-1a 32-bit) for fingerprints. */
export function fingerprintOf(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** snake_case from camelCase, paths and free text; ASCII only. */
export function snake(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toLowerCase();
}

/** `<connector>_<op>`, unique within `taken`, within the 64-character tool name limit. */
export function toolNameFor(connectorId: string, op: string, taken: Set<string>): string {
  const base = `${connectorId}_${snake(op) || 'op'}`.slice(0, 60).replace(/_+$/, '');
  let name = /^[a-z]/.test(base) ? base : `t_${base}`.slice(0, 60);
  let n = 2;
  while (taken.has(name)) {
    name = `${base.slice(0, 57)}_${n}`;
    n += 1;
  }
  taken.add(name);
  return name;
}
