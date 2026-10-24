/**
 * A small JSON Schema validator for tool inputs: the subset that OpenAPI and MCP tools use in
 * practice (types, properties, required, enum, const, items, ranges, lengths, pattern, a few
 * formats, anyOf/oneOf/allOf, OpenAPI 3.0 `nullable`). Unknown keywords are ignored, so it is
 * lenient on exotic schemas and strict on the shape the model must respect.
 */
export type JsonSchema = Record<string, unknown>;

const FORMATS: Record<string, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const t = typeOf(value);
  if (type === 'number') return t === 'number' || t === 'integer';
  return t === type;
}

export function validateJson(schema: unknown, value: unknown, path = ''): string[] {
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [`${path || 'valor'}: no se admite`];
  if (typeof schema !== 'object' || schema === null) return [];
  const s = schema as JsonSchema;
  const at = path || 'valor';
  const errors: string[] = [];

  if (value === null && s['nullable'] === true) return [];

  const type = s['type'];
  if (type !== undefined) {
    const types = Array.isArray(type) ? (type as string[]) : [type as string];
    if (!types.some((t) => matchesType(value, t))) return [`${at}: se esperaba ${types.join(' o ')}, llegó ${typeOf(value)}`];
  }
  if ('const' in s && JSON.stringify(s['const']) !== JSON.stringify(value)) errors.push(`${at}: debe ser ${JSON.stringify(s['const'])}`);
  if (Array.isArray(s['enum']) && !(s['enum'] as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${at}: debe ser uno de ${(s['enum'] as unknown[]).map((e) => JSON.stringify(e)).join(', ')}`);
  }

  if (typeof value === 'string') {
    if (typeof s['minLength'] === 'number' && value.length < s['minLength']) errors.push(`${at}: mínimo ${s['minLength']} caracteres`);
    if (typeof s['maxLength'] === 'number' && value.length > s['maxLength']) errors.push(`${at}: máximo ${s['maxLength']} caracteres`);
    if (typeof s['pattern'] === 'string' && !new RegExp(s['pattern'], 'u').test(value)) errors.push(`${at}: no cumple el patrón ${s['pattern']}`);
    const fmt = typeof s['format'] === 'string' ? FORMATS[s['format']] : undefined;
    if (fmt && !fmt.test(value)) errors.push(`${at}: formato ${String(s['format'])} no válido`);
  }
  if (typeof value === 'number') {
    if (typeof s['minimum'] === 'number' && value < s['minimum']) errors.push(`${at}: mínimo ${s['minimum']}`);
    if (typeof s['maximum'] === 'number' && value > s['maximum']) errors.push(`${at}: máximo ${s['maximum']}`);
    if (typeof s['exclusiveMinimum'] === 'number' && value <= s['exclusiveMinimum']) errors.push(`${at}: mayor que ${s['exclusiveMinimum']}`);
    if (typeof s['exclusiveMaximum'] === 'number' && value >= s['exclusiveMaximum']) errors.push(`${at}: menor que ${s['exclusiveMaximum']}`);
  }
  if (Array.isArray(value)) {
    if (typeof s['minItems'] === 'number' && value.length < s['minItems']) errors.push(`${at}: mínimo ${s['minItems']} elementos`);
    if (typeof s['maxItems'] === 'number' && value.length > s['maxItems']) errors.push(`${at}: máximo ${s['maxItems']} elementos`);
    if (s['items'] && typeof s['items'] === 'object') value.forEach((item, i) => errors.push(...validateJson(s['items'], item, `${at}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (s['properties'] ?? {}) as Record<string, unknown>;
    for (const req of (s['required'] as string[] | undefined) ?? []) if (obj[req] === undefined) errors.push(`${path ? `${path}.` : ''}${req}: obligatorio`);
    for (const [key, v] of Object.entries(obj)) {
      const child = `${path ? `${path}.` : ''}${key}`;
      if (key in props) errors.push(...validateJson(props[key], v, child));
      else if (s['additionalProperties'] === false) errors.push(`${child}: propiedad no admitida`);
      else if (s['additionalProperties'] && typeof s['additionalProperties'] === 'object') errors.push(...validateJson(s['additionalProperties'], v, child));
    }
  }

  if (Array.isArray(s['allOf'])) for (const sub of s['allOf'] as unknown[]) errors.push(...validateJson(sub, value, path));
  for (const key of ['anyOf', 'oneOf'] as const) {
    const options = s[key];
    if (Array.isArray(options) && options.length > 0 && !options.some((sub) => validateJson(sub, value, path).length === 0)) {
      errors.push(`${at}: no encaja en ninguna de las ${options.length} formas admitidas`);
    }
  }
  return errors;
}

/**
 * Inlines local `$ref`s (`#/components/...`, `#/$defs/...`) so the model and the validator get a
 * self-contained schema. Cycles stop at `depth` and become `{}` (accept anything).
 */
export function resolveRefs(node: unknown, root: unknown, depth = 0, seen: string[] = []): unknown {
  if (Array.isArray(node)) return node.map((n) => resolveRefs(n, root, depth, seen));
  if (typeof node !== 'object' || node === null) return node;
  const obj = node as Record<string, unknown>;
  const ref = obj['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    if (depth > 8 || seen.includes(ref)) return {};
    let target: unknown = root;
    for (const part of ref.slice(2).split('/')) {
      target = typeof target === 'object' && target !== null ? (target as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
    }
    const { $ref: _ref, ...rest } = obj;
    void _ref;
    const resolved = resolveRefs(target ?? {}, root, depth + 1, [...seen, ref]);
    return Object.keys(rest).length > 0 && typeof resolved === 'object' ? { ...(resolved as object), ...(resolveRefs(rest, root, depth, seen) as object) } : resolved;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = resolveRefs(v, root, depth, seen);
  return out;
}
