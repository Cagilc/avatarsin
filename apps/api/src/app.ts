import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEFAULT_POLICY, runOperator, type AnyTool, type ChatMessage, type ModelProvider, type OperatorEvent, type PermissionPolicy, type Principal, type VexPersonality } from '@vex/operator';
import { DEMO_USERS, bearer, issueDemoToken, verifyToken } from './auth.ts';
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
  logger?: boolean;
}

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
  const policy = opts.policy ?? DEFAULT_POLICY;
  const personality = opts.personality ?? DEFAULT_PERSONALITY;
  const system = buildSystemPrompt(personality, opts.hostName ?? 'la plataforma');
  const tools: AnyTool[] = platformTools(opts.platform);
  const sessions = new SessionStore(store);
  const confirmTimeoutMs = opts.confirmTimeoutMs ?? 5 * 60_000;
  const limits = opts.rateLimit ?? DEFAULT_RATE_LIMIT;
  const limiter = new RateLimiter(limits.messages, limits.windowMs);
  const providerProxy = opts.enableProviderProxy ?? false;

  void app.register(cors, { origin: opts.corsOrigin ?? true });
  app.addHook('onClose', async () => store.close());

  app.get('/health', async () => ({ ok: true }));

  app.get('/operator/info', async () => ({
    provider: opts.provider.name,
    providerProxy,
    personality,
    policy,
    tools: tools.map((t) => ({ name: t.name, driver: t.driver, risk: t.risk, description: t.description })),
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
        tools,
        policy,
        principal,
        context: body.data.context ?? {},
        history: session.history,
        userMessage: body.data.message,
        system,
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

  app.get('/operator/audit', async (req, reply) => {
    const principal = principalOf(req, reply);
    if (!principal) return undefined;
    const sessionId = (req.query as { sessionId?: string }).sessionId;
    return store.audit({ principalId: principal.id, ...(sessionId ? { sessionId } : {}) });
  });

  return app;
}
