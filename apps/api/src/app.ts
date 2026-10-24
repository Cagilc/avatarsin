import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authSchema } from '@vex/connectors';
import { riskSchema, runOperator, type AnyTool, type ChatMessage, type ModelProvider, type OperatorEvent, type PermissionPolicy, type Principal, type VexPersonality } from '@vex/operator';
import { DEMO_USERS, bearer, issueDemoToken, verifyToken } from './auth.ts';
import { ConnectorError, ConnectorRegistry } from './connectors.ts';
import type { PlatformClient } from './platform/types.ts';
import { RateLimiter } from './rateLimit.ts';
import { SessionStore } from './sessions.ts';
import { MemoryStore, type OperatorStore } from './storage.ts';
import { DEFAULT_PERSONALITY, buildSystemPrompt } from './system.ts';
import { platformTools } from './tools/platform.ts';

export interface AppOptions {
  provider: ModelProvider;
  platform: PlatformClient;
  /** Audit and conversations. Defaults to memory (lost on restart). */
  store?: OperatorStore;
  policy?: PermissionPolicy;
  personality?: VexPersonality;
  hostName?: string;
  corsOrigin?: string | boolean;
  /** How long a confirmation may stay unanswered before it counts as rejected. */
  confirmTimeoutMs?: number;
  /** Messages per user (and proxy calls per IP) per window: protects the model bill. */
  rateLimit?: { messages: number; windowMs: number };
  /** Tool calls per message. */
  maxToolCalls?: number;
  /**
   * POST /provider/complete lets a host run the loop itself (Vex Studio) while the key stays here.
   * It spends the key without a user token, so it is off unless the server only listens locally.
   */
  enableProviderProxy?: boolean;
  /** Connectors (OpenAPI and MCP tools approved by a person). */
  connectors?: {
    /** Where the secrets named by each connector's auth live. Default: process.env. */
    env?: Record<string, string | undefined>;
    /** Commands that may be started as local MCP servers. Default: none. */
    mcpAllow?: string[];
    fetch?: typeof fetch;
  };
  logger?: boolean;
}

/** Platform tools plus reviewed connectors; the policy cannot widen what a person approved. */
const OPERATOR_POLICY: PermissionPolicy = { allow: ['platform:*', 'api:*', 'mcp:*'], deny: [], confirm: ['irreversible'] };

const idSchema = z.string().regex(/^[a-z][a-z0-9]{1,23}$/, 'id: minúsculas y dígitos, empieza por letra, máximo 24');
const importOpenApiBody = z.object({
  id: idSchema,
  name: z.string().min(1).max(80).optional(),
  url: z.string().url().optional(),
  spec: z.record(z.string(), z.unknown()).optional(),
  baseUrl: z.string().url().optional(),
  auth: authSchema.optional(),
});
const importMcpBody = z.discriminatedUnion('transport', [
  z.object({ id: idSchema, name: z.string().min(1).max(80).optional(), transport: z.literal('stdio'), command: z.string().min(1), args: z.array(z.string()).optional() }),
  z.object({ id: idSchema, name: z.string().min(1).max(80).optional(), transport: z.literal('http'), url: z.string().url() }),
]);
const reviewBody = z.object({
  decisions: z.array(z.object({ name: z.string().min(1), risk: riskSchema, enabled: z.boolean(), lowerRiskReason: z.string().max(500).optional() })),
  guide: z.string().max(4000).optional(),
  auth: authSchema.optional(),
  baseUrl: z.string().url().optional(),
});

const chatBody = z.object({
  sessionId: z.string().min(1).optional(),
  message: z.string().min(1).max(4000),
  context: z.record(z.string(), z.unknown()).optional(),
});

const confirmBody = z.object({
  sessionId: z.string().min(1),
  actionId: z.string().min(1),
  approved: z.boolean(),
});

const stopBody = z.object({ sessionId: z.string().min(1) });

const demoLoginBody = z.object({ userId: z.string().min(1) });

/** A neutral completion request from a host that runs the loop itself (Vex Studio). */
const completeBody = z.object({
  system: z.string(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.array(z.record(z.string(), z.unknown())) })),
  tools: z.array(z.object({ name: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.unknown()) })),
});

const DEFAULT_RATE_LIMIT = { messages: 20, windowMs: 60_000 };

function principalOf(req: FastifyRequest, reply: FastifyReply): Principal | null {
  const principal = verifyToken(bearer(req.headers.authorization));
  if (!principal) void reply.code(401).send({ error: 'Token ausente o inválido.' });
  return principal;
}

/** Vex Core as a Fastify app. `buildApp` is what tests use; `server.ts` listens. */
export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const store = opts.store ?? new MemoryStore();
  const policy = opts.policy ?? OPERATOR_POLICY;
  const personality = opts.personality ?? DEFAULT_PERSONALITY;
  const hostName = opts.hostName ?? 'la plataforma';
  const platform: AnyTool[] = platformTools(opts.platform);
  const registry = new ConnectorRegistry({
    store,
    env: opts.connectors?.env ?? process.env,
    mcpAllow: opts.connectors?.mcpAllow ?? [],
    ...(opts.connectors?.fetch ? { fetch: opts.connectors.fetch } : {}),
  });
  /** Recomputed per message: a review takes effect on the next request, not mid-run. */
  const currentTools = (): AnyTool[] => [...platform, registry.guideTool(), ...registry.tools()];
  const currentSystem = (): string => buildSystemPrompt(personality, hostName, registry.live().map((m) => ({ id: m.id, name: m.name, description: m.description })));
  const sessions = new SessionStore(store);
  const confirmTimeoutMs = opts.confirmTimeoutMs ?? 5 * 60_000;
  const limits = opts.rateLimit ?? DEFAULT_RATE_LIMIT;
  const limiter = new RateLimiter(limits.messages, limits.windowMs);
  const providerProxy = opts.enableProviderProxy ?? false;

  void app.register(cors, { origin: opts.corsOrigin ?? true });
  app.addHook('onClose', async () => {
    await registry.close();
    store.close();
  });

  app.get('/health', async () => ({ ok: true }));

  app.get('/operator/info', async () => ({
    provider: opts.provider.name,
    providerProxy,
    personality,
    policy,
    tools: currentTools().map((t) => ({ name: t.name, driver: t.driver, risk: t.risk, description: t.description })),
  }));

  // --- Demo platform (mock). Replace with the real backend's endpoints/token. ---
  app.get('/platform/auth/demo-users', async () => DEMO_USERS);
  app.post('/platform/auth/demo', async (req, reply) => {
    const body = demoLoginBody.safeParse(req.body);
    const user = body.success ? DEMO_USERS.find((u) => u.id === body.data.userId) : undefined;
    if (!user) return reply.code(400).send({ error: 'Usuario de demo desconocido.' });
    return { token: issueDemoToken(user), principal: user };
  });
  app.get('/platform/estado', async (req, reply) => {
    if (!principalOf(req, reply)) return undefined;
    const [contactos, expedientes, tareas, correos, equipos] = await Promise.all([
      opts.platform.contactos(),
      opts.platform.expedientes(),
      opts.platform.tareas(),
      opts.platform.correos(),
      opts.platform.equipos(),
    ]);
    return { contactos, expedientes, tareas, correos, equipos };
  });

  // --- Model proxy for hosts that run the loop locally (the key never leaves this server). ---
  if (providerProxy) {
    app.post('/provider/complete', async (req, reply) => {
      if (!limiter.take(`proxy:${req.ip}`)) return reply.code(429).send({ error: 'Demasiadas peticiones; espera un momento.' });
      const body = completeBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Petición inválida.' });
      try {
        return await opts.provider.complete({ system: body.data.system, messages: body.data.messages as ChatMessage[], tools: body.data.tools });
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // --- Operator ---
  app.post('/operator/chat', async (req, reply) => {
    const principal = principalOf(req, reply);
    if (!principal) return undefined;
    const body = chatBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join('; ') });

    let session;
    try {
      session = sessions.getOrCreate(body.data.sessionId, principal);
    } catch (err) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : String(err) });
    }
    if (session.busy) return reply.code(409).send({ error: 'La sesión ya está procesando un mensaje.' });
    if (!limiter.take(`user:${principal.id}`)) return reply.code(429).send({ error: 'Has enviado muchos mensajes seguidos; espera un minuto.' });
    session.busy = true;
    const controller = new AbortController();
    session.controller = controller;

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-vex-session': session.id,
      'access-control-allow-origin': typeof opts.corsOrigin === 'string' ? opts.corsOrigin : (req.headers.origin ?? '*'),
      'access-control-expose-headers': 'x-vex-session',
    });
    // If the page goes away mid-run, stop: nobody is there to confirm or read the answer.
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) sessions.stop(session);
    });
    const send = (event: OperatorEvent | { type: 'session'; sessionId: string }) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: 'session', sessionId: session.id });

    try {
      await runOperator({
        sessionId: session.id,
        provider: opts.provider,
        tools: currentTools(),
        policy,
        principal,
        context: body.data.context ?? {},
        history: session.history,
        userMessage: body.data.message,
        system: currentSystem(),
        emit: send,
        confirm: (action) => sessions.waitForConfirmation(session, action, confirmTimeoutMs),
        audit: (entry) => store.recordAudit(entry),
        signal: controller.signal,
        ...(opts.maxToolCalls ? { maxToolCalls: opts.maxToolCalls } : {}),
      });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      session.busy = false;
      session.controller = null;
      sessions.save(session);
      reply.raw.end();
    }
    return reply;
  });

  app.post('/operator/confirm', async (req, reply) => {
    const principal = principalOf(req, reply);
    if (!principal) return undefined;
    const body = confirmBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Cuerpo inválido.' });
    const session = sessions.get(body.data.sessionId);
    if (!session || session.principal.id !== principal.id) return reply.code(404).send({ error: 'Sesión desconocida.' });
    const ok = sessions.confirm(body.data.sessionId, body.data.actionId, body.data.approved);
    if (!ok) return reply.code(404).send({ error: 'No hay ninguna confirmación pendiente con ese id.' });
    return { ok: true };
  });

  app.post('/operator/stop', async (req, reply) => {
    const principal = principalOf(req, reply);
    if (!principal) return undefined;
    const body = stopBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Cuerpo inválido.' });
    const session = sessions.get(body.data.sessionId);
    if (!session || session.principal.id !== principal.id) return reply.code(404).send({ error: 'Sesión desconocida.' });
    return { stopped: sessions.stop(session) };
  });

  // --- Connectors: import, human review, refresh. Administrators only. ---
  const adminOf = (req: FastifyRequest, reply: FastifyReply): Principal | null => {
    const principal = principalOf(req, reply);
    if (!principal) return null;
    if (principal.role !== 'admin') {
      void reply.code(403).send({ error: 'Solo un administrador puede conectar herramientas o aprobar sus riesgos.' });
      return null;
    }
    return principal;
  };
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof ConnectorError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
  };
  /** Connector changes go to the same audit trail as the operator's actions. */
  const auditAdmin = (principal: Principal, tool: string, params: Record<string, unknown>, summary: string) =>
    store.recordAudit({ ts: new Date().toISOString(), sessionId: 'admin', principal, actionId: crypto.randomUUID(), tool, driver: 'platform', risk: 'write', params, summary, outcome: 'ok', durationMs: 0 });

  app.get('/connectors', async (req, reply) => {
    if (!adminOf(req, reply)) return undefined;
    return registry.list();
  });

  app.post('/connectors/import/openapi', async (req, reply) => {
    const principal = adminOf(req, reply);
    if (!principal) return undefined;
    try {
      const body = importOpenApiBody.parse(req.body);
      const m = await registry.importOpenApi(body);
      auditAdmin(principal, 'importar_conector', { id: m.id, origen: body.url ?? 'pegado' }, `Importar ${m.name} (${m.tools.length} herramientas, ninguna activa)`);
      return reply.code(201).send(m);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/connectors/import/mcp', async (req, reply) => {
    const principal = adminOf(req, reply);
    if (!principal) return undefined;
    try {
      const body = importMcpBody.parse(req.body);
      const m = await registry.importMcp(body);
      auditAdmin(principal, 'importar_conector', { id: m.id, origen: body.transport === 'stdio' ? [body.command, ...(body.args ?? [])].join(' ') : body.url }, `Importar ${m.name} (${m.tools.length} herramientas, ninguna activa)`);
      return reply.code(201).send(m);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/connectors/:id/review', async (req, reply) => {
    const principal = adminOf(req, reply);
    if (!principal) return undefined;
    try {
      const body = reviewBody.parse(req.body);
      const m = registry.review((req.params as { id: string }).id, body, principal.id);
      const on = body.decisions.filter((d) => d.enabled).length;
      auditAdmin(principal, 'revisar_conector', { id: m.id, decisiones: body.decisions }, `Revisar ${m.name}: ${on} activadas, ${body.decisions.length - on} desactivadas`);
      return m;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/connectors/:id/refresh', async (req, reply) => {
    const principal = adminOf(req, reply);
    if (!principal) return undefined;
    try {
      const report = await registry.refresh((req.params as { id: string }).id);
      auditAdmin(principal, 'actualizar_conector', { id: report.manifest.id, nuevas: report.added, cambiadas: report.changed, quitadas: report.removed }, `Actualizar ${report.manifest.name}`);
      return report;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/connectors/:id', async (req, reply) => {
    const principal = adminOf(req, reply);
    if (!principal) return undefined;
    try {
      const id = (req.params as { id: string }).id;
      await registry.remove(id);
      auditAdmin(principal, 'borrar_conector', { id }, `Borrar el conector ${id}`);
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/operator/audit', async (req, reply) => {
    const principal = principalOf(req, reply);
    if (!principal) return undefined;
    const sessionId = (req.query as { sessionId?: string }).sessionId;
    return store.audit({ principalId: principal.id, ...(sessionId ? { sessionId } : {}) });
  });

  return app;
}
