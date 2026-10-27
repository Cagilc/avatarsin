import { afterEach, describe, expect, it } from 'vitest';
import { ScriptedProvider } from '@vex/operator';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from './app.ts';
import { TokenService } from './auth.ts';
import { checkOutboundUrl, guardedFetch, isInternalHost, originAllowed } from './guard.ts';
import { MockPlatform } from './platform/mock.ts';
import { MemoryStore } from './storage.ts';

const PAGE = 'http://localhost:5174';
const SECRET = 'un-secreto-de-pruebas-con-mas-de-treinta-y-dos-bytes';

describe('session tokens', () => {
  let now = Date.parse('2026-10-24T10:00:00Z');
  const tokens = new TokenService(SECRET, () => now);
  const cesar = { id: 'u-cesar', name: 'César Gil', role: 'admin' };

  it('round-trips a principal and rejects every tampered or foreign token', () => {
    const token = tokens.issue(cesar);
    expect(tokens.verify(token)).toEqual(cesar);
    const [v, payload, sig] = token.split('.') as [string, string, string];
    // Same principal with the role changed, re-encoded: the signature no longer matches.
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), principal: { ...cesar, role: 'superadmin' } })).toString('base64url');
    expect(tokens.verify(`${v}.${edited}.${sig}`)).toBeNull();
    expect(tokens.verify(`${v}.${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(tokens.verify(new TokenService(`${SECRET}-otro-servidor`).issue(cesar))).toBeNull();
    expect(tokens.verify('demo.eyJpZCI6InUtY2VzYXIifQ')).toBeNull();
    expect(tokens.verify('')).toBeNull();
  });

  it('expires', () => {
    const token = tokens.issue(cesar, 60);
    now += 61_000;
    expect(tokens.verify(token)).toBeNull();
  });

  it('refuses a weak secret', () => {
    expect(() => new TokenService('corto')).toThrow(/32 bytes/);
  });
});

describe('outbound URL policy', () => {
  it('knows this machine and private networks', () => {
    for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '10.0.0.5', '192.168.1.20', '172.16.0.1', '172.31.255.1', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', 'api.localhost']) {
      expect(isInternalHost(h), h).toBe(true);
    }
    // 2001:db8::/32 is the documentation range: not global unicast, so it counts as internal now.
    for (const h of ['api.ejemplo.com', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isInternalHost(h), h).toBe(false);
  });

  it('allows only https to public hosts by default', () => {
    const strict = { allowHttp: false, allowInternal: false };
    expect(checkOutboundUrl('https://api.ejemplo.com/openapi.json', strict)).toBeNull();
    expect(checkOutboundUrl('http://api.ejemplo.com/openapi.json', strict)).toMatch(/https/);
    expect(checkOutboundUrl('https://127.0.0.1:8790/openapi.json', strict)).toMatch(/esta máquina/);
    expect(checkOutboundUrl('https://user:pass@api.ejemplo.com/', strict)).toMatch(/credenciales/);
    expect(checkOutboundUrl('no es una url', strict)).toMatch(/no válida/);
    expect(checkOutboundUrl('http://127.0.0.1:8790/openapi.json', { allowHttp: true, allowInternal: true })).toBeNull();
  });

  it('treats a missing Origin as a non-browser caller and anything else by the list', () => {
    expect(originAllowed(undefined, [PAGE])).toBe(true);
    expect(originAllowed(PAGE, [PAGE])).toBe(true);
    expect(originAllowed('http://localhost:5175', [PAGE])).toBe(false);
    expect(originAllowed('null', [PAGE])).toBe(false);
    expect(originAllowed(PAGE, [])).toBe(false);
  });
});

describe('Vex Core from a browser', () => {
  let app: FastifyInstance;

  async function start(extra: Partial<AppOptions> = {}) {
    app = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(), store: new MemoryStore(), demoLogin: true, allowedOrigins: [PAGE], ...extra });
    await app.ready();
  }
  afterEach(async () => {
    await app?.close();
  });

  const login = (origin?: string) => app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-cesar' }, headers: origin ? { origin } : {} });

  it('serves the allowed page and refuses every other origin on state-changing requests', async () => {
    await start();
    const ok = await login(PAGE);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe(PAGE);
    const token = (ok.json() as { token: string }).token;

    const stranger = await login('http://localhost:5175');
    expect(stranger.statusCode).toBe(403);
    expect(stranger.headers['access-control-allow-origin']).toBeUndefined();

    const preflight = await app.inject({ method: 'OPTIONS', url: '/operator/chat', headers: { origin: 'http://localhost:5175', 'access-control-request-method': 'POST' } });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

    // Reads from an unknown origin get no CORS headers either, so the browser withholds the response.
    const read = await app.inject({ method: 'GET', url: '/operator/info', headers: { origin: 'http://localhost:5175' } });
    expect(read.headers['access-control-allow-origin']).toBeUndefined();

    // The event stream is a raw response: it carries the header only for the allowed page.
    const stream = await app.inject({ method: 'POST', url: '/operator/chat', headers: { authorization: `Bearer ${token}`, origin: PAGE }, payload: { message: 'Busca a Laura' } });
    expect(stream.headers['access-control-allow-origin']).toBe(PAGE);
    expect(stream.headers['vary']).toBe('Origin');
  });

  it('non-browser callers (no Origin) are judged by their token alone', async () => {
    await start();
    const token = ((await login()).json() as { token: string }).token;
    expect((await app.inject({ method: 'GET', url: '/platform/estado', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/platform/estado', headers: { authorization: 'Bearer demo.eyJpZCI6InUtY2VzYXIiLCJuYW1lIjoiWCIsInJvbGUiOiJhZG1pbiJ9' } })).statusCode).toBe(401);
  });

  it('has no demo login unless enabled, and no browser access with an empty origin list', async () => {
    await start({ demoLogin: false });
    expect((await login()).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/platform/auth/demo-users' })).statusCode).toBe(404);
    await app.close();

    await start({ allowedOrigins: [] });
    expect((await login(PAGE)).statusCode).toBe(403);
  });

  it('refuses to import a specification from this machine unless the policy allows it', async () => {
    await start();
    const token = ((await login()).json() as { token: string }).token;
    const res = await app.inject({ method: 'POST', url: '/connectors/import/openapi', headers: { authorization: `Bearer ${token}` }, payload: { id: 'citas', url: 'http://127.0.0.1:8790/openapi.json' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('https') });
    const meta = await app.inject({ method: 'POST', url: '/connectors/import/openapi', headers: { authorization: `Bearer ${token}` }, payload: { id: 'meta', url: 'https://169.254.169.254/latest/' } });
    expect(meta.json()).toMatchObject({ error: expect.stringContaining('esta máquina') });
  });
});

describe('guarded outbound fetch', () => {
  const strict = { allowHttp: false, allowInternal: false };
  const ok = () => new Response('{}', { status: 200 });
  const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });
  const pub = async () => ['93.184.216.34'];

  it('refuses a public name that resolves to a private address', async () => {
    const calls: string[] = [];
    const f = guardedFetch({ policy: strict, resolve: async () => ['10.0.0.8'], fetch: async (u) => (calls.push(String(u)), ok()) });
    await expect(f('https://api.ejemplo.com/spec.json')).rejects.toThrow(/resuelve/);
    expect(calls).toEqual([]);
  });

  it('refuses a name when any of its addresses is internal', async () => {
    const f = guardedFetch({ policy: strict, resolve: async () => ['93.184.216.34', '169.254.169.254'], fetch: async () => ok() });
    await expect(f('https://api.ejemplo.com/')).rejects.toThrow(/resuelve/);
  });

  it('checks every redirect hop, not only the first URL', async () => {
    const calls: string[] = [];
    const f = guardedFetch({
      policy: strict,
      resolve: pub,
      fetch: async (u) => (calls.push(String(u)), calls.length === 1 ? redirect('https://169.254.169.254/latest/meta-data/') : ok()),
    });
    await expect(f('https://api.ejemplo.com/spec.json')).rejects.toThrow(/esta máquina/);
    expect(calls).toEqual(['https://api.ejemplo.com/spec.json']);
  });

  it('follows a safe redirect and stops after too many', async () => {
    let n = 0;
    const f = guardedFetch({ policy: strict, resolve: pub, fetch: async () => (n++ === 0 ? redirect('/v2/spec.json') : ok()) });
    expect((await f('https://api.ejemplo.com/spec.json')).status).toBe(200);
    const loop = guardedFetch({ policy: strict, resolve: pub, fetch: async () => redirect('/again') });
    await expect(loop('https://api.ejemplo.com/')).rejects.toThrow(/redirecciones/);
  });

  it('drops credentials when a redirect leaves the origin, keeps them on the same origin', async () => {
    const seen: Array<string | null> = [];
    const f = guardedFetch({
      policy: strict,
      resolve: pub,
      fetch: async (_u, init) => {
        seen.push(new Headers(init?.headers).get('x-api-key'));
        return seen.length === 1 ? redirect('/same') : seen.length === 2 ? redirect('https://cdn.ejemplo.net/x') : ok();
      },
    });
    await f('https://api.ejemplo.com/', { headers: { 'x-api-key': 'secreto', accept: 'application/json' } });
    expect(seen).toEqual(['secreto', 'secreto', null]);
  });

  it('skips name resolution only when internal targets are allowed (development)', async () => {
    const f = guardedFetch({ policy: { allowHttp: true, allowInternal: true }, resolve: async () => { throw new Error('no debe resolver'); }, fetch: async () => ok() });
    expect((await f('http://localhost:8790/openapi.json')).status).toBe(200);
  });
});
