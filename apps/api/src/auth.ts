import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { principalSchema, type Principal } from '@vex/operator';

/**
 * Session tokens: `v1.<payload>.<signature>`, payload = base64url JSON {principal, exp},
 * signature = HMAC-SHA256 with the server secret. Only this server can mint one, and a token
 * cannot be edited (e.g. to change the role) without invalidating the signature.
 *
 * Swap point for the real platform: verify its JWT instead and map claims → Principal.
 */
export interface TokenPayload {
  principal: Principal;
  /** Unix seconds. */
  exp: number;
}

const DEFAULT_TTL_S = 8 * 3600;

export class TokenService {
  private readonly secret: Buffer;
  private readonly now: () => number;

  constructor(secret: string | Buffer, now: () => number = () => Date.now()) {
    const buf = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret;
    if (buf.length < 32) throw new Error('El secreto de los tokens debe tener al menos 32 bytes (VEX_TOKEN_SECRET).');
    this.secret = buf;
    this.now = now;
  }

  /** A random secret for processes that did not configure one (tokens die with the process). */
  static ephemeral(now?: () => number): TokenService {
    return new TokenService(randomBytes(32), now);
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  issue(principal: Principal, ttlSeconds = DEFAULT_TTL_S): string {
    const body: TokenPayload = { principal, exp: Math.floor(this.now() / 1000) + ttlSeconds };
    const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
    return `v1.${payload}.${this.sign(payload)}`;
  }

  verify(token: string | undefined): Principal | null {
    if (!token) return null;
    const [version, payload, signature] = token.split('.');
    if (version !== 'v1' || !payload || !signature) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<TokenPayload>;
      if (typeof body.exp !== 'number' || body.exp * 1000 < this.now()) return null;
      const parsed = principalSchema.safeParse(body.principal);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

export function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}

/** Demo users the mock platform knows. The demo login that issues their tokens is off outside local development. */
export const DEMO_USERS: Principal[] = [
  { id: 'u-cesar', name: 'César Gil', role: 'admin' },
  { id: 'u-ana', name: 'Ana Ruiz', role: 'gestora' },
];
