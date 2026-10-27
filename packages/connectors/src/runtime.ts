import { z } from 'zod';
import { defineTool, type AnyTool, type Risk, type ToolContext, type VerifyRead } from '@vex/operator';
import { validateJson } from './jsonSchema.ts';
import type { ConnectorManifest, ConnectorTool, VerifyExpect } from './manifest.ts';
import { contentToText, type McpClient } from './mcp/client.ts';
import { liveTools } from './review.ts';

export interface RuntimeDeps {
  /** Environment holding the secrets named by the manifest's auth. */
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Lazily opened MCP connection for an MCP connector. */
  mcp?: (manifest: ConnectorManifest) => Promise<McpClient>;
  /** Per-call timeout for HTTP tools. */
  timeoutMs?: number;
}

const MAX_RESULT_CHARS = 8000;

function truncate(text: string): string {
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (${text.length - MAX_RESULT_CHARS} caracteres más, recortado)` : text;
}

/** Accepts any object; the real check is the tool's JSON Schema, reported in Spanish. */
function inputFor(tool: ConnectorTool) {
  return z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    for (const message of validateJson(tool.inputSchema, value)) ctx.addIssue({ code: 'custom', message });
  });
}

interface HttpRequestPlan {
  method: string;
  url: string;
  body?: unknown;
}

function planHttp(manifest: ConnectorManifest, tool: ConnectorTool, input: Record<string, unknown>): HttpRequestPlan {
  if (tool.binding.kind !== 'http') throw new Error('not http');
  const b = tool.binding;
  let path = b.path;
  for (const p of b.pathParams) {
    const v = input[p];
    if (v === undefined || v === null || v === '') throw new Error(`Falta el parámetro de ruta ${p}.`);
    path = path.replace(`{${p}}`, encodeURIComponent(String(v)));
  }
  const url = new URL(manifest.baseUrl!.replace(/\/$/, '') + path);
  for (const q of b.queryParams) {
    const v = input[q];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(q, String(item));
    else url.searchParams.set(q, String(v));
  }
  return { method: b.method, url: url.toString(), ...(b.body && input['body'] !== undefined ? { body: input['body'] } : {}) };
}

function authHeaders(manifest: ConnectorManifest, env: RuntimeDeps['env'], ctx: ToolContext): Record<string, string> {
  const a = manifest.auth;
  if (a.kind === 'none') return {};
  if (a.kind === 'session') {
    // The person's own token, never a service account: without one (a Vex token, the demo login) the tool cannot act.
    if (!ctx.credential) throw new Error(`${manifest.name} actúa con la sesión de la persona y esta petición no trae un token del host: entra con el acceso de la plataforma.`);
    return { authorization: `Bearer ${ctx.credential}` };
  }
  const secret = env[a.env];
  if (!secret) throw new Error(`Falta la variable de entorno ${a.env} con la credencial de ${manifest.name}.`);
  return a.kind === 'bearer' ? { authorization: `Bearer ${secret}` } : { [a.name]: secret };
}

const dig = (root: unknown, path: string): unknown => path.split('.').filter(Boolean).reduce<unknown>((v, key) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[key] : undefined), root);

/** `$.a.b` reads the write's response, `$input.a` its input, anything else is literal. */
function resolveExpr(expr: unknown, input: unknown, output: unknown): unknown {
  if (typeof expr !== 'string') return expr;
  return expr.startsWith('$input.') ? dig(input, expr.slice(7)) : expr.startsWith('$.') ? dig(output, expr.slice(2)) : expr;
}

export function resolveVerifyParams(spec: Record<string, string>, input: unknown, output: unknown): Record<string, unknown> | null {
  const params: Record<string, unknown> = {};
  for (const [name, expr] of Object.entries(spec)) {
    const value = resolveExpr(expr, input, output);
    if (value === undefined || value === null) return null;
    params[name] = value;
  }
  return params;
}

/** Does the read-back show what the verification expects? Exported for the bank and the tests. */
export function verifyConfirms(expect: VerifyExpect, read: VerifyRead, input: unknown, output: unknown): boolean {
  if (expect === 'missing') return !read.ok && /respondió 404\b/.test(read.error);
  if (expect === 'exists') return read.ok;
  if (!read.ok) return false;
  const actual = dig(read.data, expect.path);
  const wanted = resolveExpr(expect.equals, input, output);
  // Primitives only: a JSON number and the "5" a form sent are the same value; an object never matches.
  if (actual === null || wanted === null) return actual === wanted;
  if (typeof actual === 'object' || typeof wanted === 'object' || actual === undefined || wanted === undefined) return false;
  return String(actual) === String(wanted);
}

function verification(tool: ConnectorTool): AnyTool['verify'] | undefined {
  const v = tool.verify;
  if (!v) return undefined;
  return {
    tool: v.tool,
    params: (input, output) => resolveVerifyParams(v.params, input, output),
    confirms: (read, input, output) => verifyConfirms(v.expect, read, input, output),
    ...(v.target ? { target: () => v.target } : {}),
  };
}

function httpTool(manifest: ConnectorManifest, tool: ConnectorTool & { risk: Risk }, deps: RuntimeDeps): AnyTool {
  const doFetch = deps.fetch ?? fetch;
  const verify = verification(tool);
  return defineTool({
    name: tool.name,
    description: `[${manifest.name}] ${tool.description}`,
    driver: 'api',
    risk: tool.risk,
    input: inputFor(tool),
    jsonSchema: tool.inputSchema,
    ...(verify ? { verify } : {}),
    summarize: (input) => {
      const plan = planHttp(manifest, tool, input);
      return `${manifest.name}: ${plan.method} ${new URL(plan.url).pathname}`;
    },
    // The card shows the exact request that will leave Vex: method, URL and body.
    preview: async (input) => {
      const plan = planHttp(manifest, tool, input);
      return { servicio: manifest.name, metodo: plan.method, url: plan.url, ...(plan.body !== undefined ? { cuerpo: plan.body } : {}) };
    },
    execute: async (input, ctx) => {
      const plan = planHttp(manifest, tool, input);
      const timeout = AbortSignal.timeout(deps.timeoutMs ?? 15_000);
      const res = await doFetch(plan.url, {
        method: plan.method,
        headers: { accept: 'application/json', ...(plan.body !== undefined ? { 'content-type': 'application/json' } : {}), ...authHeaders(manifest, deps.env, ctx) },
        ...(plan.body !== undefined ? { body: JSON.stringify(plan.body) } : {}),
        signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
      });
      const text = await res.text();
      // A session that the host no longer accepts (expired, or not valid for this service) is said plainly; nothing retries.
      if (res.status === 401 && manifest.auth.kind === 'session') throw new Error(`${manifest.name} no acepta tu sesión (${res.status}): ha caducado o no vale para este servicio. Vuelve a entrar y repite la acción.`);
      if (!res.ok) throw new Error(`${manifest.name} respondió ${res.status}: ${text.slice(0, 300)}`);
      if (!text) return { ok: true, estado: res.status };
      try {
        return JSON.parse(truncate(text)) as unknown;
      } catch {
        return truncate(text);
      }
    },
  });
}

function mcpTool(manifest: ConnectorManifest, tool: ConnectorTool & { risk: Risk }, deps: RuntimeDeps): AnyTool {
  if (tool.binding.kind !== 'mcp') throw new Error('not mcp');
  const remote = tool.binding.tool;
  return defineTool({
    name: tool.name,
    description: `[${manifest.name}] ${tool.description}`,
    driver: 'mcp',
    risk: tool.risk,
    input: inputFor(tool),
    jsonSchema: tool.inputSchema,
    summarize: (input) => `${manifest.name}: ${remote}${Object.keys(input).length ? ` ${JSON.stringify(input).slice(0, 120)}` : ''}`,
    preview: async (input) => ({ servicio: manifest.name, herramienta: remote, argumentos: input }),
    execute: async (input, ctx) => {
      if (!deps.mcp) throw new Error('Este servidor no tiene acceso a MCP.');
      const client = await deps.mcp(manifest);
      const result = await client.callTool(remote, input, ctx.signal);
      const text = contentToText(result, MAX_RESULT_CHARS);
      if (result.isError) throw new Error(`${manifest.name}: ${text.slice(0, 500)}`);
      return text;
    },
  });
}

/** The operator tools of a connector: only the reviewed and enabled ones, with the approved risk. */
export function toolsFromManifest(manifest: ConnectorManifest, deps: RuntimeDeps): AnyTool[] {
  return liveTools(manifest).map((t) => (t.binding.kind === 'http' ? httpTool(manifest, t, deps) : mcpTool(manifest, t, deps)));
}
