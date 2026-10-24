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
