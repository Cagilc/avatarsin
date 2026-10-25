import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  applyOps,
  emptyDocument,
  idSchema,
  parseDocument,
  RISKS,
  signPackage,
  toolNameSchema,
  type AssetRef,
  type Op,
  type Risk,
} from '@vexstudio/format';
import { z } from 'zod';
import type { Assistant, Proposal } from './assistant/index.ts';
import { bearer, hashPassword, MIN_PASSWORD, originAllowed, verifyPassword, type Principal, type TokenService } from './auth.ts';
import { RateLimiter } from './rateLimit.ts';
import { sanitizeUpload } from './sanitize.ts';
import type { Signer } from './signing.ts';
import type { EmbedKey, StudioStore } from './store.ts';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export interface StudioOptions {
  store: StudioStore;
  tokens: TokenService;
  signer: Signer;
  assistant: Assistant;
  /** Exact origins of the studio UI allowed to call /api from a browser. */
  allowedOrigins?: string[];
  /** Password-less login as the first owner. Local development only. */
  devLogin?: boolean;
  /** Public base URL of this server, used in the embed snippet (default http://localhost:8788). */
  publicUrl?: string;
  /** Path to the built <vex-avatar> script served to host pages. */
  runtimeBundle?: string | null;
  limits?: { loginPerMinute?: number; assistantPerMinute?: number; uploadsPerMinute?: number; embedPerMinute?: number };
  logger?: boolean;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PROPOSAL_TTL_MS = 30 * 60_000;
const RISK_ORDER: Record<Risk, number> = { read: 0, write: 1, irreversible: 2 };
/** Life of an integration grant: the host's backend asks again after this, so a revocation lands fast. */
const GRANT_TTL_MS = 10 * 60_000;

const loginBody = z.strictObject({ email: z.string().max(200), password: z.string().max(200) });
const createBody = z.strictObject({ name: z.string().trim().min(1).max(80) });
const opsBody = z.strictObject({ ops: z.array(z.unknown()).min(1).max(500), baseRevision: z.number().int().min(1), lock: z.boolean().optional(), summary: z.string().max(300).optional() });
const assistantBody = z.strictObject({ message: z.string().max(2000), answers: z.record(z.string().max(40), z.string().max(40)).optional() });
const acceptBody = z.strictObject({ baseRevision: z.number().int().min(1) });
const revertBody = z.strictObject({ revision: z.number().int().min(1), baseRevision: z.number().int().min(1) });
const keyBody = z.strictObject({
  label: z.string().trim().min(1).max(80),
  origins: z.array(z.string().max(200)).min(1).max(20),
  tools: z.array(toolNameSchema).max(200).optional(),
  maxRisk: z.enum(RISKS).optional(),
});
const userBody = z.strictObject({ email: z.string().email().max(200), name: z.string().trim().min(1).max(80), role: z.enum(['owner', 'editor']), password: z.string().min(MIN_PASSWORD).max(200) });

/** "https://app.example.com" exactly: no path, no credentials; http only for this machine. */
export function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function newAvatarId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return `${/^[a-z]/.test(slug) ? slug : `avatar-${slug}`}-${randomBytes(3).toString('hex')}`.replace(/-+/g, '-').slice(0, 40);
}

export function buildApp(opts: StudioOptions): FastifyInstance {
  const { store, tokens, signer, assistant } = opts;
  const allowedOrigins = opts.allowedOrigins ?? [];
  const limits = { loginPerMinute: 10, assistantPerMinute: 20, uploadsPerMinute: 30, embedPerMinute: 240, ...opts.limits };
  const loginLimiter = new RateLimiter(limits.loginPerMinute, 60_000);
  const assistantLimiter = new RateLimiter(limits.assistantPerMinute, 60_000);
  const uploadLimiter = new RateLimiter(limits.uploadsPerMinute, 60_000);
  const embedLimiter = new RateLimiter(limits.embedPerMinute, 60_000);
  const proposals = new Map<string, Proposal & { avatarId: string; baseRevision: number; userId: string; expires: number }>();
  const runtimeJs = opts.runtimeBundle && existsSync(opts.runtimeBundle) ? readFileSync(opts.runtimeBundle) : null;

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024, trustProxy: false });
  app.decorateRequest('principal', null);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  // ── origin policy and headers ──
  app.addHook('onRequest', async (req, reply) => {
    void reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer');
    const origin = req.headers.origin;
    if (req.url.startsWith('/api/')) {
      void reply.header('x-frame-options', 'DENY').header('cross-origin-resource-policy', 'same-site').header('cache-control', 'no-store');
      if (origin && allowedOrigins.includes(origin)) {
        void reply.header('access-control-allow-origin', origin).header('vary', 'Origin');
        if (req.method === 'OPTIONS') {
          return reply.header('access-control-allow-methods', 'GET, POST, DELETE').header('access-control-allow-headers', 'authorization, content-type').header('access-control-max-age', '600').code(204).send();
        }
      } else if (origin && (STATE_CHANGING.has(req.method) || req.method === 'OPTIONS')) {
        return reply.code(403).send({ error: 'Origen no permitido.' });
      }
    }
    return undefined;
  });

  // ── authentication for /api (except login) ──
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/login') || req.url.startsWith('/api/dev-login') || req.url === '/api/config') return;
    if (!originAllowed(req.headers.origin, allowedOrigins) && STATE_CHANGING.has(req.method)) return reply.code(403).send({ error: 'Origen no permitido.' });
    req.principal = tokens.verify(bearer(req.headers.authorization));
    if (!req.principal) return reply.code(401).send({ error: 'Inicia sesión.' });
    return undefined;
  });

  const me = (req: FastifyRequest) => req.principal!;
  const ownerOnly = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (me(req).role === 'owner') return true;
    void reply.code(403).send({ error: 'Solo el propietario puede hacer esto.' });
    return false;
  };
  const bad = (reply: FastifyReply, error: z.ZodError | string) => reply.code(400).send({ error: typeof error === 'string' ? error : error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  const avatarOr404 = (id: string, reply: FastifyReply) => {
    const a = idSchema.safeParse(id).success ? store.getAvatar(id) : null;
    if (!a) void reply.code(404).send({ error: 'No existe ese avatar.' });
    return a;
  };

  app.get('/health', async () => ({ ok: true }));

  // ── session ──
  app.get('/api/config', async () => ({ devLogin: Boolean(opts.devLogin), assistant: assistant.name, publicUrl: opts.publicUrl ?? 'http://localhost:8788', runtimeReady: runtimeJs !== null }));

  app.post('/api/login', async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    if (!loginLimiter.take(`${req.ip}|${body.data.email.toLowerCase()}`)) return reply.code(429).send({ error: 'Demasiados intentos. Espera un minuto.' });
    const user = store.userByEmail(body.data.email);
    // Same answer and similar time whether the account exists or not.
    const ok = user ? await verifyPassword(body.data.password, user.passwordHash) : (await hashPassword(body.data.password), false);
    if (!user || !ok) {
      store.audit(user?.id ?? '-', 'login.failed', body.data.email.toLowerCase().slice(0, 200));
      return reply.code(401).send({ error: 'Correo o contraseña incorrectos.' });
    }
    const principal: Principal = { id: user.id, email: user.email, name: user.name, role: user.role };
    store.audit(user.id, 'login', user.email);
    return { token: tokens.issue(principal), user: principal };
  });

  app.post('/api/dev-login', async (_req, reply) => {
    if (!opts.devLogin) return reply.code(404).send({ error: 'No disponible.' });
    let owner = store.firstOwner();
    if (!owner) {
      owner = { id: 'u-dev', email: 'dev@local', name: 'Desarrollo', role: 'owner' };
      store.addUser({ ...owner, passwordHash: await hashPassword(randomBytes(24).toString('base64url')) });
    }
    return { token: tokens.issue(owner), user: owner };
  });

  app.get('/api/me', async (req) => ({ user: me(req) }));

  app.post('/api/users', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const body = userBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    if (store.userByEmail(body.data.email)) return reply.code(409).send({ error: 'Ya existe una cuenta con ese correo.' });
    const id = `u-${randomBytes(6).toString('hex')}`;
    store.addUser({ id, email: body.data.email, name: body.data.name, role: body.data.role, passwordHash: await hashPassword(body.data.password) });
    store.audit(me(req).id, 'user.add', id, { role: body.data.role });
    return { id };
  });

  // ── avatars ──
  app.get('/api/avatars', async () => ({ avatars: store.listAvatars() }));

  app.post('/api/avatars', async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const doc = emptyDocument(newAvatarId(body.data.name), body.data.name);
    store.createAvatar(doc, me(req).id);
    store.audit(me(req).id, 'avatar.create', doc.id);
    return { id: doc.id, doc, revision: 1 };
  });

  app.get<{ Params: { id: string } }>('/api/avatars/:id', async (req, reply) => {
    const a = avatarOr404(req.params.id, reply);
    if (!a) return;
    return { doc: a.doc, revision: a.revision, published: store.publishedRevisions(a.id) };
  });

  app.post<{ Params: { id: string } }>('/api/avatars/:id/ops', async (req, reply) => {
    const a = avatarOr404(req.params.id, reply);
    if (!a) return;
    const body = opsBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    if (body.data.baseRevision !== a.revision) return reply.code(409).send({ error: 'El avatar ha cambiado desde que lo abriste.', revision: a.revision, doc: a.doc });
    if (me(req).role !== 'owner' && body.data.ops.some((o) => (o as { op?: string }).op === 'setCapabilities')) return reply.code(403).send({ error: 'Solo el propietario cambia las capacidades.' });
    const r = applyOps(a.doc, body.data.ops, 'user', { lock: body.data.lock });
    if (!r.ok) return reply.code(422).send({ error: 'Cambio no válido.', issues: r.issues });
    const summary = body.data.summary ?? describeOps(body.data.ops as Op[]);
    const revision = store.saveRevision(a.id, a.revision, r.doc, 'user', me(req).id, summary);
    if (revision === null) return reply.code(409).send({ error: 'El avatar ha cambiado desde que lo abriste.' });
    store.audit(me(req).id, 'avatar.ops', a.id, { revision, paths: r.paths.slice(0, 50) });
    return { doc: r.doc, revision };
  });

  app.get<{ Params: { id: string } }>('/api/avatars/:id/history', async (req, reply) => {
    const a = avatarOr404(req.params.id, reply);
    if (!a) return;
    return { history: store.history(a.id) };
  });

  app.post<{ Params: { id: string } }>('/api/avatars/:id/revert', async (req, reply) => {
    const a = avatarOr404(req.params.id, reply);
    if (!a) return;
    const body = revertBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const old = store.revisionDoc(a.id, body.data.revision);
    if (!old) return reply.code(404).send({ error: 'No existe esa versión.' });
    // Capabilities are never rolled back by an editor: they keep the current value.
    const restored = me(req).role === 'owner' ? old : { ...old, capabilities: a.doc.capabilities };
    const checked = parseDocument(restored);
    if (!checked.ok) return reply.code(422).send({ error: 'Esa versión ya no es válida.', issues: checked.issues });
    const revision = store.saveRevision(a.id, body.data.baseRevision, checked.doc, 'user', me(req).id, `Vuelta a la versión ${body.data.revision}`);
    if (revision === null) return reply.code(409).send({ error: 'El avatar ha cambiado desde que lo abriste.' });
    store.audit(me(req).id, 'avatar.revert', a.id, { to: body.data.revision, revision });
    return { doc: checked.doc, revision };
  });

  // ── assistant: proposals are drafts until a person accepts them ──
  app.post<{ Params: { id: string } }>('/api/avatars/:id/assistant', async (req, reply) => {
    const a = avatarOr404(req.params.id, reply);
    if (!a) return;
    const body = assistantBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    if (!assistantLimiter.take(me(req).id)) return reply.code(429).send({ error: 'Demasiadas peticiones al asistente. Espera un minuto.' });
    let proposal: Proposal;
    try {
      proposal = await assistant.propose({ doc: a.doc, message: body.data.message, answers: body.data.answers ?? {} });
    } catch (err) {
      req.log.error(err);
      return reply.code(502).send({ error: 'El asistente no ha podido preparar una propuesta.' });
    }
    // Validated now, so accepting cannot fail for reasons the person could not see.
    if (proposal.ops.length > 0) {
      const dry = applyOps(a.doc, proposal.ops, 'ai', { confidence: proposal.confidence });
      if (!dry.ok) return reply.code(502).send({ error: 'La propuesta del asistente no era válida.', issues: dry.issues });
    }
    const now = Date.now();
    for (const [k, p] of proposals) if (p.expires < now) proposals.delete(k);
    const id = randomBytes(12).toString('base64url');
    proposals.set(id, { ...proposal, avatarId: a.id, baseRevision: a.revision, userId: me(req).id, expires: now + PROPOSAL_TTL_MS });
    store.audit(me(req).id, 'assistant.propose', a.id, { provider: proposal.provider, ops: proposal.ops.length, questions: proposal.questions.map((q) => q.id) });
    return { id, ...proposal };
  });

  app.post<{ Params: { id: string; pid: string } }>('/api/avatars/:id/proposals/:pid/accept', async (req, reply) => {
    const a = avatarOr404(req.params.id, reply);
    if (!a) return;
    const body = acceptBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const p = proposals.get(req.params.pid);
    if (!p || p.avatarId !== a.id || p.expires < Date.now() || p.userId !== me(req).id) return reply.code(404).send({ error: 'Esa propuesta ya no existe; pide otra.' });
    if (p.baseRevision !== a.revision || body.data.baseRevision !== a.revision) return reply.code(409).send({ error: 'El avatar ha cambiado desde la propuesta; pide otra.' });
    const r = applyOps(a.doc, p.ops, 'ai', { confidence: p.confidence });
    if (!r.ok) return reply.code(422).send({ error: 'La propuesta ya no se puede aplicar.', issues: r.issues });
    const revision = store.saveRevision(a.id, a.revision, r.doc, 'ai', me(req).id, `Asistente: ${p.summary[0] ?? 'propuesta'}`);
    if (revision === null) return reply.code(409).send({ error: 'El avatar ha cambiado desde la propuesta.' });
    proposals.delete(req.params.pid);
    store.audit(me(req).id, 'assistant.accept', a.id, { revision, provider: p.provider });
    return { doc: r.doc, revision };
  });

  // ── assets ──
  app.post('/api/assets', async (req, reply) => {
    if (!uploadLimiter.take(me(req).id)) return reply.code(429).send({ error: 'Demasiadas subidas. Espera un minuto.' });
    if (!Buffer.isBuffer(req.body)) return bad(reply, 'Envía el archivo como application/octet-stream.');
    const clean = sanitizeUpload(req.body);
    if (!clean.ok) return reply.code(422).send({ error: clean.reason });
    const hash = createHash('sha256').update(clean.bytes).digest('hex');
    store.putAsset({ hash, type: clean.type, size: clean.bytes.length, width: clean.width, height: clean.height }, clean.bytes, me(req).id);
    store.audit(me(req).id, 'asset.upload', hash, { type: clean.type, size: clean.bytes.length });
    return { hash, type: clean.type, size: clean.bytes.length, width: clean.width, height: clean.height, kind: clean.type === 'image/png' ? 'png' : 'svg' };
  });

  const sendAsset = (reply: FastifyReply, row: { type: string; bytes: Buffer }) =>
    reply
      .header('content-type', row.type)
      // Never runs as a page, even if someone opens the URL directly.
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
      .send(row.bytes);

  app.get<{ Params: { hash: string } }>('/api/assets/:hash', async (req, reply) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.hash)) return reply.code(404).send({ error: 'No existe.' });
    const row = store.asset(req.params.hash);
    if (!row) return reply.code(404).send({ error: 'No existe.' });
    return sendAsset(reply, row);
  });

  // ── publishing (owner) ──
  app.post<{ Params: { id: string } }>('/api/avatars/:id/publish', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const a = avatarOr404(req.params.id, reply);
    if (!a) return;
    const problems: string[] = [];
    if (a.doc.parts.length === 0) problems.push('no tiene piezas');
    if (!a.doc.states.idle) problems.push('falta la animación de reposo');
    const assets: AssetRef[] = [];
    for (const source of a.doc.sources) {
      const meta = store.assetMeta(source.asset);
      if (!meta) problems.push(`falta el archivo de ${source.id}`);
      else if (!assets.some((x) => x.hash === meta.hash)) assets.push({ hash: meta.hash, type: meta.type, size: meta.size });
    }
    if (problems.length > 0) return reply.code(409).send({ error: `Aún no se puede publicar: ${problems.join(', ')}.` });
    const existing = store.latestPackage(a.id);
    if (existing?.revision === a.revision) return { revision: a.revision, keyId: existing.keyId, already: true };
    const pkg = await signPackage({ format: 'vex-avatar-package', packageVersion: 1, avatarId: a.id, revision: a.revision, publishedAt: new Date().toISOString(), document: a.doc, assets }, signer.privateKey, signer.publicKey);
    store.publish(pkg, me(req).id);
    store.audit(me(req).id, 'avatar.publish', a.id, { revision: a.revision });
    return { revision: a.revision, keyId: pkg.keyId };
  });

  // ── integrations (owner) ──
  app.get<{ Params: { id: string } }>('/api/avatars/:id/keys', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const a = avatarOr404(req.params.id, reply);
    if (!a) return;
    return { keys: store.keys(a.id), publicKey: signer.publicKey, keyId: signer.keyId };
  });

  app.post<{ Params: { id: string } }>('/api/avatars/:id/keys', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const a = avatarOr404(req.params.id, reply);
    if (!a) return;
    const body = keyBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const origins: string[] = [];
    for (const o of body.data.origins) {
      const n = normalizeOrigin(o);
      if (!n) return bad(reply, `Origen no válido: ${o}. Usa https://dominio (http solo para localhost), sin rutas.`);
      origins.push(n);
    }
    const key: EmbedKey = { id: `vk_${randomBytes(18).toString('base64url')}`, avatarId: a.id, label: body.data.label, origins: [...new Set(origins)], tools: body.data.tools ?? null, maxRisk: body.data.maxRisk ?? 'read', createdAt: new Date().toISOString(), revokedAt: null };
    store.addKey(key, me(req).id);
    store.audit(me(req).id, 'key.create', a.id, { key: key.id, origins: key.origins });
    return { key };
  });

  app.delete<{ Params: { key: string } }>('/api/keys/:key', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    if (!store.revokeKey(req.params.key)) return reply.code(404).send({ error: 'No existe o ya estaba revocada.' });
    store.audit(me(req).id, 'key.revoke', req.params.key);
    return { revoked: true };
  });

  app.get('/api/audit', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    return { audit: store.auditLog() };
  });

  // ── public: what host pages load ──
  app.get('/v1/public-key', async (_req, reply) => {
    void reply.header('access-control-allow-origin', '*').header('cross-origin-resource-policy', 'cross-origin');
    return { publicKey: signer.publicKey, keyId: signer.keyId };
  });

  app.get('/v1/vex-avatar.js', async (_req, reply) => {
    if (!runtimeJs) return reply.code(404).send({ error: 'Falta compilar el runtime (pnpm build).' });
    return reply.header('content-type', 'text/javascript; charset=utf-8').header('access-control-allow-origin', '*').header('cross-origin-resource-policy', 'cross-origin').header('cache-control', 'public, max-age=300').send(runtimeJs);
  });

  /** An integration may load the avatar only from its own origins, while the key is not revoked. */
  const embedGate = (req: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    void reply.header('cross-origin-resource-policy', 'cross-origin').header('vary', 'Origin');
    if (!/^vk_[A-Za-z0-9_-]{20,40}$/.test(req.params.key)) return void reply.code(404).send({ error: 'No existe.' });
    if (!embedLimiter.take(`${req.params.key}|${req.ip}`)) return void reply.code(429).send({ error: 'Demasiadas peticiones.' });
    const key = store.key(req.params.key);
    if (!key || key.revokedAt) return void reply.code(404).send({ error: 'Integración no válida o revocada.' });
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!key.origins.includes(origin)) return void reply.code(403).send({ error: 'Este sitio no está autorizado para mostrar el avatar.' });
      void reply.header('access-control-allow-origin', origin);
    }
    const pkg = store.latestPackage(key.avatarId);
    if (!pkg) return void reply.code(404).send({ error: 'El avatar aún no está publicado.' });
    return { key, pkg };
  };

  app.get<{ Params: { key: string } }>('/v1/embed/:key/package', async (req, reply) => {
    const gate = embedGate(req, reply);
    if (!gate) return;
    void reply.header('cache-control', 'no-cache');
    return gate.pkg;
  });

  app.get<{ Params: { key: string; hash: string } }>('/v1/embed/:key/assets/:hash', async (req, reply) => {
    const gate = embedGate(req, reply);
    if (!gate) return;
    // Only the files of the published version, nothing else in the store.
    if (!gate.pkg.assets.some((a) => a.hash === req.params.hash)) return reply.code(404).send({ error: 'No existe.' });
    const row = store.asset(req.params.hash);
    if (!row) return reply.code(404).send({ error: 'No existe.' });
    void reply.header('cache-control', 'public, max-age=31536000, immutable');
    return sendAsset(reply, row);
  });

  /**
   * For the host's backend (e.g. Vex Core): what this integration may do, signed by the studio.
   * Tools are the intersection of the avatar's capabilities and the key's ceiling; the risk is the
   * lower of both. An integration can only narrow what the owner approved. The grant expires
   * soon (GRANT_TTL_MS): the host's backend asks again, so a revoked key stops working within minutes.
   */
  app.get<{ Params: { key: string } }>('/v1/embed/:key/grant', async (req, reply) => {
    const gate = embedGate(req, reply);
    if (!gate) return;
    const parsed = parseDocument(gate.pkg.document);
    if (!parsed.ok) return reply.code(500).send({ error: 'Paquete no válido.' });
    const caps = parsed.doc.capabilities;
    const tools = gate.key.tools ? caps.tools.filter((t) => gate.key.tools!.includes(t)) : caps.tools;
    const maxRisk = RISK_ORDER[gate.key.maxRisk] < RISK_ORDER[caps.maxRisk] ? gate.key.maxRisk : caps.maxRisk;
    const issued = Date.now();
    const grant = {
      integration: gate.key.id,
      avatarId: gate.key.avatarId,
      revision: gate.pkg.revision,
      origins: gate.key.origins,
      tools,
      maxRisk,
      issuedAt: new Date(issued).toISOString(),
      expiresAt: new Date(issued + GRANT_TTL_MS).toISOString(),
    };
    void reply.header('cache-control', 'no-cache');
    return { grant, signature: await signer.sign(grant), keyId: signer.keyId };
  });

  return app;
}

/** A readable line for the history. */
export function describeOps(ops: Op[]): string {
  const counts = new Map<string, number>();
  for (const o of ops) counts.set(o.op, (counts.get(o.op) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ').slice(0, 300) || 'Cambio';
}
