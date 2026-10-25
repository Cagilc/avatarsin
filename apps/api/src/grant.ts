import { NO_GRANT, grantExpired, grantMatchesHost, grantSchema, signedGrantSchema, type Grant, type HostAvatar } from '@vex/operator';
import { canonicalJson, fromBase64Url, importPublicKey } from '@vexstudio/format';

/**
 * The integration's grant: what the avatar's owner allowed this host to do, signed by the studio.
 * Vex Core fetches it from the integration endpoint named in the manifest, verifies it against the
 * public key the manifest pins, and applies it as the last layer of the permission rule. It is
 * short-lived, so a revoked integration stops working at the next refresh.
 */

export type GrantState = { status: 'ok'; grant: Grant } | { status: 'unavailable' | 'invalid' | 'expired' | 'foreign'; reason: string };

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Envelope, key id, signature, payload, host and expiry, in that order. The signature is checked over the payload as received. */
export async function verifySignedGrant(input: unknown, avatar: HostAvatar, domain: string, nowMs: number): Promise<GrantState> {
  const envelope = signedGrantSchema.safeParse(input);
  if (!envelope.success) return { status: 'invalid', reason: 'La respuesta del estudio no tiene la forma de un permiso firmado.' };
  if (envelope.data.keyId !== avatar.keyId) return { status: 'invalid', reason: 'El permiso está firmado con otra clave.' };
  let valid = false;
  try {
    const key = await importPublicKey(avatar.publicKey);
    valid = await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, key, fromBase64Url(envelope.data.signature), utf8(canonicalJson(envelope.data.grant)));
  } catch {
    valid = false;
  }
  if (!valid) return { status: 'invalid', reason: 'La firma del permiso no es válida: se ha modificado o no viene del estudio.' };
  const grant = grantSchema.safeParse(envelope.data.grant);
  if (!grant.success) return { status: 'invalid', reason: 'El permiso firmado no tiene el contenido esperado.' };
  if (!grantMatchesHost(grant.data, domain)) return { status: 'foreign', reason: `El permiso es para ${grant.data.origins.join(', ')}, no para ${domain}.` };
  if (grantExpired(grant.data, nowMs)) return { status: 'expired', reason: `El permiso caducó el ${grant.data.expiresAt}.` };
  return { status: 'ok', grant: grant.data };
}

export interface GrantClientOptions {
  avatar: HostAvatar;
  domain: string;
  /** Returns a reason when the endpoint is not a URL this server may fetch. */
  checkUrl?: (url: string) => string | null;
  fetch?: typeof fetch;
  now?: () => number;
  /** How long a verified grant is reused before asking the studio again. */
  refreshMs?: number;
}

const DEFAULT_REFRESH_MS = 60_000;

export class GrantClient {
  private readonly opts: GrantClientOptions;
  private readonly refreshMs: number;
  private readonly now: () => number;
  private state: GrantState = { status: 'unavailable', reason: 'Todavía no se ha pedido el permiso al estudio.' };
  private checkedAt = Number.NEGATIVE_INFINITY;
  private pending: Promise<GrantState> | null = null;

  constructor(opts: GrantClientOptions) {
    this.opts = opts;
    this.refreshMs = opts.refreshMs ?? DEFAULT_REFRESH_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * The grant to apply now. The last answer (a grant or a refusal) is reused for refreshMs, so a
   * studio that is down or has revoked the key is not asked on every message; a grant past its
   * expiry is asked for again at once. One request in flight at a time.
   */
  async current(): Promise<GrantState> {
    const now = this.now();
    const recent = now - this.checkedAt < this.refreshMs;
    if (recent && (this.state.status !== 'ok' || !grantExpired(this.state.grant, now))) return this.state;
    if (!this.pending) {
      this.pending = this.refresh().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  /** What the permission rule receives: the grant's tools and ceiling, or nothing at all. */
  static layer(state: GrantState): Pick<Grant, 'tools' | 'maxRisk'> {
    return state.status === 'ok' ? state.grant : NO_GRANT;
  }

  private async refresh(): Promise<GrantState> {
    const now = this.now();
    const url = `${this.opts.avatar.endpoint.replace(/\/$/, '')}/grant`;
    const blocked = this.opts.checkUrl?.(url);
    let next: GrantState;
    if (blocked) next = { status: 'unavailable', reason: `El endpoint del avatar no está permitido: ${blocked}` };
    else {
      try {
        const res = await (this.opts.fetch ?? fetch)(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
        if (res.status === 404 || res.status === 403) next = { status: 'unavailable', reason: `El estudio ya no reconoce la integración (HTTP ${res.status}): revocada o inexistente.` };
        else if (!res.ok) next = { status: 'unavailable', reason: `El estudio respondió HTTP ${res.status}.` };
        else next = await verifySignedGrant(await res.json(), this.opts.avatar, this.opts.domain, now);
      } catch (err) {
        // The studio answered nothing at all: keep a grant that is still within its life, drop anything else.
        const reason = `No se pudo pedir el permiso al estudio: ${err instanceof Error ? err.message : String(err)}`;
        next = this.state.status === 'ok' && !grantExpired(this.state.grant, now) ? this.state : { status: 'unavailable', reason };
      }
    }
    this.checkedAt = now;
    this.state = next;
    return next;
  }
}
