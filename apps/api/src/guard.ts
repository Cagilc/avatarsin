import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Origin policy. `allowedOrigins` is the exact list of pages that may call Vex Core from a
 * browser; everything else gets no CORS headers and, for state-changing requests, a 403.
 * Requests without an Origin header (curl, server to server, tests) are not browser requests
 * and pass; the token is their credential.
 */
export function originAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (origin === undefined) return true;
  return allowedOrigins.includes(origin);
}

/**
 * Everything that is not global unicast: this machine, private and link-local networks, carrier
 * NAT, documentation and benchmark ranges, multicast, reserved, and the IPv6 ranges that embed an
 * IPv4 address (mapped, NAT64, 6to4, Teredo). The rule is inverted on purpose: an address is
 * internal unless it is plainly public, so a range nobody listed is refused, not let through.
 */
const NOT_GLOBAL = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) NOT_GLOBAL.addSubnet(net, prefix, 'ipv4');
// IPv4-mapped addresses (::ffff:a.b.c.d) are judged by the IPv4 rules: BlockList maps them itself.
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) NOT_GLOBAL.addSubnet(net, prefix, 'ipv6');

/** True for hostnames and addresses an outbound request must not target. Judges DNS answers too. */
export function isInternalHost(hostname: string): boolean {
  // Brackets, a trailing dot ("localhost." is still localhost) and an IPv6 zone never change the target.
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '').replace(/%.*$/, '');
  if (h === '' || h === 'localhost' || h.endsWith('.localhost')) return true;
  const v = isIP(h);
  if (v === 4) return NOT_GLOBAL.check(h, 'ipv4');
  if (v === 6) return NOT_GLOBAL.check(h, 'ipv6');
  return false;
}

export interface UrlPolicy {
  /** Allow http (not only https). */
  allowHttp: boolean;
  /** Allow this machine and private networks as targets. Development only. */
  allowInternal: boolean;
}

/** Validates a URL the server will fetch on an administrator's request (OpenAPI import, MCP over HTTP). */
export function checkOutboundUrl(raw: string, policy: UrlPolicy): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'URL no válida.';
  }
  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) return 'Solo se admiten URL https.';
  if (url.username || url.password) return 'La URL no puede llevar credenciales.';
  if (!policy.allowInternal && isInternalHost(url.hostname)) return 'La URL apunta a esta máquina o a una red privada; no se permite.';
  return null;
}

/** A request the outbound guard refused: the caller's input is at fault, not the server. */
export class OutboundBlockedError extends Error {}

export interface GuardedFetchOptions {
  policy: UrlPolicy;
  /** The fetch being wrapped. Default: a fetch whose connections are pinned to the checked addresses. */
  fetch?: typeof fetch;
  /** Resolves a hostname to every address it points to. Default: the system resolver. Injected in tests. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Redirect hops followed, each one checked again. */
  maxRedirects?: number;
  /** TCP connect timeout of the pinned fetch. */
  connectTimeoutMs?: number;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
/** Headers that may travel to a different origin after a redirect; everything else (API keys included) is dropped. */
const PORTABLE_HEADERS = new Set(['accept', 'content-type']);

async function systemResolve(hostname: string): Promise<string[]> {
  const { lookup } = await import('node:dns/promises');
  return (await lookup(hostname, { all: true })).map((a) => a.address);
}

type LookupOptions = { all?: boolean | undefined; family?: number | string | undefined };
type LookupCallback = (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void;

/**
 * The DNS lookup of the pinned connection: a name resolves only to the addresses the guard
 * checked for it, so the socket cannot go anywhere the check did not see (DNS rebinding between
 * the check and the connection). A name nobody pinned is refused, except when the policy allows
 * internal targets (development), where the system resolver answers as usual.
 */
export function pinnedLookup(pins: ReadonlyMap<string, readonly string[]>, policy: UrlPolicy) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    const pinned = pins.get(hostname.toLowerCase().replace(/\.$/, ''));
    if (!pinned || pinned.length === 0) {
      if (policy.allowInternal) {
        const system = dnsLookup as unknown as (host: string, opts: LookupOptions, cb: LookupCallback) => void;
        system(hostname, { ...(options.all ? { all: true } : {}), ...(typeof options.family === 'number' ? { family: options.family } : {}) }, callback);
        return;
      }
      callback(new OutboundBlockedError(`Conexión a ${hostname} sin comprobar; no se permite.`), '');
      return;
    }
    const entries = pinned.map((address) => ({ address, family: isIP(address) }));
    if (options.all) callback(null, entries);
    else callback(null, entries[0]!.address, entries[0]!.family);
  };
}

/**
 * A `fetch` for URLs that an administrator's input decides (OpenAPI import, calls to an imported
 * API, remote MCP, the studio's grant, approval webhooks). The hostname check in
 * `checkOutboundUrl` alone is not enough: a public name can resolve to a private address and a
 * public server can redirect to one. This wrapper re-runs the check on every hop, resolves the
 * name and refuses it if any address is internal, follows redirects by hand, drops credentials
 * when a redirect leaves the origin and, unless a fetch is injected, connects only to the
 * addresses it checked (SNI and the Host header keep the original name).
 */
export function guardedFetch(opts: GuardedFetchOptions): typeof fetch {
  const resolve = opts.resolve ?? systemResolve;
  const maxRedirects = opts.maxRedirects ?? 3;
  const pins = new Map<string, string[]>();
  const inner: typeof fetch = opts.fetch ?? pinnedFetch(pins, opts.policy, opts.connectTimeoutMs);

  const assertAllowed = async (raw: string): Promise<URL> => {
    const reason = checkOutboundUrl(raw, opts.policy);
    if (reason) throw new OutboundBlockedError(reason);
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!opts.policy.allowInternal && isIP(host) === 0) {
      const addresses = await resolve(host);
      if (addresses.length === 0 || addresses.some(isInternalHost)) throw new OutboundBlockedError('El nombre resuelve a esta máquina o a una red privada; no se permite.');
      pins.set(host, addresses);
    }
    return url;
  };

  return async (input, init) => {
    // A Request object carries its own method, headers and body stream; nothing here uses one, and
    // following it blindly would silently lose them. Callers pass (url, init).
    if (input instanceof Request) throw new TypeError('guardedFetch acepta (url, init), no un objeto Request.');
    let url = await assertAllowed(String(input));
    let method = init?.method ?? 'GET';
    let body = init?.body;
    let headers = new Headers(init?.headers);
    for (let hop = 0; ; hop += 1) {
      const res = await inner(url, { ...init, method, headers, body: body ?? null, redirect: 'manual' });
      const location = res.headers.get('location');
      if (!REDIRECT_STATUS.has(res.status) || !location) return res;
      await res.body?.cancel();
      if (hop >= maxRedirects) throw new OutboundBlockedError('Demasiadas redirecciones.');
      const next = await assertAllowed(new URL(location, url).href);
      if (next.origin !== url.origin) {
        headers = new Headers([...headers].filter(([name]) => PORTABLE_HEADERS.has(name.toLowerCase())));
      }
      if (res.status !== 307 && res.status !== 308) {
        method = 'GET';
        body = undefined;
        headers.delete('content-type');
      }
      url = next;
    }
  };
}

/** undici's fetch over an agent whose connections resolve names through `pinnedLookup`. */
function pinnedFetch(pins: ReadonlyMap<string, readonly string[]>, policy: UrlPolicy, connectTimeoutMs = 10_000): typeof fetch {
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(pins, policy) as never, timeout: connectTimeoutMs } });
  return (async (input: string | URL, init?: RequestInit) => undiciFetch(input, { ...(init as object), dispatcher } as never)) as unknown as typeof fetch;
}
