import {
  HttpMcpClient,
  ReviewError,
  StdioMcpClient,
  authSchema,
  importMcp,
  importOpenApi,
  liveTools,
  refreshConnector,
  reviewConnector,
  toolsFromManifest,
  type ConnectorAuth,
  type ConnectorManifest,
  type McpClient,
  type RefreshReport,
  type ToolDecision,
} from '@vex/connectors';
import { defineTool, type AnyTool } from '@vex/operator';
import { z } from 'zod';
import type { OperatorStore } from './storage.ts';

/** Names the platform driver already uses; a connector tool may not shadow them. */
const RESERVED = new Set(['buscar', 'leer_expediente', 'crear_expediente', 'crear_tarea', 'redactar_correo', 'enviar_correo', 'leer_guia']);
const MAX_SPEC_BYTES = 2_000_000;

export class ConnectorError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface RegistryOptions {
  store: OperatorStore;
  /** Where the secrets named by `auth.env` live. */
  env: Record<string, string | undefined>;
  /**
   * Local MCP servers that may be started, as exact command lines ("command arg1 arg2").
   * Starting a process is code execution on this machine, so an import must match one entry
   * exactly, command and arguments; a listed interpreter with other arguments is refused.
   */
  mcpAllow: string[];
  /** Returns a reason when a URL the server would fetch is not allowed; null when it is. */
  checkUrl?: (url: string) => string | null;
  fetch?: typeof fetch;
}

/** Normalises a command line for comparison: slashes, case, whitespace. */
export function commandKey(command: string, args: readonly string[]): string {
  return [command, ...args].map((s) => s.trim().replace(/\\/g, '/').toLowerCase()).join(' ');
}

export interface OpenApiImportRequest {
  id: string;
  name?: string;
  url?: string;
  spec?: unknown;
  baseUrl?: string;
  auth?: ConnectorAuth;
}

export type McpImportRequest =
  | { id: string; name?: string; transport: 'stdio'; command: string; args?: string[] }
  | { id: string; name?: string; transport: 'http'; url: string };

export interface ReviewRequest {
  decisions: ToolDecision[];
  guide?: string;
  auth?: ConnectorAuth;
  baseUrl?: string;
}

/**
 * The connectors this Vex Core knows: drafts and reviewed ones, persisted in the store. Only
 * reviewed and enabled tools reach the operator, with the risk a person approved.
 */
export class ConnectorRegistry {
  private readonly opts: RegistryOptions;
  private readonly manifests = new Map<string, ConnectorManifest>();
  private readonly clients = new Map<string, Promise<McpClient>>();

  constructor(opts: RegistryOptions) {
    this.opts = opts;
    for (const m of opts.store.listConnectors()) this.manifests.set(m.id, m);
  }

  list(): ConnectorManifest[] {
    return [...this.manifests.values()];
  }

  get(id: string): ConnectorManifest {
    const m = this.manifests.get(id);
    if (!m) throw new ConnectorError(404, `No existe el conector ${id}.`);
    return m;
  }

  private assertNew(id: string): void {
    if (this.manifests.has(id)) throw new ConnectorError(409, `Ya existe el conector ${id}; usa "actualizar" para volver a importarlo.`);
  }

  private assertNoShadowing(m: ConnectorManifest): void {
    const clash = m.tools.find((t) => RESERVED.has(t.name));
    if (clash) throw new ConnectorError(400, `El id ${m.id} produce la herramienta ${clash.name}, que ya existe en Vex. Elige otro id.`);
  }

  private save(m: ConnectorManifest): ConnectorManifest {
    this.manifests.set(m.id, m);
    this.opts.store.saveConnector(m);
    return m;
  }

  private async fetchSpec(url: string): Promise<unknown> {
    const reason = this.opts.checkUrl?.(url);
    if (reason) throw new ConnectorError(400, reason);
    const res = await (this.opts.fetch ?? fetch)(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new ConnectorError(400, `No se pudo descargar la especificación: HTTP ${res.status}.`);
    const text = await res.text();
    if (text.length > MAX_SPEC_BYTES) throw new ConnectorError(400, 'La especificación supera 2 MB.');
    try {
      return JSON.parse(text);
    } catch {
      throw new ConnectorError(400, 'La especificación no es JSON (de momento no se admite YAML).');
    }
  }

  async importOpenApi(req: OpenApiImportRequest): Promise<ConnectorManifest> {
    this.assertNew(req.id);
    if (req.auth) authSchema.parse(req.auth);
    const spec = req.spec ?? (req.url ? await this.fetchSpec(req.url) : undefined);
    if (!spec) throw new ConnectorError(400, 'Indica la URL de la especificación o pégala.');
    let draft: ConnectorManifest;
    try {
      draft = importOpenApi(spec, {
        id: req.id,
        ...(req.name ? { name: req.name } : {}),
        ...(req.baseUrl ? { baseUrl: req.baseUrl } : {}),
        ...(req.url ? { sourceUrl: req.url } : {}),
        ...(req.auth ? { auth: req.auth } : {}),
      });
    } catch (err) {
      throw new ConnectorError(400, err instanceof Error ? err.message : String(err));
    }
    this.assertNoShadowing(draft);
    return this.save(draft);
  }

  private allowed(command: string, args: readonly string[]): boolean {
    const key = commandKey(command, args);
    return this.opts.mcpAllow.some((entry) => {
      const [cmd = '', ...rest] = entry.trim().split(/\s+/);
      return commandKey(cmd, rest) === key;
    });
  }

  private async openMcp(source: ConnectorManifest['source']): Promise<McpClient> {
    if (source.kind === 'mcp-stdio') {
      if (!this.allowed(source.command, source.args)) {
        throw new ConnectorError(403, `Esa línea de comando no está en VEX_MCP_ALLOW (comando y argumentos exactos); un administrador del servidor tiene que permitirla.`);
      }
      return StdioMcpClient.start(source.command === 'node' ? process.execPath : source.command, source.args);
    }
    if (source.kind === 'mcp-http') {
      const reason = this.opts.checkUrl?.(source.url);
      if (reason) throw new ConnectorError(400, reason);
      return HttpMcpClient.connect(source.url);
    }
    throw new ConnectorError(400, 'Este conector no es MCP.');
  }

  async importMcp(req: McpImportRequest): Promise<ConnectorManifest> {
    this.assertNew(req.id);
    const source = req.transport === 'stdio' ? { kind: 'mcp-stdio' as const, command: req.command, args: req.args ?? [] } : { kind: 'mcp-http' as const, url: req.url };
    let client: McpClient;
    try {
      client = await this.openMcp(source);
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(400, `No se pudo conectar con el servidor MCP: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const draft = importMcp(await client.listTools(), { id: req.id, ...(req.name ? { name: req.name } : {}), source, server: client.server });
      this.assertNoShadowing(draft);
      this.clients.set(req.id, Promise.resolve(client));
      return this.save(draft);
    } catch (err) {
      await client.close();
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(400, err instanceof Error ? err.message : String(err));
    }
  }

  review(id: string, req: ReviewRequest, reviewer: string): ConnectorManifest {
    const current = this.get(id);
    let next: ConnectorManifest;
    try {
      next = reviewConnector(current, req.decisions, reviewer);
    } catch (err) {
      if (err instanceof ReviewError) throw new ConnectorError(400, err.message);
      throw err;
    }
    if (req.guide !== undefined) next = { ...next, guide: req.guide.slice(0, 4000) };
    if (req.auth) next = { ...next, auth: authSchema.parse(req.auth) };
    if (req.baseUrl) next = { ...next, baseUrl: req.baseUrl };
    return this.save(next);
  }

  async refresh(id: string): Promise<RefreshReport> {
    const current = this.get(id);
    let fresh: ConnectorManifest;
    if (current.source.kind === 'openapi') {
      if (!current.source.url) throw new ConnectorError(400, 'Este conector se importó pegando la especificación; vuelve a importarlo.');
      fresh = importOpenApi(await this.fetchSpec(current.source.url), { id, sourceUrl: current.source.url, ...(current.baseUrl ? { baseUrl: current.baseUrl } : {}), auth: current.auth });
    } else {
      await this.dropClient(id);
      const client = await this.openMcp(current.source);
      this.clients.set(id, Promise.resolve(client));
      fresh = importMcp(await client.listTools(), { id, source: current.source, server: client.server });
    }
    const report = refreshConnector(current, fresh);
    this.save(report.manifest);
    return report;
  }

  async remove(id: string): Promise<void> {
    this.get(id);
    await this.dropClient(id);
    this.manifests.delete(id);
    this.opts.store.deleteConnector(id);
  }

  private async dropClient(id: string): Promise<void> {
    const c = this.clients.get(id);
    this.clients.delete(id);
    if (c) await (await c.catch(() => null))?.close();
  }

  /** One MCP connection per connector, opened on first use and reopened if it died. */
  private mcpFor = async (m: ConnectorManifest): Promise<McpClient> => {
    let pending = this.clients.get(m.id);
    if (!pending) {
      pending = this.openMcp(m.source);
      this.clients.set(m.id, pending);
      pending.catch(() => this.clients.delete(m.id));
    }
    return pending;
  };

  /** Connectors with at least one tool the operator may use. */
  live(): ConnectorManifest[] {
    return this.list().filter((m) => liveTools(m).length > 0);
  }

  /** Every approved and enabled connector tool, ready for the operator loop. */
  tools(): AnyTool[] {
    return this.live().flatMap((m) => toolsFromManifest(m, { env: this.opts.env, mcp: this.mcpFor, ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}) }));
  }

  /** `leer_guia`: the connector's guide, loaded only when a request needs it. */
  guideTool(): AnyTool {
    return defineTool({
      name: 'leer_guia',
      description: 'Devuelve la guía de uso de un conector aprobado (para qué sirve cada herramienta, flujos típicos y trampas). Llámala antes de usar un conector por primera vez en la conversación.',
      driver: 'platform',
      risk: 'read',
      input: z.object({ conector: z.string().min(1).describe('Id del conector, p. ej. citas.') }),
      summarize: (i) => `Leer la guía del conector ${i.conector}`,
      execute: async (i) => {
        const m = this.manifests.get(i.conector);
        const tools = m ? liveTools(m) : [];
        if (!m || tools.length === 0) return { error: `No hay ningún conector aprobado con id ${i.conector}.` };
        return {
          conector: m.id,
          nombre: m.name,
          guia: m.guide || 'Sin guía escrita: guíate por la descripción de cada herramienta.',
          herramientas: tools.map((t) => ({ nombre: t.name, riesgo: t.risk, descripcion: t.description.slice(0, 200) })),
        };
      },
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.keys()].map((id) => this.dropClient(id)));
  }
}
