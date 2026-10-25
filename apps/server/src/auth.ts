import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';

/**
 * The studio is private: only accounts created on this server can enter (no sign-up). The owner
 * can do everything; an editor designs avatars but cannot publish, change capabilities or manage
 * integrations.
 */
export const ROLES = ['owner', 'editor'] as const;
export type Role = (typeof ROLES)[number];

export const principalSchema = z.strictObject({
  id: z.string().min(1).max(64),
  email: z.string().max(200),
  name: z.string().max(80),
  role: z.enum(ROLES),
});
export type Principal = z.infer<typeof principalSchema>;

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** `scrypt$<salt>$<hash>`, both base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const given = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, SCRYPT);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const MIN_PASSWORD = 12;

interface TokenPayload {
  principal: Principal;
  /** Unix seconds. */
  exp: number;
}

const DEFAULT_TTL_S = 8 * 3600;

/** Session tokens `v1.<payload>.<hmac>`: only this server can mint one, and none can be edited. */
export class TokenService {
  private readonly secret: Buffer;
  private readonly now: () => number;

  constructor(secret: string | Buffer, now: () => number = () => Date.now()) {
    const buf = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret;
    if (buf.length < 32) throw new Error('El secreto de los tokens debe tener al menos 32 bytes (STUDIO_TOKEN_SECRET).');
    this.secret = buf;
    this.now = now;
  }

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

/** Origins allowed to call the studio API from a browser; requests without Origin are not browsers. */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  return origin === undefined || allowed.includes(origin);
}
