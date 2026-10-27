import { existsSync, readFileSync } from 'node:fs';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authSchema, importFilterSchema } from '@vex/connectors';
import { DirectProvider, ScriptedProvider, applicable, decide, permittedTools, riskSchema, runOperator, type AnyTool, type ChatMessage, type HostManifest, type ModelProvider, type OperatorEvent, type PermissionPolicy, type Principal, type VexPersonality } from '@vex/operator';
import { ApprovalNotifier, ApprovalTokens, approvalPage, resultPage } from './approvals.ts';
import { DEMO_USERS, TokenService, bearer } from './auth.ts';
import { caseFromSession } from './cases.ts';
import { OutboundBlockedError, checkOutboundUrl, guardedFetch, originAllowed, type UrlPolicy } from './guard.ts';
import { ConnectorError, ConnectorRegistry } from './connectors.ts';
import { Engage } from './engage.ts';
import { GrantClient, type GrantState } from './grant.ts';
import { HostIdentity } from './identity.ts';
import type { PlatformClient } from './platform/types.ts';
import { RateLimiter } from './rateLimit.ts';
import { SessionStore } from './sessions.ts';
import { SpendMeter, capNotice, warnNotice, type SpendLimits } from './spend.ts';
import { MemoryStore, type OperatorStore } from './storage.ts';
import { DEFAULT_HOST_NAME, DEFAULT_PERSONALITY, buildSystemPrompt } from './system.ts';
import { platformTools } from './tools/platform.ts';

export interface AppOptions {
  provider: ModelProvider;
  platform: PlatformClient;
  /** Audit and conversations. Defaults to memory (lost on restart). */
  store?: OperatorStore;
  /** Overrides the manifest's policy (tests). Default: the manifest's, then the operator's. */
  policy?: PermissionPolicy;
  personality?: VexPersonality;
  /** How the prompt names the platform when there is no manifest. */
  hostName?: string;
  /**
   * The host manifest (loaded on the server, see host.ts): name, screen context, proposed
   * connectors, policy, avatar integration and feature switches. Without one, a bare operator.
   */
  manifest?: HostManifest;
  /** How the grant is fetched from the studio (tests inject a fetch and a clock). */
  grant?: { fetch?: typeof fetch; now?: () => number; refreshMs?: number };
  /** Path of the built <vex-assistant> script (packages/assistant/dist/vex-assistant.js), served at GET /assistant.js. */
  assistantBundle?: string;
  /** Caps on model usage (tokens per person and day, USD per installation and month). Default: DEFAULT_LIMITS, on. */
  spendLimits?: Partial<SpendLimits>;
  /** What runs when a cap is reached or the AI is paused. Default: the scripted planner. */
  fallbackProvider?: ModelProvider;
  /** Clock for the spend meter and the approval links (tests). */
  now?: () => number;
  /** Where the approval links point (this server as the outside sees it). Default: http://127.0.0.1:8787. */
  publicUrl?: string;
  /** Signs the approval links. Default: a random secret that dies with the process (pending confirmations do too). */
  approvalSecret?: string;
  /**
   * Pages allowed to call Vex Core from a browser, as exact origins (scheme://host:port).
   * Any other origin gets no CORS headers and a 403 on state-changing requests. Empty = browsers blocked.
   */
  allowedOrigins?: string[];
  /** Verifies and issues session tokens. Default: a random secret that dies with the process. */
  tokens?: TokenService;
  /** Enables POST /platform/auth/demo (unauthenticated login as a demo user). Local development only. */
  demoLogin?: boolean;
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
    /** Local MCP servers that may be started, as exact command lines. Default: none. */
    mcpAllow?: string[];
    /** Which URLs an administrator may import from. Default: https only, no private networks. */
    urlPolicy?: UrlPolicy;
    fetch?: typeof fetch;
    /** Hostname resolver for the outbound guard. Default: the system resolver. */
    resolve?: (hostname: string) => Promise<string[]>;
  };
  logger?: boolean;
}

/** Platform tools plus reviewed connectors; the policy cannot widen what a person approved. */
const OPERATOR_POLICY: PermissionPolicy = { allow: ['platform:*', 'api:*', 'mcp:*'], deny: [], confirm: ['irreversible'] };

/** Who the audit names for what the manifest proposes at start. */
const MANIFEST_PRINCIPAL: Principal = { id: 'manifiesto', name: 'Manifiesto del host', role: 'admin' };

const idSchema = z.string().regex(/^[a-z][a-z0-9]{1,23}$/, 'id: minúsculas y dígitos, empieza por letra, máximo 24');
const importOpenApiBody = z.object({
  id: idSchema,
  name: z.string().min(1).max(80).optional(),
  url: z.string().url().optional(),
  spec: z.record(z.string(), z.unknown()).optional(),
  baseUrl: z.string().url().optional(),
  auth: authSchema.optional(),
  filter: importFilterSchema.optional(),
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
  filter: importFilterSchema.optional(),
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

const runBody = z.object({
  sessionId: z.string().min(1).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const publishBody = z.object({ title: z.string().min(1).max(120).optional(), body: z.string().min(1).max(2000).optional() });

const feedbackBody = z.object({ sessionId: z.string().min(1), turn: z.number().int().min(1), verdict: z.enum(['up', 'down']), reason: z.string().max(500).optional() });

/** `ai`: the model stops, scripted mode goes on; `all`: Vex answers nothing; null: running. */
const pauseBody = z.object({ mode: z.enum(['ai', 'all']).nullable() });
type PauseMode = 'ai' | 'all' | null;

const demoLoginBody = z.object({ userId: z.string().min(1) });

/** A neutral completion request from a host that runs the loop itself (Vex Studio). */
const completeBody = z.object({
  system: z.string(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.array(z.record(z.string(), z.unknown())) })),
  tools: z.array(z.object({ name: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.unknown()) })),
});

const DEFAULT_RATE_LIMIT = { messages: 20, windowMs: 60_000 };

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Vex Core as a Fastify app. `buildApp` is what tests use; `server.ts` listens. */
export function buildApp(opts: AppOptions): FastifyInstance {
  // maxParamLength: approval links carry a signed token (~220 characters) in the path.
  const app = Fastify({ logger: opts.logger ?? false, maxParamLength: 512 });
  const store = opts.store ?? new MemoryStore();
  const manifest = opts.manifest;
  const policy = opts.policy ?? manifest?.policy ?? OPERATOR_POLICY;
  const personality = opts.personality ?? DEFAULT_PERSONALITY;
  const host = manifest ? { name: manifest.host.name, screenContext: manifest.screenContext } : { name: opts.hostName ?? DEFAULT_HOST_NAME };
  const platform: AnyTool[] = platformTools(opts.platform);
  const urlPolicy: UrlPolicy = opts.connectors?.urlPolicy ?? { allowHttp: false, allowInternal: false };
  // Every request this server makes on behalf of an administrator's input (imports, imported APIs,
  // remote MCP, the studio's grant, approval webhooks) goes through the same guard: names are
  // resolved and pinned, redirects re-checked, credentials dropped when a hop leaves the origin.
  const outboundFetch = guardedFetch({ policy: urlPolicy, ...(opts.connectors?.fetch ? { fetch: opts.connectors.fetch } : {}), ...(opts.connectors?.resolve ? { resolve: opts.connectors.resolve } : {}) });
  const registry = new ConnectorRegistry({
    store,
    env: opts.connectors?.env ?? process.env,
    mcpAllow: opts.connectors?.mcpAllow ?? [],
    checkUrl: (url) => checkOutboundUrl(url, urlPolicy),
    fetch: outboundFetch,
  });
  const guide = registry.guideTool();
  // The studio's grant, only for a host whose manifest names its avatar integration.
  const grants = manifest?.avatar ? new GrantClient({ avatar: manifest.avatar, domain: manifest.host.domain, checkUrl: (url) => checkOutboundUrl(url, urlPolicy), fetch: outboundFetch, ...opts.grant }) : null;
  // The host's own JWTs, verified as the manifest says; the JWKS is fetched through the outbound guard.
  const identity = manifest?.identity ? new HostIdentity(manifest.identity, { env: opts.connectors?.env ?? process.env, fetch: outboundFetch, ...(opts.now ? { now: opts.now } : {}) }) : null;
  const grantState = async (): Promise<GrantState | null> => (grants ? grants.current() : null);
  /**
   * What the model sees, recomputed per message: platform tools and reviewed connectors, narrowed by
   * the policy and by the grant (approved ∩ policy ∩ grant; a review takes effect on the next
   * request, not mid-run). `leer_guia` documents the connectors and is no host action: the policy
   * may deny it, the grant does not list it.
   */
  const currentTools = async (): Promise<AnyTool[]> => {
    const all = [...platform, guide, ...registry.tools()];
    const state = await grantState();
    const kept = new Set<AnyTool>(permittedTools(all.filter((t) => t !== guide), policy, state ? GrantClient.layer(state) : undefined));
    return all.filter((t) => kept.has(t) || (t === guide && decide(policy, guide) !== 'deny'));
  };
  /** The published avatar's personality when the studio gave one with a valid grant; the server's otherwise. */
  const currentPersonality = async (): Promise<VexPersonality> => {
    const state = await grantState();
    return state?.status === 'ok' && state.personality ? state.personality : personality;
  };
  const engage = new Engage({ manifest, store });
  const currentSystem = async (): Promise<string> =>
    buildSystemPrompt(
      await currentPersonality(),
      host,
      registry.live().map((m) => ({ id: m.id, name: m.name, description: m.description })),
      engage.forPrompt(),
    );
  const assistantJs = opts.assistantBundle && existsSync(opts.assistantBundle) ? readFileSync(opts.assistantBundle, 'utf8') : null;
  const sessions = new SessionStore(store);
  const confirmTimeoutMs = opts.confirmTimeoutMs ?? 5 * 60_000;
  const limits = opts.rateLimit ?? DEFAULT_RATE_LIMIT;
  const limiter = new RateLimiter(limits.messages, limits.windowMs);
  const providerProxy = opts.enableProviderProxy ?? false;
  const tokens = opts.tokens ?? TokenService.ephemeral();
  const allowedOrigins = opts.allowedOrigins ?? [];
  /** Connectors the manifest proposed at start and what became of each. */
  const proposals: Array<{ id: string; status: 'proposed' | 'existing' | 'failed'; error?: string }> = [];
  const meter = new SpendMeter(store, opts.spendLimits ?? {}, opts.now);
  const publicUrl = (opts.publicUrl ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
  const approvalTokens = new ApprovalTokens(opts.approvalSecret, opts.now);
  const notifier =
    manifest?.features.channelApprovals && manifest.approvals
      ? new ApprovalNotifier({ channels: manifest.approvals.channels, env: opts.connectors?.env ?? process.env, checkUrl: (url) => checkOutboundUrl(url, urlPolicy), fetch: outboundFetch, log: (line) => app.log.info(line) })
      : null;
  const fallback = opts.fallbackProvider ?? new ScriptedProvider();
  const pauseMode = (): PauseMode => {
    const v = store.getSetting('pause');
    return v === 'ai' || v === 'all' ? v : null;
  };

  const principalOf = async (req: FastifyRequest, reply: FastifyReply): Promise<Principal | null> => {
    const token = bearer(req.headers.authorization);
    let principal = tokens.verify(token);
    if (!principal && identity && token) {
      const result = await identity.verify(token);
      if (result.ok) principal = result.principal;
      else req.log.info({ reason: result.reason }, 'host token refused');
    }
    if (!principal) void reply.code(401).send({ error: 'Token ausente o inválido.' });
    return principal;
  };

  // Browsers only from the listed pages; CORS never reflects an arbitrary origin. The approval
  // page is served by this server itself, so its own forms pass as same-origin.
  void app.register(cors, { origin: allowedOrigins, exposedHeaders: ['x-vex-session'] });
  const selfOrigin = (req: FastifyRequest) => `${req.protocol}://${req.headers.host ?? ''}`;
  app.addHook('onRequest', async (req, reply) => {
    if (!STATE_CHANGING.has(req.method) || originAllowed(req.headers.origin, allowedOrigins)) return;
    if (req.url.startsWith('/approve/') && req.headers.origin === selfOrigin(req)) return;
    await reply.code(403).send({ error: 'Origen no permitido.' });
  });
  app.addHook('onClose', async () => {
    await registry.close();
    store.close();
  });

  app.get('/health', async () => ({ ok: true }));

  // The embeddable panel. Public like any script a page loads; it carries no secret.
  app.get('/assistant.js', async (_req, reply) => {
    if (!assistantJs) return reply.code(404).send({ error: 'Falta compilar el asistente (pnpm build).' });
    return reply.header('content-type', 'text/javascript; charset=utf-8').header('access-control-allow-origin', '*').header('cross-origin-resource-policy', 'cross-origin').header('cache-control', 'public, max-age=300').send(assistantJs);
  });

  app.get('/operator/info', async () => {
    const state = await grantState();
    return {
      provider: opts.provider.name,
      providerProxy,
      personality: await currentPersonality(),
      policy,
      host: {
        name: host.name,
        manifest: manifest !== undefined,
        ...(manifest ? { domain: manifest.host.domain, features: manifest.features, proposals, ...(identity ? { identity: identity.kind } : {}) } : {}),
        // Where the page's <vex-assistant> finds the published avatar; public values, as in the studio's snippet.
        ...(manifest?.avatar ? { avatar: manifest.avatar } : {}),
      },
      grant: state === null ? { status: 'none' } : state.status === 'ok' ? { status: 'ok', tools: state.grant.tools, maxRisk: state.grant.maxRisk, expiresAt: state.grant.expiresAt } : state,
      pause: pauseMode(),
      limits: meter.limits,
      tools: (await currentTools()).map((t) => ({ name: t.name, driver: t.driver, risk: t.risk, description: t.description })),
    };
  });

  // --- Demo platform (mock). Replace with the real backend's endpoints/token. ---
  if (opts.demoLogin) {
    app.get('/platform/auth/demo-users', async () => DEMO_USERS);
    app.post('/platform/auth/demo', async (req, reply) => {
      const body = demoLoginBody.safeParse(req.body);
      const user = body.success ? DEMO_USERS.find((u) => u.id === body.data.userId) : undefined;
      if (!user) return reply.code(400).send({ error: 'Usuario de demo desconocido.' });
      return { token: tokens.issue(user), principal: user };
    });
  }
  app.get('/platform/estado', async (req, reply) => {
    if (!await principalOf(req, reply)) return undefined;
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
  /**
   * One operator run streamed over SSE: a chat message, or a quick action through the very same
   * loop. `ai` says whether the run asks the model: those runs are metered and fall back to
   * scripted mode past a cap or under a pause, with a notice at the head of the stream.
   */
  const streamRun = async (req: FastifyRequest, reply: FastifyReply, principal: Principal, body: { sessionId?: string | undefined; context?: Record<string, unknown> | undefined }, run: { userMessage: string; provider: ModelProvider; ai: boolean }) => {
    if (pauseMode() === 'all') return reply.code(503).send({ error: 'Vex está en pausa por un administrador.' });
    let session;
    try {
      session = sessions.getOrCreate(body.sessionId, principal);
    } catch (err) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : String(err) });
    }
    let provider = run.provider;
    const notices: string[] = [];
    if (run.ai && run.provider.name !== 'scripted') {
      const status = meter.status(principal);
      if (pauseMode() === 'ai') {
        provider = fallback;
        notices.push(capNotice('pause'));
      } else if (status.blocked) {
        provider = fallback;
        notices.push(capNotice(status.blocked));
      } else {
        provider = meter.metered(run.provider, principal);
        const warning = warnNotice(status);
        if (warning) notices.push(warning);
      }
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
      // Raw response: the CORS plugin cannot add its headers, so set them for the allowed page only.
      ...(req.headers.origin && allowedOrigins.includes(req.headers.origin) ? { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' } : {}),
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
    for (const message of notices) send({ type: 'notice', message });

    try {
      await runOperator({
        sessionId: session.id,
        provider,
        tools: await currentTools(),
        policy,
        principal,
        context: body.context ?? {},
        history: session.history,
        userMessage: run.userMessage,
        system: await currentSystem(),
        emit: send,
        confirm: (action) => {
          const wait = sessions.waitForConfirmation(session, action, confirmTimeoutMs);
          if (!notifier) return wait;
          // The card also goes out through the host's channels; a failed delivery never blocks the card itself.
          // The decision is applied once the delivery report is in (bounded by the webhook timeout), so the
          // notice and the audit entries always come before the outcome of the action.
          const token = approvalTokens.issue({ sessionId: session.id, actionId: action.id, principalId: principal.id }, confirmTimeoutMs);
          const expiresAt = new Date((opts.now ?? Date.now)() + confirmTimeoutMs).toISOString();
          const notified = notifier
            .notify({ sessionId: session.id, principal, action, approveUrl: `${publicUrl}/approve/${token}`, expiresAt })
            .then((results) => {
              for (const r of results) {
                store.recordAudit({ ts: new Date().toISOString(), sessionId: session.id, principal, actionId: crypto.randomUUID(), tool: 'avisar_aprobacion', driver: 'platform', risk: 'read', params: { canal: r.kind, accion: action.id }, summary: `Aviso de aprobación por ${r.kind}: ${action.summary}`, outcome: r.ok ? 'ok' : 'error', ...(r.error ? { error: r.error } : {}), durationMs: 0 });
              }
              const delivered = results.filter((r) => r.ok).map((r) => (r.kind === 'log' ? 'el registro del servidor' : r.kind));
              if (delivered.length) send({ type: 'notice', message: `Te he avisado por ${delivered.join(' y ')} por si prefieres aprobarlo desde allí.` });
            })
            .catch((err: unknown) => app.log.warn({ err }, 'approval notification failed'));
          return Promise.all([wait, notified]).then(([decision]) => decision);
        },
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
  };

  app.post('/operator/chat', async (req, reply) => {
    const principal = await principalOf(req, reply);
    if (!principal) return undefined;
    const body = chatBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join('; ') });
    return streamRun(req, reply, principal, body.data, { userMessage: body.data.message, provider: opts.provider, ai: true });
  });

  // A thumbs up or down on one reply, with the reason: what administrators look at to pick cases for the bank.
  app.post('/operator/feedback', async (req, reply) => {
    const principal = await principalOf(req, reply);
    if (!principal) return undefined;
    const body = feedbackBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Cuerpo inválido.' });
    const session = sessions.get(body.data.sessionId) ?? store.loadSession(body.data.sessionId);
    if (!session || session.principal.id !== principal.id) return reply.code(404).send({ error: 'Sesión desconocida.' });
    store.recordFeedback({ ts: new Date().toISOString(), sessionId: body.data.sessionId, principalId: principal.id, turn: body.data.turn, verdict: body.data.verdict, ...(body.data.reason?.trim() ? { reason: body.data.reason.trim() } : {}) });
    return { ok: true };
  });

  // --- Sessions as eval cases: administrators ---
  app.get('/admin/sessions', async (req, reply) => {
    if (!await adminOf(req, reply)) return undefined;
    return store.listSessions(50).map((s) => {
      const fb = store.feedbackFor(s.id);
      return { ...s, feedback: { up: fb.filter((f) => f.verdict === 'up').length, down: fb.filter((f) => f.verdict === 'down').length, reasons: fb.filter((f) => f.reason).map((f) => ({ turn: f.turn, verdict: f.verdict, reason: f.reason })) } };
    });
  });

  app.get('/admin/sessions/:id/case', async (req, reply) => {
    if (!await adminOf(req, reply)) return undefined;
    const id = (req.params as { id: string }).id;
    const session = sessions.get(id) ?? store.loadSession(id);
    if (!session) return reply.code(404).send({ error: 'Sesión desconocida.' });
    const query = req.query as { turn?: string; anonymize?: string };
    const turn = query.turn !== undefined ? Number(query.turn) : undefined;
    if (turn !== undefined && (!Number.isInteger(turn) || turn < 1)) return reply.code(400).send({ error: 'turn: entero a partir de 1.' });
    try {
      return caseFromSession({ session, audit: store.audit({ principalId: session.principal.id, sessionId: id, limit: 1000 }), ...(turn !== undefined ? { turn } : {}), anonymize: query.anonymize === '1' || query.anonymize === 'true' });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Spend and the pause switch: administrators ---
  app.get('/admin/spend', async (req, reply) => {
    if (!await adminOf(req, reply)) return undefined;
    return { ...meter.report(), pause: pauseMode() };
  });

  app.post('/admin/pause', async (req, reply) => {
    const principal = await adminOf(req, reply);
    if (!principal) return undefined;
    const body = pauseBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'mode: "ai", "all" o null.' });
    store.setSetting('pause', body.data.mode);
    auditAdmin(principal, 'pausar_vex', { modo: body.data.mode }, body.data.mode === 'all' ? 'Pausar todo Vex' : body.data.mode === 'ai' ? 'Pausar la IA (modo guion)' : 'Reanudar Vex');
    return { pause: body.data.mode };
  });

  // --- Announcements and quick actions: presentation data, served by the role in the token ---
  app.get('/engage/announcements', async (req, reply) => {
    const principal = await principalOf(req, reply);
    if (!principal) return undefined;
    return engage.announcementsFor(principal);
  });

  app.post('/engage/announcements/:id/seen', async (req, reply) => {
    const principal = await principalOf(req, reply);
    if (!principal) return undefined;
    if (!engage.markSeen(principal, (req.params as { id: string }).id)) return reply.code(404).send({ error: 'No hay ningún anuncio con ese id para ti.' });
    return { ok: true };
  });

  app.get('/engage/tours', async (req, reply) => {
    const principal = await principalOf(req, reply);
    if (!principal) return undefined;
    return engage.toursFor(principal);
  });

  app.post('/engage/tours/:id/done', async (req, reply) => {
    const principal = await principalOf(req, reply);
    if (!principal) return undefined;
    if (!engage.markTourDone(principal, (req.params as { id: string }).id)) return reply.code(404).send({ error: 'No hay ningún tour con ese id para ti.' });
    return { ok: true };
  });

  app.get('/engage/quick-actions', async (req, reply) => {
    const principal = await principalOf(req, reply);
    if (!principal) return undefined;
    const permitted = new Set((await currentTools()).map((t) => t.name));
    return engage.quickActionsFor(principal, permitted);
  });

  // A tool button is a one-call run through the operator loop: policy, confirmation, audit, history.
  app.post('/engage/quick-actions/:id/run', async (req, reply) => {
    const principal = await principalOf(req, reply);
    if (!principal) return undefined;
    const body = runBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Cuerpo inválido.' });
    const id = (req.params as { id: string }).id;
    const action = engage.quickActionsOn ? engage.quickAction(id) : undefined;
    if (!action || applicable([action], { role: principal.role, nowMs: Date.now() }).length === 0) return reply.code(404).send({ error: 'No hay ningún botón con ese id para ti.' });
    if (action.tool === undefined) return streamRun(req, reply, principal, body.data, { userMessage: action.prompt ?? action.label, provider: opts.provider, ai: true });
    const tool = action.tool;
    if (!(await currentTools()).some((t) => t.name === tool)) {
      const reason = `La política no permite ${tool}.`;
      store.recordAudit({ ts: new Date().toISOString(), sessionId: body.data.sessionId ?? 'boton', principal, actionId: crypto.randomUUID(), tool, driver: 'platform', risk: 'read', params: action.params ?? {}, summary: `Botón «${action.label}»`, outcome: 'denied', error: reason, durationMs: 0 });
      return reply.code(403).send({ error: reason });
    }
    return streamRun(req, reply, principal, body.data, { userMessage: `Botón: ${action.label}`, provider: new DirectProvider({ tool, params: action.params ?? {}, label: action.label }), ai: false });
  });

  // --- Approval links: the card outside the page. The token is the credential: short-lived, bound to one confirmation, single-use. ---
  const pendingFor = (token: string) => {
    const claim = approvalTokens.verify(token);
    if (!claim) return { kind: 'invalid' as const };
    const session = sessions.get(claim.sessionId);
    const pending = session?.pending.get(claim.actionId);
    if (!session || !pending || session.principal.id !== claim.principalId) return { kind: 'gone' as const };
    return { kind: 'pending' as const, session, pending };
  };
  const html = (reply: FastifyReply, code: number, body: string) => reply.code(code).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex').send(body);

  app.get('/approve/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const found = pendingFor(token);
    if (found.kind === 'invalid') return html(reply, 400, resultPage('invalid'));
    if (found.kind === 'gone') return html(reply, 410, resultPage('gone'));
    return html(reply, 200, approvalPage(found.pending.action, found.session.principal, `${publicUrl}/approve/${token}`));
  });

  for (const decision of ['approve', 'reject'] as const) {
    app.post(`/approve/:token/${decision}`, async (req, reply) => {
      const found = pendingFor((req.params as { token: string }).token);
      if (found.kind === 'invalid') return html(reply, 400, resultPage('invalid'));
      if (found.kind === 'gone') return html(reply, 410, resultPage('gone'));
      sessions.confirm(found.session.id, found.pending.action.id, decision === 'approve');
      return html(reply, 200, resultPage(decision === 'approve' ? 'approved' : 'rejected'));
    });
  }

  app.post('/operator/confirm', async (req, reply) => {
    const principal = await principalOf(req, reply);
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
    const principal = await principalOf(req, reply);
    if (!principal) return undefined;
    const body = stopBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Cuerpo inválido.' });
    const session = sessions.get(body.data.sessionId);
    if (!session || session.principal.id !== principal.id) return reply.code(404).send({ error: 'Sesión desconocida.' });
    return { stopped: sessions.stop(session) };
  });

  // --- Connectors: import, human review, refresh. Administrators only. ---
  const adminOf = async (req: FastifyRequest, reply: FastifyReply): Promise<Principal | null> => {
    const principal = await principalOf(req, reply);
    if (!principal) return null;
    if (principal.role !== 'admin') {
      void reply.code(403).send({ error: 'Solo un administrador puede conectar herramientas o aprobar sus riesgos.' });
      return null;
    }
    return principal;
  };
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof ConnectorError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof OutboundBlockedError) return reply.code(400).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
  };
  /** Connector changes go to the same audit trail as the operator's actions. */
  const auditAdmin = (principal: Principal, tool: string, params: Record<string, unknown>, summary: string) =>
    store.recordAudit({ ts: new Date().toISOString(), sessionId: 'admin', principal, actionId: crypto.randomUUID(), tool, driver: 'platform', risk: 'write', params, summary, outcome: 'ok', durationMs: 0 });

  // Connectors the manifest proposes enter as drafts, like a hand import: nothing reaches the model
  // until an administrator reviews them. An id already in the registry is left as the person left it;
  // a source that cannot be reached is reported, not fatal.
  app.addHook('onReady', async () => {
    for (const c of manifest?.connectors ?? []) {
      if (registry.list().some((m) => m.id === c.id)) {
        proposals.push({ id: c.id, status: 'existing' });
        continue;
      }
      try {
        const m =
          c.source.kind === 'openapi'
            ? await registry.importOpenApi({ id: c.id, url: c.source.url, ...(c.name ? { name: c.name } : {}), ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}), ...(c.auth ? { auth: c.auth } : {}), ...(c.filter ? { filter: c.filter } : {}) })
            : c.source.kind === 'mcp-http'
              ? await registry.importMcp({ id: c.id, transport: 'http', url: c.source.url, ...(c.name ? { name: c.name } : {}) })
              : await registry.importMcp({ id: c.id, transport: 'stdio', command: c.source.command, args: c.source.args, ...(c.name ? { name: c.name } : {}) });
        auditAdmin(MANIFEST_PRINCIPAL, 'importar_conector', { id: m.id, origen: 'manifiesto del host' }, `Proponer ${m.name} desde el manifiesto (${m.tools.length} herramientas, ninguna activa)`);
        proposals.push({ id: c.id, status: 'proposed' });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        app.log.warn(`El conector ${c.id} propuesto por el manifiesto no se pudo importar: ${error}`);
        proposals.push({ id: c.id, status: 'failed', error });
      }
    }
  });

  app.get('/connectors', async (req, reply) => {
    if (!await adminOf(req, reply)) return undefined;
    return registry.list();
  });

  app.post('/connectors/import/openapi', async (req, reply) => {
    const principal = await adminOf(req, reply);
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
    const principal = await adminOf(req, reply);
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
    const principal = await adminOf(req, reply);
    if (!principal) return undefined;
    try {
      const body = reviewBody.parse(req.body);
      const before = registry.get((req.params as { id: string }).id);
      const m = registry.review(before.id, body, principal.id);
      const on = body.decisions.filter((d) => d.enabled).length;
      auditAdmin(principal, 'revisar_conector', { id: m.id, decisiones: body.decisions }, `Revisar ${m.name}: ${on} activadas, ${body.decisions.length - on} desactivadas`);
      // Tools switched on are news: a draft announcement waits for an administrator to publish it.
      const draft = engage.draftFromReview(before, m, principal.id);
      if (draft) auditAdmin(principal, 'borrador_anuncio', { id: draft.id, conector: m.id }, `Borrador de anuncio: ${draft.title}`);
      return m;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/connectors/:id/refresh', async (req, reply) => {
    const principal = await adminOf(req, reply);
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
    const principal = await adminOf(req, reply);
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

  // Announcement drafts: administrators review what connector approvals wrote before anyone sees it.
  app.get('/engage/drafts', async (req, reply) => {
    if (!await adminOf(req, reply)) return undefined;
    return engage.drafts();
  });

  app.post('/engage/announcements/:id/publish', async (req, reply) => {
    const principal = await adminOf(req, reply);
    if (!principal) return undefined;
    const body = publishBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join('; ') });
    const published = engage.publish((req.params as { id: string }).id, body.data, principal.id);
    if (!published) return reply.code(404).send({ error: 'No hay ningún borrador con ese id.' });
    auditAdmin(principal, 'publicar_anuncio', { id: published.id }, `Publicar el anuncio «${published.title}»`);
    return published;
  });

  app.delete('/engage/announcements/:id', async (req, reply) => {
    const principal = await adminOf(req, reply);
    if (!principal) return undefined;
    const id = (req.params as { id: string }).id;
    if (!engage.remove(id)) return reply.code(404).send({ error: 'No hay ningún anuncio guardado con ese id (los del manifiesto se editan en el manifiesto).' });
    auditAdmin(principal, 'borrar_anuncio', { id }, `Borrar el anuncio ${id}`);
    return { ok: true };
  });

  app.get('/operator/audit', async (req, reply) => {
    const principal = await principalOf(req, reply);
    if (!principal) return undefined;
    const sessionId = (req.query as { sessionId?: string }).sessionId;
    return store.audit({ principalId: principal.id, ...(sessionId ? { sessionId } : {}) });
  });

  return app;
}
