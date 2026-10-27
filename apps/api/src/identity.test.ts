import { createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ScriptedProvider, hostManifestSchema, type HostIdentity as IdentityConfig } from '@vex/operator';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { HostIdentity } from './identity.ts';
import { MockPlatform } from './platform/mock.ts';
import { MemoryStore } from './storage.ts';

// Tokens are built here with node:crypto, so every rejection is a real one: a wrong key, a wrong
// algorithm, a claim that does not match, not a fake verifier saying so.

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const now = () => NOW;
const sec = Math.floor(NOW / 1000);

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwt(header: Record<string, unknown>, payload: Record<string, unknown>, signer: (input: string) => Buffer): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${signer(input).toString('base64url')}`;
}
const rs256 = (key: KeyObject) => (input: string) => sign('sha256', Buffer.from(input), key);
const es256 = (key: KeyObject) => (input: string) => sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
const hs256 = (secret: string) => (input: string) => createHmac('sha256', secret).update(input).digest();

const claims = (over: Record<string, unknown> = {}) => ({ iss: 'https://host.example', aud: 'vex', sub: 'u-42', name: 'Laura Pérez', role: 'staff', exp: sec + 600, ...over });
const jwksDoc = () => ({
  keys: [
    { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'k-rsa', alg: 'RS256', use: 'sig' },
    { ...ec.publicKey.export({ format: 'jwk' }), kid: 'k-ec', alg: 'ES256', use: 'sig' },
  ],
});

/** Builds the identity through the manifest schema, so the defaults are the real ones. */
function identity(over: Record<string, unknown> & { kind: IdentityConfig['kind'] }, fetchJwks: typeof fetch = async () => new Response(JSON.stringify(jwksDoc()))): HostIdentity {
  const cfg = hostManifestSchema.parse({
    format: 'vex-host',
    version: 1,
    host: { name: 'Host', domain: 'host.example' },
    identity: { issuer: 'https://host.example', audience: 'vex', ...(over.kind === 'jwks' ? { url: 'https://host.example/jwks.json' } : { secretEnv: 'HOST_JWT_SECRET' }), ...over },
  }).identity!;
  return new HostIdentity(cfg, { env: { HOST_JWT_SECRET: 'un-secreto-compartido-de-verdad' }, fetch: fetchJwks, now });
}

describe('host identity: JWT verified as the manifest says', () => {
  it('accepts RS256 and ES256 tokens signed by the keys in the JWKS, mapping claims to a principal', async () => {
    const id = identity({ kind: 'jwks', claims: { roles: { owner: 'admin', staff: 'gestora' } } });
    expect(await id.verify(jwt({ alg: 'RS256', kid: 'k-rsa' }, claims(), rs256(rsa.privateKey)))).toEqual({ ok: true, principal: { id: 'u-42', name: 'Laura Pérez', role: 'gestora' } });
    expect(await id.verify(jwt({ alg: 'ES256', kid: 'k-ec' }, claims({ role: ['viewer', 'owner'] }), es256(ec.privateKey)))).toEqual({ ok: true, principal: { id: 'u-42', name: 'Laura Pérez', role: 'admin' } });
  });

  it('refuses a wrong signature, another key, an unlisted algorithm, "none" and HS256 against a JWKS', async () => {
    const id = identity({ kind: 'jwks', algorithms: ['RS256'] });
    const reasons = await Promise.all([
      id.verify(jwt({ alg: 'RS256', kid: 'k-rsa' }, claims(), rs256(other.privateKey))),
      id.verify(`${jwt({ alg: 'RS256', kid: 'k-rsa' }, claims(), rs256(rsa.privateKey))}x`),
      id.verify(jwt({ alg: 'ES256', kid: 'k-ec' }, claims(), es256(ec.privateKey))),
      id.verify(jwt({ alg: 'none' }, claims(), () => Buffer.from('a'))),
      id.verify(jwt({ alg: 'HS256' }, claims(), hs256('un-secreto-compartido-de-verdad'))),
      id.verify(jwt({ alg: 'RS256', kid: 'k-otra' }, claims(), rs256(rsa.privateKey))),
      id.verify('no.es.jwt.valido'),
      id.verify(undefined),
    ]);
    expect(reasons.map((r) => (r.ok ? 'OK' : r.reason))).toEqual([
      'firma no válida',
      'firma no válida',
      'alg ES256 no está entre los admitidos por el manifiesto',
      'alg none no admitido',
      'alg HS256 no admitido',
      'clave k-otra desconocida en el JWKS',
      'no es un JWT',
      'sin token',
    ]);
  });

  it('checks expiry, nbf, issuer and audience (string or list), with the configured leeway', async () => {
    const id = identity({ kind: 'jwks', leewaySeconds: 30 });
    const tok = (c: Record<string, unknown>) => id.verify(jwt({ alg: 'RS256', kid: 'k-rsa' }, claims(c), rs256(rsa.privateKey)));
    expect(await tok({ exp: sec - 31 })).toEqual({ ok: false, reason: 'caducado' });
    expect((await tok({ exp: sec - 29 })).ok).toBe(true);
    expect(await tok({ exp: undefined })).toEqual({ ok: false, reason: 'sin exp' });
    expect(await tok({ nbf: sec + 31 })).toEqual({ ok: false, reason: 'todavía no es válido (nbf)' });
    expect(await tok({ iss: 'https://otro.example' })).toEqual({ ok: false, reason: 'emisor https://otro.example distinto de https://host.example' });
    expect(await tok({ aud: ['app', 'vex'] })).toMatchObject({ ok: true });
    expect(await tok({ aud: ['app'] })).toEqual({ ok: false, reason: 'audiencia ["app"] no incluye vex' });
  });

  it('maps the role: listed values only when there is a map, the default when the claim is missing, refused otherwise', async () => {
    const mapped = identity({ kind: 'jwks', claims: { role: 'groups', roles: { owner: 'admin' } } });
    const tok = (id: HostIdentity, c: Record<string, unknown>) => id.verify(jwt({ alg: 'RS256', kid: 'k-rsa' }, claims(c), rs256(rsa.privateKey)));
    expect(await tok(mapped, { groups: ['owner'] })).toMatchObject({ ok: true, principal: { role: 'admin' } });
    expect(await tok(mapped, { groups: ['staff'] })).toEqual({ ok: false, reason: 'papel staff sin correspondencia en claims.roles' });
    expect(await tok(mapped, {})).toEqual({ ok: false, reason: 'sin claim groups y sin defaultRole' });
    const defaulted = identity({ kind: 'jwks', claims: { id: 'uid', name: 'given_name', defaultRole: 'gestora' } });
    expect(await tok(defaulted, { uid: 7, given_name: '  ', role: undefined })).toEqual({ ok: true, principal: { id: '7', name: '7', role: 'gestora' } });
    expect(await tok(defaulted, { uid: undefined })).toEqual({ ok: false, reason: 'sin claim uid' });
  });

  it('shared secret: HS256 with the secret named by the manifest, never one written in it', async () => {
    const id = identity({ kind: 'hs256' });
    expect(await id.verify(jwt({ alg: 'HS256' }, claims(), hs256('un-secreto-compartido-de-verdad')))).toMatchObject({ ok: true, principal: { id: 'u-42', role: 'staff' } });
    expect(await id.verify(jwt({ alg: 'HS256' }, claims(), hs256('otro')))).toEqual({ ok: false, reason: 'firma no válida' });
    expect(await id.verify(jwt({ alg: 'RS256', kid: 'k-rsa' }, claims(), rs256(rsa.privateKey)))).toEqual({ ok: false, reason: 'alg RS256, la identidad del host usa HS256' });
    const missing = new HostIdentity(hostManifestSchema.parse({ format: 'vex-host', version: 1, host: { name: 'H', domain: 'h.example' }, identity: { kind: 'hs256', secretEnv: 'NO_EXISTE', issuer: 'https://host.example', audience: 'vex' } }).identity!, { env: {}, now });
    expect(await missing.verify(jwt({ alg: 'HS256' }, claims(), hs256('x')))).toEqual({ ok: false, reason: 'falta NO_EXISTE en el entorno' });
  });

  it('caches the JWKS, refetches once for an unknown kid (not more often than every minute) and survives an outage', async () => {
    let calls = 0;
    let doc = { keys: [jwksDoc().keys[0]!] };
    const id = identity({ kind: 'jwks' }, async () => (calls++, new Response(JSON.stringify(doc))));
    const rsaTok = jwt({ alg: 'RS256', kid: 'k-rsa' }, claims(), rs256(rsa.privateKey));
    const ecTok = jwt({ alg: 'ES256', kid: 'k-ec' }, claims(), es256(ec.privateKey));
    expect((await id.verify(rsaTok)).ok).toBe(true);
    expect((await id.verify(rsaTok)).ok).toBe(true);
    expect(calls).toBe(1);
    // A key the host just rotated in: unknown kid, but the last fetch was a moment ago → no refetch yet.
    expect(await id.verify(ecTok)).toEqual({ ok: false, reason: 'clave k-ec desconocida en el JWKS' });
    expect(calls).toBe(1);
    const later = new HostIdentity(hostManifestSchema.parse({ format: 'vex-host', version: 1, host: { name: 'H', domain: 'host.example' }, identity: { kind: 'jwks', url: 'https://host.example/jwks.json', issuer: 'https://host.example', audience: 'vex' } }).identity!, {
      env: {},
      fetch: async () => (calls++, new Response(JSON.stringify(doc))),
      now: (() => {
        let t = NOW;
        return () => (t += 61_000);
      })(),
    });
    doc = jwksDoc();
    expect((await later.verify(ecTok)).ok).toBe(true);
    // Outage: the cached keys keep serving.
    const flaky = identity({ kind: 'jwks' }, async () => (calls++ % 2 === 0 ? new Response(JSON.stringify(jwksDoc())) : new Response('nope', { status: 503 })));
    expect((await flaky.verify(rsaTok)).ok).toBe(true);
  });
});

describe('host identity wired into Vex Core', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('a host JWT opens a session with the mapped identity; the demo login and Vex tokens still work; a foreign token does not', async () => {
    const manifest = hostManifestSchema.parse({
      format: 'vex-host',
      version: 1,
      host: { name: 'Host', domain: 'host.example' },
      identity: { kind: 'jwks', url: 'http://host.example/jwks.json', issuer: 'https://host.example', audience: 'vex', claims: { roles: { owner: 'admin', staff: 'gestora' } } },
    });
    const store = new MemoryStore();
    app = buildApp({
      provider: new ScriptedProvider(),
      platform: new MockPlatform(),
      store,
      manifest,
      demoLogin: true,
      now,
      connectors: { env: {}, mcpAllow: [], urlPolicy: { allowHttp: true, allowInternal: true }, fetch: async () => new Response(JSON.stringify(jwksDoc())) },
    });
    await app.ready();
    const info = (await app.inject({ method: 'GET', url: '/operator/info' })).json() as { host: { identity?: string } };
    expect(info.host.identity).toBe('jwks');

    const owner = jwt({ alg: 'RS256', kid: 'k-rsa' }, claims({ sub: 'h-1', name: 'Marta', role: 'owner' }), rs256(rsa.privateKey));
    const staff = jwt({ alg: 'ES256', kid: 'k-ec' }, claims({ sub: 'h-2', name: 'Pau', role: 'staff' }), es256(ec.privateKey));
    const foreign = jwt({ alg: 'RS256', kid: 'k-rsa' }, claims({ iss: 'https://otro.example' }), rs256(rsa.privateKey));

    expect((await app.inject({ method: 'GET', url: '/connectors', headers: { authorization: `Bearer ${owner}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/connectors', headers: { authorization: `Bearer ${staff}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/connectors', headers: { authorization: `Bearer ${foreign}` } })).statusCode).toBe(401);

    const chat = await app.inject({ method: 'POST', url: '/operator/chat', headers: { authorization: `Bearer ${staff}` }, payload: { message: 'Busca a Laura' } });
    expect(chat.statusCode).toBe(200);
    // The action ran as the person the host's token names, and the audit says so.
    expect(store.auditEntries.find((e) => e.tool === 'buscar')?.principal).toEqual({ id: 'h-2', name: 'Pau', role: 'gestora' });

    const demo = ((await app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-cesar' } })).json() as { token: string }).token;
    expect((await app.inject({ method: 'GET', url: '/connectors', headers: { authorization: `Bearer ${demo}` } })).statusCode).toBe(200);
  });
});
