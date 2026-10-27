import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature, type KeyObject } from 'node:crypto';
import { principalSchema, type HostIdentity as HostIdentityConfig, type Principal } from '@vex/operator';

/**
 * Verifies the host's own JWTs as the manifest's `identity` describes, so a person enters Vex
 * with the identity the host already gave them. Nothing here trusts the token's own claims about
 * how to verify it: the algorithm comes from the manifest, the key from the configured secret or
 * JWKS, and issuer, audience and expiry are always checked. A refusal carries a reason for the
 * server log, never for the client.
 */
export type VerifyResult = { ok: true; principal: Principal } | { ok: false; reason: string };

export interface IdentityDeps {
  env: Record<string, string | undefined>;
  /** Fetch for the JWKS document; the host passes the guarded one. */
  fetch?: typeof fetch;
  now?: () => number;
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  [k: string]: unknown;
}

const JWKS_TTL_MS = 10 * 60_000;
const JWKS_MIN_REFRESH_MS = 60_000;
const MAX_JWKS_BYTES = 1_000_000;
const ALG_KTY: Record<'RS256' | 'ES256', string> = { RS256: 'RSA', ES256: 'EC' };

function b64url(s: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  return Buffer.from(s, 'base64url');
}

function parseJson(buf: Buffer | null): Record<string, unknown> | null {
  if (!buf) return null;
  try {
    const v: unknown = JSON.parse(buf.toString('utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class HostIdentity {
  readonly kind: HostIdentityConfig['kind'];
  private readonly cfg: HostIdentityConfig;
  private readonly deps: IdentityDeps;
  private keys = new Map<string, { key: KeyObject; alg: 'RS256' | 'ES256' }>();
  private fetchedAt = 0;
  private pending: Promise<void> | null = null;

  constructor(cfg: HostIdentityConfig, deps: IdentityDeps) {
    this.cfg = cfg;
    this.deps = deps;
    this.kind = cfg.kind;
  }

  async verify(token: string | undefined): Promise<VerifyResult> {
    if (!token) return { ok: false, reason: 'sin token' };
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'no es un JWT' };
    const [h, p, s] = parts as [string, string, string];
    const header = parseJson(b64url(h));
    const payload = parseJson(b64url(p));
    const signature = b64url(s);
    if (!header || !payload || !signature || signature.length === 0) return { ok: false, reason: 'JWT mal formado' };
    const alg = typeof header['alg'] === 'string' ? header['alg'] : '';
    const signed = await this.checkSignature(alg, typeof header['kid'] === 'string' ? header['kid'] : undefined, `${h}.${p}`, signature);
    if (signed) return { ok: false, reason: signed };
    const claims = this.checkClaims(payload);
    if (typeof claims === 'string') return { ok: false, reason: claims };
    return { ok: true, principal: claims };
  }

  /** Returns a reason when the signature is not acceptable; null when it is. */
  private async checkSignature(alg: string, kid: string | undefined, input: string, signature: Buffer): Promise<string | null> {
    if (this.cfg.kind === 'hs256') {
      if (alg !== 'HS256') return `alg ${alg || 'ausente'}, la identidad del host usa HS256`;
      const secret = this.deps.env[this.cfg.secretEnv];
      if (!secret) return `falta ${this.cfg.secretEnv} en el entorno`;
      const expected = createHmac('sha256', secret).update(input).digest();
      return expected.length === signature.length && timingSafeEqual(expected, signature) ? null : 'firma no válida';
    }
    if (alg !== 'RS256' && alg !== 'ES256') return `alg ${alg || 'ausente'} no admitido`;
    if (!this.cfg.algorithms.includes(alg)) return `alg ${alg} no está entre los admitidos por el manifiesto`;
    let entry = await this.keyFor(kid, false);
    if (!entry) entry = await this.keyFor(kid, true);
    if (!entry) return kid ? `clave ${kid} desconocida en el JWKS` : 'el JWKS no tiene una clave única sin kid';
    if (entry.alg !== alg) return `la clave ${kid ?? ''} es para ${entry.alg}, no para ${alg}`;
    const ok = alg === 'ES256' ? verifySignature('sha256', Buffer.from(input), { key: entry.key, dsaEncoding: 'ieee-p1363' }, signature) : verifySignature('sha256', Buffer.from(input), entry.key, signature);
    return ok ? null : 'firma no válida';
  }

  private checkClaims(payload: Record<string, unknown>): Principal | string {
    const now = (this.deps.now ?? Date.now)() / 1000;
    const leeway = this.cfg.leewaySeconds;
    const exp = payload['exp'];
    if (typeof exp !== 'number') return 'sin exp';
    if (exp + leeway < now) return 'caducado';
    const nbf = payload['nbf'];
    if (typeof nbf === 'number' && nbf - leeway > now) return 'todavía no es válido (nbf)';
    if (payload['iss'] !== this.cfg.issuer) return `emisor ${String(payload['iss'] ?? 'ausente')} distinto de ${this.cfg.issuer}`;
    const aud = payload['aud'];
    const audiences = Array.isArray(aud) ? aud : [aud];
    if (!audiences.includes(this.cfg.audience)) return `audiencia ${JSON.stringify(aud ?? null)} no incluye ${this.cfg.audience}`;

    const { id: idClaim, name: nameClaim, role: roleClaim, roles, defaultRole } = this.cfg.claims;
    const rawId = payload[idClaim];
    const id = typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : '';
    if (!id) return `sin claim ${idClaim}`;
    const rawName = payload[nameClaim];
    const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : id;
    const rawRole = payload[roleClaim];
    const candidates = (Array.isArray(rawRole) ? rawRole : [rawRole]).filter((r): r is string => typeof r === 'string' && r.length > 0);
    let role: string | undefined;
    if (candidates.length === 0) role = defaultRole;
    else if (roles) role = candidates.map((r) => roles[r]).find((r): r is string => r !== undefined);
    else role = candidates[0];
    if (!role) return candidates.length ? `papel ${candidates.join('/')} sin correspondencia en claims.roles` : `sin claim ${roleClaim} y sin defaultRole`;
    const parsed = principalSchema.safeParse({ id, name, role });
    return parsed.success ? parsed.data : 'principal no válido';
  }

  /** The key for a kid (or the only key when the token names none), refreshing the JWKS when asked and allowed. */
  private async keyFor(kid: string | undefined, refresh: boolean): Promise<{ key: KeyObject; alg: 'RS256' | 'ES256' } | null> {
    const now = (this.deps.now ?? Date.now)();
    const stale = now - this.fetchedAt > JWKS_TTL_MS;
    const mayRefresh = now - this.fetchedAt > JWKS_MIN_REFRESH_MS;
    if (stale || (refresh && mayRefresh)) this.pending ??= this.load().finally(() => (this.pending = null));
    // Concurrent verifications share one fetch: whoever finds it in flight waits for it.
    if (this.pending) await this.pending;
    if (kid) return this.keys.get(kid) ?? null;
    return this.keys.size === 1 ? [...this.keys.values()][0]! : null;
  }

  private async load(): Promise<void> {
    if (this.cfg.kind !== 'jwks') return;
    this.fetchedAt = (this.deps.now ?? Date.now)();
    try {
      const res = await (this.deps.fetch ?? fetch)(this.cfg.url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_JWKS_BYTES) throw new Error('JWKS demasiado grande');
      const doc = JSON.parse(text) as { keys?: unknown };
      const list = Array.isArray(doc.keys) ? (doc.keys as Jwk[]) : [];
      const next = new Map<string, { key: KeyObject; alg: 'RS256' | 'ES256' }>();
      for (const jwk of list) {
        if (typeof jwk !== 'object' || jwk === null || (jwk.use && jwk.use !== 'sig')) continue;
        const alg: 'RS256' | 'ES256' | null = jwk.alg === 'RS256' || jwk.alg === 'ES256' ? jwk.alg : jwk.kty === 'RSA' ? 'RS256' : jwk.kty === 'EC' && jwk['crv'] === 'P-256' ? 'ES256' : null;
        if (!alg || jwk.kty !== ALG_KTY[alg]) continue;
        try {
          const key = createPublicKey({ key: jwk as never, format: 'jwk' });
          next.set(typeof jwk.kid === 'string' ? jwk.kid : `#${next.size}`, { key, alg });
        } catch {
          // A key that does not import is skipped; the others still serve.
        }
      }
      this.keys = next;
    } catch {
      // Keep what we had: a JWKS outage must not log everyone out while the cached keys are valid.
    }
  }
}
