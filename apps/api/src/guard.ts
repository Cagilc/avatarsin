import { isIP } from 'node:net';

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

/** True for addresses an import URL must not target: this machine, link-local and private ranges. */
export function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::' || h === '::1') return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('::ffff:');
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

export interface GuardedFetchOptions {
  policy: UrlPolicy;
  /** The fetch being wrapped. Default: the global one. */
  fetch?: typeof fetch;
  /** Resolves a hostname to every address it points to. Default: the system resolver. Injected in tests. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Redirect hops followed, each one checked again. */
  maxRedirects?: number;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
/** Headers that may travel to a different origin after a redirect; everything else (API keys included) is dropped. */
const PORTABLE_HEADERS = new Set(['accept', 'content-type']);

async function systemResolve(hostname: string): Promise<string[]> {
  const { lookup } = await import('node:dns/promises');
  return (await lookup(hostname, { all: true })).map((a) => a.address);
}

/**
 * A `fetch` for URLs that an administrator's input decides (OpenAPI import, calls to an imported
 * API, remote MCP). The hostname check in `checkOutboundUrl` alone is not enough: a public name can
 * resolve to a private address and a public server can redirect to one. This wrapper re-runs the
 * check on every hop, resolves the name and refuses it if any address is internal, follows
 * redirects by hand, and drops credentials when a redirect leaves the origin.
 *
 * Not covered: the name is resolved once here and again by the connection (DNS rebinding in that
 * window). Closing it needs a connection pinned to the checked address, e.g. an undici dispatcher.
 */
export function guardedFetch(opts: GuardedFetchOptions): typeof fetch {
  const inner = opts.fetch ?? fetch;
  const resolve = opts.resolve ?? systemResolve;
  const maxRedirects = opts.maxRedirects ?? 3;

  const assertAllowed = async (raw: string): Promise<URL> => {
    const reason = checkOutboundUrl(raw, opts.policy);
    if (reason) throw new Error(reason);
    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!opts.policy.allowInternal && isIP(host) === 0) {
      const addresses = await resolve(host);
      if (addresses.length === 0 || addresses.some(isInternalHost)) throw new Error('El nombre resuelve a esta máquina o a una red privada; no se permite.');
    }
    return url;
  };

  return async (input, init) => {
    let url = await assertAllowed(input instanceof Request ? input.url : String(input));
    let method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    let body = init?.body;
    let headers = new Headers(init?.headers);
    for (let hop = 0; ; hop += 1) {
      const res = await inner(url, { ...init, method, headers, ...(body !== undefined && body !== null ? { body } : {}), redirect: 'manual' });
      const location = res.headers.get('location');
      if (!REDIRECT_STATUS.has(res.status) || !location) return res;
      await res.body?.cancel();
      if (hop >= maxRedirects) throw new Error('Demasiadas redirecciones.');
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
