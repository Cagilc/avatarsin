import { z } from 'zod';

/**
 * Which operations of a specification become tools. A real API can have hundreds; without a
 * filter every one of them becomes a draft tool, and the review becomes impossible.
 *
 * A rule is one of:
 *   `GET`                a method
 *   `/citas`             a path prefix, by segment: matches `/citas` and `/citas/{id}`, not `/citasx`
 *   `GET /citas`         both at once
 *   `tag:agenda`         an OpenAPI tag
 *
 * `include` keeps the operations that match at least one rule (empty = all); `exclude` then drops
 * the ones that match any rule. The filter is saved with the connector and applied again on refresh.
 */
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type Method = (typeof METHODS)[number];

const RULE = /^(?:(GET|POST|PUT|PATCH|DELETE)(?:\s+(\/\S*))?|(\/\S*)|tag:(\S+))$/i;
export const ruleSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((r) => RULE.test(r), 'regla no válida: usa un método (GET), un prefijo de ruta (/citas), ambos (GET /citas) o una etiqueta (tag:agenda)');

export const importFilterSchema = z.strictObject({
  include: z.array(ruleSchema).max(100).default([]),
  exclude: z.array(ruleSchema).max(100).default([]),
  /** Tools the connector may produce; more is an error that says how to narrow the import. */
  maxTools: z.number().int().min(1).max(500).default(200),
});
export type ImportFilter = z.infer<typeof importFilterSchema>;
export const DEFAULT_MAX_TOOLS = 200;

export interface Operation {
  method: Method;
  path: string;
  tags: readonly string[];
}

interface Rule {
  method?: Method;
  prefix?: string;
  tag?: string;
}

export function parseRule(text: string): Rule {
  const m = RULE.exec(text.trim());
  if (!m) throw new Error(`Regla de filtro no válida: "${text}".`);
  const [, method, pathAfterMethod, pathAlone, tag] = m;
  const rule: Rule = {};
  if (method) rule.method = method.toUpperCase() as Method;
  const prefix = pathAfterMethod ?? pathAlone;
  if (prefix) rule.prefix = prefix.replace(/\/+$/, '') || '/';
  if (tag) rule.tag = tag;
  return rule;
}

function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix === '/') return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function matches(op: Operation, rule: Rule): boolean {
  if (rule.method && op.method !== rule.method) return false;
  if (rule.prefix && !matchesPrefix(op.path, rule.prefix)) return false;
  if (rule.tag && !op.tags.some((t) => t.toLowerCase() === rule.tag!.toLowerCase())) return false;
  return true;
}

/** True when the filter keeps this operation. */
export function selected(op: Operation, filter: ImportFilter): boolean {
  const include = filter.include.map(parseRule);
  const exclude = filter.exclude.map(parseRule);
  if (include.length > 0 && !include.some((r) => matches(op, r))) return false;
  return !exclude.some((r) => matches(op, r));
}
