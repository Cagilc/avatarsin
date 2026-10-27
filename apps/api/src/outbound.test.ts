import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ScriptedProvider } from '@vex/operator';
import { HttpMcpClient, contentToText, importOpenApi, toolsFromManifest } from '@vex/connectors';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from './app.ts';
import { OutboundBlockedError, guardedFetch, isInternalHost, pinnedLookup } from './guard.ts';
import { MockPlatform } from './platform/mock.ts';
import { MemoryStore } from './storage.ts';

// The outbound guard against real HTTP servers on 127.0.0.1 and a real fetch, so `redirect: 'manual'`,
// bodies and the pinned connection are exercised as in production, not through a fake.

interface Seen { method: string; url: string; headers: IncomingMessage['headers']; body: string }
type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

const servers: Server[] = [];
async function serve(handler: Handler): Promise<{ origin: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

// Local servers are http on 127.0.0.1, so the policy is the development one: that skips the DNS
// check and the pin (covered below with fakes and with a name that only the guard can resolve) but
// keeps the manual redirect handling under test.
const dev = { allowHttp: true, allowInternal: true };
const strict = { allowHttp: false, allowInternal: false };
const redirectTo = (status: number, location: string) => (_q: IncomingMessage, _b: string, res: ServerResponse) => res.writeHead(status, { location }).end();

describe('guardedFetch with the real fetch', () => {
  it('sees the 3xx itself (redirect: manual) and follows a same-origin redirect', async () => {
    const api = await serve((req, _b, res) => (req.url === '/old' ? res.writeHead(302, { location: '/new' }).end() : res.end('{"ok":true}')));
    const res = await guardedFetch({ policy: dev })(`${api.origin}/old`, { headers: { 'x-api-key': 'k' } });
    expect(res.status).toBe(200);
    expect(api.seen.map((s) => [s.url, s.headers['x-api-key']])).toEqual([['/old', 'k'], ['/new', 'k']]);
  });

  it('drops the api key and the bearer token when the redirect changes origin', async () => {
    const other = await serve((_q, _b, res) => res.end('{}'));
    const api = await serve(redirectTo(302, `${other.origin}/x`));
    await guardedFetch({ policy: dev })(`${api.origin}/`, { headers: { 'x-api-key': 'k', authorization: 'Bearer t', accept: 'application/json' } });
    expect(other.seen[0]?.headers['x-api-key']).toBeUndefined();
    expect(other.seen[0]?.headers['authorization']).toBeUndefined();
    expect(other.seen[0]?.headers['accept']).toBe('application/json');
  });

  it('keeps method and body on 307', async () => {
    const api = await serve((req, _b, res) => (req.url === '/a' ? res.writeHead(307, { location: '/b' }).end() : res.end('{}')));
    const res = await guardedFetch({ policy: dev })(`${api.origin}/a`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n":1}' });
    expect(res.status).toBe(200);
    expect(api.seen.map((s) => [s.method, s.url, s.body])).toEqual([['POST', '/a', '{"n":1}'], ['POST', '/b', '{"n":1}']]);
  });

  // Native fetch turns POST + 303 (and 302) into a GET without body. A POST tool call to an API that
  // answers "303 See Other" after creating something must keep working behind the guard.
  it('turns POST + 303 into a GET without body, like native fetch', async () => {
    const api = await serve((req, _b, res) => (req.url === '/citas' ? res.writeHead(303, { location: '/citas/1' }).end() : res.end('{"id":1}')));
    const res = await guardedFetch({ policy: dev })(`${api.origin}/citas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n":1}' });
    expect(res.status).toBe(200);
    expect(api.seen.map((s) => [s.method, s.url, s.body])).toEqual([['POST', '/citas', '{"n":1}'], ['GET', '/citas/1', '']]);
  });

  it('turns POST + 302 into a GET without body, like native fetch', async () => {
    const api = await serve((req, _b, res) => (req.url === '/a' ? res.writeHead(302, { location: '/b' }).end() : res.end('{}')));
    const res = await guardedFetch({ policy: dev })(`${api.origin}/a`, { method: 'POST', body: 'x' });
    expect(res.status).toBe(200);
    expect(api.seen.map((s) => [s.method, s.body])).toEqual([['POST', 'x'], ['GET', '']]);
  });

  it('a trailing dot does not get past the hostname check', async () => {
    const f = guardedFetch({ policy: strict, fetch: async () => new Response('{}') });
    await expect(f('https://localhost./spec.json')).rejects.toThrow(/esta máquina/);
  });

  it('refuses a Request object instead of silently dropping its headers and body', async () => {
    const f = guardedFetch({ policy: dev, fetch: async () => new Response('{}') });
    await expect(f(new Request('https://api.ejemplo.com/', { method: 'POST', body: 'x' }))).rejects.toThrow(/Request/);
  });

  it('refusals are OutboundBlockedError, never a generic failure', async () => {
    const f = guardedFetch({ policy: strict, resolve: async () => ['10.0.0.8'], fetch: async () => new Response('{}') });
    await expect(f('https://api.ejemplo.com/')).rejects.toBeInstanceOf(OutboundBlockedError);
    await expect(f('http://api.ejemplo.com/')).rejects.toBeInstanceOf(OutboundBlockedError);
    const loop = guardedFetch({ policy: strict, resolve: async () => ['93.184.216.34'], fetch: async () => new Response(null, { status: 302, headers: { location: '/again' } }) });
    await expect(loop('https://api.ejemplo.com/')).rejects.toBeInstanceOf(OutboundBlockedError);
  });
});

describe('guardedFetch wired into Vex Core', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });
  async function adminToken(connectors: AppOptions['connectors']): Promise<string> {
    app = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(), store: new MemoryStore(), demoLogin: true, connectors });
    await app.ready();
    return ((await app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-cesar' } })).json() as { token: string }).token;
  }

  it('an OpenAPI import whose name resolves to a private address is refused with a 400 and a clear reason', async () => {
    let fetched = 0;
    const token = await adminToken({ env: {}, mcpAllow: [], resolve: async () => ['10.1.2.3'], fetch: async () => (fetched++, new Response('{}')) });
    const res = await app.inject({ method: 'POST', url: '/connectors/import/openapi', headers: { authorization: `Bearer ${token}` }, payload: { id: 'interna', url: 'https://api.ejemplo.com/openapi.json' } });
    expect(fetched).toBe(0);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('resuelve') });
    expect(res.statusCode).toBe(400);
  });

  it('an OpenAPI import that redirects to the metadata address is refused with a 400', async () => {
    const urls: string[] = [];
    const token = await adminToken({
      env: {},
      mcpAllow: [],
      resolve: async () => ['93.184.216.34'],
      fetch: async (u) => (urls.push(String(u)), new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } })),
    });
    const res = await app.inject({ method: 'POST', url: '/connectors/import/openapi', headers: { authorization: `Bearer ${token}` }, payload: { id: 'meta', url: 'https://api.ejemplo.com/openapi.json' } });
    expect(urls).toEqual(['https://api.ejemplo.com/openapi.json']);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('esta máquina') });
  });

  it('a remote MCP whose name resolves to a private address is refused before any request', async () => {
    let fetched = 0;
    const token = await adminToken({ env: {}, mcpAllow: [], resolve: async () => ['192.168.0.10'], fetch: async () => (fetched++, new Response('{}')) });
    const res = await app.inject({ method: 'POST', url: '/connectors/import/mcp', headers: { authorization: `Bearer ${token}` }, payload: { id: 'remoto', transport: 'http', url: 'https://mcp.ejemplo.com/mcp' } });
    expect(fetched).toBe(0);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/resuelve/);
  });
});

describe('a tool call to an imported API goes through the guard', () => {
  it('the baseUrl is checked at run time, and the API key never reaches the redirect target', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Citas', version: '1' },
      servers: [{ url: 'https://api.ejemplo.com' }],
      paths: { '/huecos': { get: { operationId: 'listar_huecos', summary: 'Lista huecos', responses: { '200': { description: 'ok' } } } } },
    };
    const manifest = importOpenApi(spec, { id: 'citas', auth: { kind: 'header', name: 'x-api-key', env: 'CITAS_KEY' } });
    for (const t of manifest.tools) Object.assign(t, { risk: 'read', enabled: true, review: {} });
    const sent: Array<[string, string | null]> = [];
    const outbound = guardedFetch({
      policy: strict,
      resolve: async (h) => (h === 'api.ejemplo.com' ? ['93.184.216.34'] : ['10.0.0.9']),
      fetch: async (u, init) => (sent.push([String(u), new Headers(init?.headers).get('x-api-key')]), new Response(null, { status: 302, headers: { location: 'https://interno.ejemplo.com/' } })),
    });
    const tools = toolsFromManifest(manifest, { env: { CITAS_KEY: 'secreto' }, mcp: async () => { throw new Error('no mcp'); }, fetch: outbound });
    expect(tools.length).toBeGreaterThan(0);
    await expect(tools[0]!.execute({}, {} as never)).rejects.toThrow(/resuelve/);
    expect(sent).toEqual([['https://api.ejemplo.com/huecos', 'secreto']]);
  });
});

// isInternalHost judges every DNS answer, so the rule is "only global unicast": a range nobody
// listed is refused. These are answers a resolver can give that still reach this machine or its network.
describe('isInternalHost: only global unicast passes', () => {
  for (const ip of ['fe90::1', 'febf::1', '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::1', '198.18.0.1', '255.255.255.255', '224.0.0.1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '192.0.2.1', '2001:db8::1', '100.64.0.1', 'fe80::1%eth0', '[::1]', 'localhost.', 'api.localhost']) {
    it(`treats ${ip} as internal`, () => expect(isInternalHost(ip)).toBe(true));
  }
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:2800:220:1:248:1893:25c8:1946', 'api.ejemplo.com']) {
    it(`lets ${ip} through`, () => expect(isInternalHost(ip)).toBe(false));
  }
});

// A minimal Streamable HTTP MCP server: JSON for initialize and tools/list, SSE for tools/call.
function mcpHandler(log: string[]): Handler {
  return (req, raw, res) => {
    if (req.method === 'DELETE') return void (log.push(`DELETE ${req.headers['mcp-session-id'] ?? '-'}`), res.writeHead(200).end());
    const msg = JSON.parse(raw || '{}') as { id?: number; method: string; params?: { name?: string; arguments?: { texto?: string } } };
    log.push(`${msg.method} ${req.headers['mcp-session-id'] ?? '-'}`);
    if (msg.id === undefined) return void res.writeHead(202).end();
    const reply = (result: unknown) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
    if (msg.method === 'initialize') return void res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' }).end(reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'eco' } }));
    if (msg.method === 'tools/list') return void res.writeHead(200, { 'content-type': 'application/json' }).end(reply({ tools: [{ name: 'eco', description: 'Repite', inputSchema: { type: 'object', properties: { texto: { type: 'string' } } }, annotations: { readOnlyHint: true } }] }));
    res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`event: message\ndata: ${reply({ content: [{ type: 'text', text: `eco: ${msg.params?.arguments?.texto}` }] })}\n\n`);
  };
}

describe('remote MCP over Streamable HTTP through the guard', () => {
  it('handshake, list, call over SSE and close keep the session header, with the real fetch', async () => {
    const log: string[] = [];
    const mcp = await serve(mcpHandler(log));
    const client = await HttpMcpClient.connect(`${mcp.origin}/mcp`, { fetch: guardedFetch({ policy: dev }) });
    expect(client.server.name).toBe('eco');
    expect((await client.listTools()).map((t) => t.name)).toEqual(['eco']);
    expect(contentToText(await client.callTool('eco', { texto: 'hola' }))).toContain('eco: hola');
    await client.close();
    expect(log).toEqual(['initialize -', 'notifications/initialized sess-1', 'tools/list sess-1', 'tools/call sess-1', 'DELETE sess-1']);
  });

  it('Vex Core imports a remote MCP from a local server when the development policy allows it', async () => {
    const mcp = await serve(mcpHandler([]));
    const app = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(), store: new MemoryStore(), demoLogin: true, connectors: { env: {}, mcpAllow: [], urlPolicy: dev } });
    await app.ready();
    try {
      const token = ((await app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-cesar' } })).json() as { token: string }).token;
      const res = await app.inject({ method: 'POST', url: '/connectors/import/mcp', headers: { authorization: `Bearer ${token}` }, payload: { id: 'eco', transport: 'http', url: `${mcp.origin}/mcp` } });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { tools: Array<{ name: string; enabled: boolean }> }).tools).toEqual([expect.objectContaining({ name: 'eco_eco', enabled: false })]);
    } finally {
      await app.close();
    }
  });

  it('a remote MCP that redirects a call to another origin does not carry the session there', async () => {
    const other = await serve(mcpHandler([]));
    const log: string[] = [];
    const mcp = await serve((req, raw, res) => {
      if (raw.includes('"tools/call"')) return void res.writeHead(307, { location: `${other.origin}/mcp` }).end();
      mcpHandler(log)(req, raw, res);
    });
    const client = await HttpMcpClient.connect(`${mcp.origin}/mcp`, { fetch: guardedFetch({ policy: dev }) });
    await client.callTool('eco', { texto: 'x' });
    expect(other.seen.map((s) => s.headers['mcp-session-id'])).toEqual([undefined]);
  });
});

// The guard resolves the name once; without a pin, the connection would ask the system resolver
// again and could land somewhere else (DNS rebinding). The pinned lookup only knows what the guard
// checked, and a strict policy refuses any name it did not check.
describe('DNS rebinding window: the connection uses the checked addresses', () => {
  const call = (lookup: ReturnType<typeof pinnedLookup>, host: string, all = false) =>
    new Promise<unknown>((resolve, reject) => lookup(host, { all }, (err, address, family) => (err ? reject(err) : resolve(all ? address : [address, family]))));

  it('answers with the pinned addresses, whatever the system resolver says', async () => {
    const pins = new Map([['api.ejemplo.com', ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']]]);
    expect(await call(pinnedLookup(pins, strict), 'api.ejemplo.com')).toEqual(['93.184.216.34', 4]);
    expect(await call(pinnedLookup(pins, strict), 'API.ejemplo.com.', true)).toEqual([{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }]);
  });

  it('refuses a name the guard never checked under a strict policy, and defers to the system in development', async () => {
    await expect(call(pinnedLookup(new Map(), strict), 'api.ejemplo.com')).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(await call(pinnedLookup(new Map(), dev), 'localhost')).toEqual([expect.stringMatching(/^(127\.0\.0\.1|::1)$/), expect.any(Number)]);
  });

  it('a name only the guard can resolve never reaches the local server, and the system resolver is not asked', async () => {
    const local = await serve((_q, _b, res) => res.end('{"interno":true}'));
    const port = new URL(local.origin).port;
    // `.invalid` never resolves: an unpinned connection would fail with ENOTFOUND. The pinned one
    // goes to the checked (public, unreachable here) address and fails there instead.
    const f = guardedFetch({ policy: { allowHttp: true, allowInternal: false }, resolve: async () => ['93.184.216.34'], connectTimeoutMs: 1500 });
    const failure = await f(`http://api.vex.invalid:${port}/`).then(() => null, (e: unknown) => e as Error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure) + String((failure as Error & { cause?: unknown }).cause ?? '')).not.toMatch(/ENOTFOUND/);
    expect(local.seen).toEqual([]);
  }, 10_000);
});
