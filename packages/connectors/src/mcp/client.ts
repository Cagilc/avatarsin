import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { McpAnnotations } from '../risk.ts';

/** Protocol revision we speak; servers answer with the one they support. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: McpAnnotations;
}

export interface McpContent {
  type: string;
  text?: string;
  mimeType?: string;
  data?: string;
}

export interface McpCallResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpServerInfo {
  name: string;
  title?: string;
  version?: string;
}

/** The three calls Vex needs from an MCP server. */
export interface McpClient {
  readonly server: McpServerInfo;
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>;
  close(): Promise<void>;
}

interface RpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const CLIENT_INFO = { name: 'vex-core', version: '0.1.0' };
const DEFAULT_TIMEOUT_MS = 30_000;

function rpcError(method: string, error: RpcResponse['error']): Error {
  return new Error(`MCP ${method}: ${error?.message ?? 'error desconocido'}`);
}

/** Shared logic: handshake, pagination of tools/list, tools/call. */
abstract class BaseClient implements McpClient {
  server: McpServerInfo = { name: 'desconocido' };
  protected protocolVersion = MCP_PROTOCOL_VERSION;

  protected abstract request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
  protected abstract notify(method: string, params?: unknown): Promise<void>;
  abstract close(): Promise<void>;

  protected async handshake(): Promise<void> {
    const result = (await this.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO })) as {
      protocolVersion?: string;
      serverInfo?: McpServerInfo;
    };
    this.protocolVersion = result.protocolVersion ?? MCP_PROTOCOL_VERSION;
    this.server = result.serverInfo ?? { name: 'desconocido' };
    await this.notify('notifications/initialized');
  }

  async listTools(): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const result = (await this.request('tools/list', cursor ? { cursor } : {})) as { tools?: McpToolInfo[]; nextCursor?: string };
      tools.push(...(result.tools ?? []));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    return (await this.request('tools/call', { name, arguments: args }, signal)) as McpCallResult;
  }
}

/** A local MCP server started as a child process, newline-delimited JSON-RPC over stdio. */
export class StdioMcpClient extends BaseClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, { resolve: (r: RpcResponse) => void; reject: (e: Error) => void }>();
  private buffer = '';
  private stderr = '';
  private nextId = 1;
  private exited: Error | null = null;
  private readonly timeoutMs: number;

  private constructor(command: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) {
    super();
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.child = spawn(command, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString('utf8')).slice(-2000);
    });
    const fail = (err: Error) => {
      this.exited = err;
      for (const w of this.waiting.values()) w.reject(err);
      this.waiting.clear();
    };
    this.child.on('error', (err) => fail(new Error(`No se pudo arrancar el servidor MCP: ${err.message}`)));
    this.child.on('exit', (code) => fail(new Error(`El servidor MCP terminó (código ${code}). ${this.stderr.trim().slice(-300)}`)));
  }

  static async start(command: string, args: string[] = [], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<StdioMcpClient> {
    const client = new StdioMcpClient(command, args, opts);
    try {
      await client.handshake();
    } catch (err) {
      await client.close();
      throw err;
    }
    return client;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let i = this.buffer.indexOf('\n');
    while (i >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      i = this.buffer.indexOf('\n');
      if (!line) continue;
      let msg: Partial<RpcResponse> & { method?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // servers sometimes log to stdout; ignore non-JSON lines
      }
      if (typeof msg.id === 'number' && !msg.method) {
        const w = this.waiting.get(msg.id);
        if (w) {
          this.waiting.delete(msg.id);
          w.resolve(msg as RpcResponse);
        }
      }
    }
  }

  private write(message: unknown): void {
    if (this.exited) throw this.exited;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  protected request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.exited) {
        reject(this.exited);
        return;
      }
      const id = this.nextId;
      this.nextId += 1;
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`MCP ${method}: sin respuesta en ${this.timeoutMs / 1000} s.`));
      }, this.timeoutMs);
      const onAbort = () => {
        this.waiting.delete(id);
        clearTimeout(timer);
        void this.notify('notifications/cancelled', { requestId: id, reason: 'Detenido por el usuario' }).catch(() => {});
        reject(new Error('Detenido por el usuario.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (r.error) reject(rpcError(method, r.error));
          else resolve(r.result);
        },
        reject: (e) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        },
      });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (err) {
        this.waiting.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  protected async notify(method: string, params?: unknown): Promise<void> {
    this.write({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
  }

  async close(): Promise<void> {
    if (this.child.exitCode === null && !this.child.killed) {
      this.child.stdin.end();
      this.child.kill();
    }
  }
}

/** A remote MCP server over Streamable HTTP: one POST per message, JSON or SSE in return. */
export class HttpMcpClient extends BaseClient {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private sessionId: string | null = null;
  private nextId = 1;

  private constructor(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number }) {
    super();
    this.url = url;
    this.headers = opts.headers ?? {};
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static async connect(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<HttpMcpClient> {
    const client = new HttpMcpClient(url, opts);
    await client.handshake();
    return client;
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': this.protocolVersion,
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  }

  protected async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const res = await this.post({ jsonrpc: '2.0', id, method, params }, signal);
    const session = res.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    if (!res.ok) throw new Error(`MCP ${method}: HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    let msg: RpcResponse | undefined;
    if (type.includes('text/event-stream')) {
      const text = await res.text();
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const parsed = JSON.parse(data) as RpcResponse;
        if (parsed.id === id) msg = parsed;
      }
    } else {
      msg = (await res.json()) as RpcResponse;
    }
    if (!msg) throw new Error(`MCP ${method}: respuesta sin resultado.`);
    if (msg.error) throw rpcError(method, msg.error);
    return msg.result;
  }

  protected async notify(method: string, params?: unknown): Promise<void> {
    const res = await this.post({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
    await res.body?.cancel();
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    await fetch(this.url, { method: 'DELETE', headers: { 'mcp-session-id': this.sessionId } }).catch(() => {});
  }
}

/** Text of a tool result for the model: text parts as is, other parts as short placeholders. */
export function contentToText(result: McpCallResult, maxChars = 8000): string {
  const parts = result.content.map((c) => {
    if (c.type === 'text' && typeof c.text === 'string') return c.text;
    if (c.type === 'image') return `[imagen ${c.mimeType ?? ''}, ${Math.round(((c.data?.length ?? 0) * 3) / 4 / 1024)} KB]`;
    return `[${c.type}]`;
  });
  if (parts.length === 0 && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  const text = parts.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (${text.length - maxChars} caracteres más, recortado)` : text;
}
