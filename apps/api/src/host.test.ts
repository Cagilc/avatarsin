import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ScriptedProvider, type Completion, type CompletionRequest, type HostAvatar, type HostManifest, type ModelProvider, type OperatorEvent } from '@vex/operator';
import { createCitasApp } from '@vex/sample-tools';
import { canonicalJson, exportPublicKey, generateSigningKeys, keyIdOf, signPackage, toBase64Url } from '@vexstudio/format';
import { FIXTURE_HASH, fixtureDocument } from '@vexstudio/format/fixtures';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from './app.ts';
import { verifySignedGrant } from './grant.ts';
import { HostManifestError, loadHostManifest, parseHostManifest, resolveManifestPath } from './host.ts';
import { MockPlatform } from './platform/mock.ts';
import { MemoryStore } from './storage.ts';
import { DEFAULT_PERSONALITY, buildSystemPrompt } from './system.ts';

const PLATFORM_TOOLS = ['buscar', 'leer_expediente', 'crear_expediente', 'crear_tarea', 'redactar_correo', 'enviar_correo'];
const LOCAL = { allowHttp: true, allowInternal: true };
const slash = (p: string) => p.replace(/\\/g, '/');

type Streamed = OperatorEvent | { type: 'session'; sessionId: string };
function parseSse(body: string): Streamed[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.includes('data: '))
    .map((chunk) => JSON.parse(chunk.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as Streamed);
}

/** Answers with plain text and keeps every system prompt it was given. */
class Spy implements ModelProvider {
  readonly name = 'spy';
  readonly systems: string[] = [];
  async complete(req: CompletionRequest): Promise<Completion> {
    this.systems.push(req.system);
    return { content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn' };
  }
}

interface Info {
  policy: unknown;
  personality: { name: string; tone: string };
  host: { name: string; manifest: boolean; domain?: string; features?: Record<string, boolean>; proposals?: Array<{ id: string; status: string; error?: string }>; avatar?: HostAvatar };
  grant: { status: string; tools?: string[]; reason?: string; expiresAt?: string };
  tools: Array<{ name: string }>;
}

describe('loading the host manifest', () => {
  it('resolves a preset name to presets/<name>/manifest.json and a path to itself', () => {
    expect(slash(resolveManifestPath('demo-negocio'))).toMatch(/\/presets\/demo-negocio\/manifest\.json$/);
    expect(slash(resolveManifestPath('./hosts/mio.json', { cwd: 'C:/vex/apps/api' }))).toBe('C:/vex/apps/api/hosts/mio.json');
  });

  it('loads the demo preset: the demo platform by name, announcements and buttons on, nothing proposed', () => {
    const m = loadHostManifest('demo-negocio');
    expect(m.host).toEqual({ name: 'Demo Negocio', domain: 'demo-negocio.example' });
    expect(m.features).toEqual({ tours: false, announcements: true, quickActions: true, domDriver: false });
    expect(m.quickActions.map((q) => q.id)).toEqual(['buscar-laura', 'quien-es-marco', 'campana-octubre']);
    expect(m.announcements.map((a) => a.id)).toEqual(['bienvenida']);
    expect(m.connectors).toEqual([]);
    expect(Object.keys(m.screenContext)).toEqual(['pantalla', 'contactoId', 'contactoEmail', 'expedienteId']);
  });

  it('loads the agenda preset: one proposed connector and a policy without the platform tools', () => {
    const m = loadHostManifest('agenda');
    expect(m.connectors.map((c) => c.id)).toEqual(['citas']);
    expect(m.policy?.allow).toEqual(['api:*', 'leer_guia']);
  });

  it('says exactly what is wrong: the file, the field and the reason', () => {
    expect(() => loadHostManifest('no-existe')).toThrow(/No existe el manifiesto del host: .*no-existe.*manifest\.json \(preset "no-existe"\)/);
    expect(() => parseHostManifest('{ nope', 'm.json')).toThrow(/m\.json: no es JSON válido/);
    expect(() => parseHostManifest(JSON.stringify({ format: 'vex-host', version: 1, host: { name: '', domain: 'x' } }), 'm.json')).toThrow(/m\.json: manifiesto del host no válido\. host\.name:/);
    expect(() => parseHostManifest(JSON.stringify({ format: 'vex-host', version: 1, host: { name: 'X', domain: 'x' }, tours: [{}] }), 'm.json')).toThrow(/tours: .*paso posterior/);
    const dir = mkdtempSync(join(tmpdir(), 'vex-host-'));
    try {
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ format: 'vex-host', version: 1, host: { name: 'Mío', domain: 'mio.example' }, extra: true }));
      expect(() => loadHostManifest(join(dir, 'manifest.json'))).toThrow(HostManifestError);
      expect(() => loadHostManifest(join(dir, 'manifest.json'))).toThrow(/\(raíz\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the system prompt', () => {
  it('names the host, describes its screen context and names no platform of its own', () => {
    const demo = loadHostManifest('demo-negocio');
    const prompt = buildSystemPrompt(DEFAULT_PERSONALITY, { name: demo.host.name, screenContext: demo.screenContext });
    expect(prompt).toContain('el operador de Demo Negocio');
    expect(prompt).toContain('  - contactoId: Id del contacto abierto');
    expect(prompt).not.toMatch(/mnee|expediente de residencia/i);
    const bare = buildSystemPrompt(DEFAULT_PERSONALITY, { name: 'la plataforma' });
    expect(bare).toContain('el operador de la plataforma');
    expect(bare).not.toContain('Sus claves');
  });
});

describe('Vex Core with a host manifest', () => {
  let app: FastifyInstance | undefined;
  let token: string;
  let store: MemoryStore;

  async function start(extra: Partial<AppOptions> = {}, keepStore = false) {
    if (app) await app.close();
    if (!keepStore) store = new MemoryStore();
    app = buildApp({ provider: new ScriptedProvider(), platform: new MockPlatform(), store, demoLogin: true, ...extra });
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/platform/auth/demo', payload: { userId: 'u-cesar' } });
    token = (login.json() as { token: string }).token;
    return app;
  }
  const info = async () => (await app!.inject({ method: 'GET', url: '/operator/info' })).json() as Info;
  const names = async () => (await info()).tools.map((t) => t.name);
  const headers = () => ({ authorization: `Bearer ${token}` });
  const chat = (message: string) => app!.inject({ method: 'POST', url: '/operator/chat', headers: headers(), payload: { message } });
  const approveAll = async (id: string) => {
    const m = (await app!.inject({ method: 'GET', url: '/connectors', headers: headers() })).json() as Array<{ id: string; tools: Array<{ name: string; suggestedRisk: string }> }>;
    const tools = m.find((c) => c.id === id)!.tools;
    const res = await app!.inject({ method: 'POST', url: `/connectors/${id}/review`, headers: headers(), payload: { decisions: tools.map((t) => ({ name: t.name, risk: t.suggestedRisk, enabled: true })) } });
    expect(res.statusCode).toBe(200);
  };

  let citas: ReturnType<typeof createCitasApp>;
  let citasBase: string;
  beforeAll(async () => {
    citas = createCitasApp({ baseUrl: 'http://127.0.0.1:0' });
    await citas.listen({ port: 0, host: '127.0.0.1' });
    citasBase = `http://127.0.0.1:${(citas.server.address() as AddressInfo).port}`;
    return async () => {
      await citas.close();
    };
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('without a manifest nothing changes: a bare operator with the platform tools and the guide', async () => {
    await start();
    const i = await info();
    expect(i.host).toEqual({ name: 'la plataforma', manifest: false });
    expect(i.grant).toEqual({ status: 'none' });
    expect(i.tools.map((t) => t.name)).toEqual([...PLATFORM_TOOLS, 'leer_guia']);
  });

  it('the demo preset gives exactly the same tools and policy as no manifest: features only add presentation', async () => {
    await start();
    const bare = await info();
    await start({ manifest: loadHostManifest('demo-negocio') });
    const demo = await info();
    expect(demo.tools).toEqual(bare.tools);
    expect(demo.policy).toEqual(bare.policy);
    expect(demo.host).toEqual({ name: 'Demo Negocio', manifest: true, domain: 'demo-negocio.example', features: { tours: false, announcements: true, quickActions: true, domDriver: false }, proposals: [] });
    await start({ manifest: { ...loadHostManifest('demo-negocio'), features: { tours: false, announcements: false, quickActions: false, domDriver: false } } });
    const off = await info();
    expect(off.tools).toEqual(bare.tools);
    expect(off.policy).toEqual(bare.policy);
  });

  it('the manifest names the host and its screen context in the prompt the model gets', async () => {
    const spy = new Spy();
    await start({ provider: spy, manifest: loadHostManifest('demo-negocio') });
    expect((await chat('Hola')).statusCode).toBe(200);
    expect(spy.systems[0]).toContain('el operador de Demo Negocio');
    expect(spy.systems[0]).toContain('expedienteId: Referencia del expediente abierto');
  });

  it('proposes the manifest connectors as drafts: nothing reaches the model until a person reviews', async () => {
    const manifest = parseHostManifest(
      JSON.stringify({ format: 'vex-host', version: 1, host: { name: 'Demo', domain: 'demo.example' }, connectors: [{ id: 'citas', name: 'Agenda', source: { kind: 'openapi', url: `${citasBase}/openapi.json` } }] }),
      'test',
    );
    await start({ manifest, connectors: { urlPolicy: LOCAL } });
    expect((await info()).host.proposals).toEqual([{ id: 'citas', status: 'proposed' }]);
    const list = (await app!.inject({ method: 'GET', url: '/connectors', headers: headers() })).json() as Array<{ id: string; name: string; tools: Array<{ enabled: boolean; risk: string | null }> }>;
    expect(list.map((c) => c.id)).toEqual(['citas']);
    expect(list[0]!.name).toBe('Agenda');
    expect(list[0]!.tools.length).toBeGreaterThan(0);
    expect(list[0]!.tools.every((t) => !t.enabled && t.risk === null)).toBe(true);
    expect(await names()).toEqual([...PLATFORM_TOOLS, 'leer_guia']);
    const proposed = store.auditEntries.find((e) => e.tool === 'importar_conector');
    expect(proposed?.principal.id).toBe('manifiesto');
    expect(proposed?.summary).toMatch(/desde el manifiesto/);

    await approveAll('citas');
    expect(await names()).toEqual(expect.arrayContaining(['citas_listar_huecos', 'leer_guia']));

    // Another start with the same store: what the person reviewed stays as it is.
    await start({ manifest, connectors: { urlPolicy: LOCAL } }, true);
    expect((await info()).host.proposals).toEqual([{ id: 'citas', status: 'existing' }]);
    expect(await names()).toContain('citas_listar_huecos');
  });

  it('a proposal that cannot be fetched, or that the outbound policy refuses, is reported and the server still starts', async () => {
    const make = (url: string) => parseHostManifest(JSON.stringify({ format: 'vex-host', version: 1, host: { name: 'Demo', domain: 'demo.example' }, connectors: [{ id: 'citas', source: { kind: 'openapi', url } }] }), 'test');
    await start({ manifest: make('http://127.0.0.1:1/openapi.json'), connectors: { urlPolicy: LOCAL } });
    expect((await app!.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await info()).host.proposals).toEqual([{ id: 'citas', status: 'failed', error: expect.any(String) }]);
    await start({ manifest: make(`${citasBase}/openapi.json`) });
    expect((await info()).host.proposals).toEqual([{ id: 'citas', status: 'failed', error: expect.stringMatching(/https/) }]);
    expect((await app!.inject({ method: 'GET', url: '/connectors', headers: headers() })).json()).toEqual([]);
  });

  it('serves the embeddable panel script when it is built, and says so when it is not', async () => {
    await start();
    expect((await app!.inject({ method: 'GET', url: '/assistant.js' })).statusCode).toBe(404);
    const dir = mkdtempSync(join(tmpdir(), 'vex-assistant-'));
    try {
      writeFileSync(join(dir, 'vex-assistant.js'), 'customElements.define("vex-assistant", class extends HTMLElement {});');
      await start({ assistantBundle: join(dir, 'vex-assistant.js') });
      const res = await app!.inject({ method: 'GET', url: '/assistant.js' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/javascript');
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.body).toContain('vex-assistant');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the agenda preset is a second host with no code of its own: only its connector, after review', async () => {
    const preset = loadHostManifest('agenda');
    // The preset points at the sample service's fixed port; here it runs on a free one, so the
    // manifest also pins the base URL the tools call (the sample's OpenAPI declares port 0).
    const manifest: HostManifest = { ...preset, connectors: [{ ...preset.connectors[0]!, source: { kind: 'openapi', url: `${citasBase}/openapi.json` }, baseUrl: citasBase }] };
    await start({ manifest, connectors: { urlPolicy: LOCAL } });
    expect(await names()).toEqual(['leer_guia']);
    await approveAll('citas');
    const after = await names();
    expect(after).toEqual(expect.arrayContaining(['citas_listar_huecos', 'citas_crear_cita', 'leer_guia']));
    for (const t of PLATFORM_TOOLS) expect(after).not.toContain(t);

    const run = parseSse((await chat('usa citas_listar_huecos {"fecha":"2026-10-27"}')).body);
    expect(run.find((e) => e.type === 'tool_result')).toMatchObject({ outcome: 'ok', id: expect.stringContaining('citas_listar_huecos') });
    const refused = parseSse((await chat('usa buscar {"consulta":"Laura","tipo":"todo"}')).body).at(-1) as { reply: string };
    expect(refused.reply).toMatch(/No tengo ninguna herramienta llamada buscar/);
  });

  describe('the integration grant from the studio', () => {
    let privateKey: CryptoKey;
    let avatar: HostAvatar;
    const T0 = Date.parse('2026-10-25T10:00:00.000Z');
    let now = T0;
    const iso = (ms: number) => new Date(ms).toISOString();
    const grantAt = (issued: number, over: Record<string, unknown> = {}) => ({
      integration: 'vk_demo',
      avatarId: 'av_demo',
      revision: 2,
      origins: ['https://demo-negocio.example'],
      tools: ['buscar', 'crear_tarea', 'enviar_correo'],
      maxRisk: 'write',
      issuedAt: iso(issued),
      expiresAt: iso(issued + 10 * 60_000),
      ...over,
    });
    const sign = async (grant: unknown, key = privateKey, keyId = avatar.keyId) => ({
      grant,
      signature: toBase64Url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(canonicalJson(grant))))),
      keyId,
    });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const manifest = (): HostManifest => ({ ...loadHostManifest('demo-negocio'), avatar });
    /** A fake studio: `answer` serves /grant; /package gets `pkg` when given, 404 otherwise. */
    const studio = (answer: () => Promise<Response>, pkg?: () => Promise<Response>) => {
      const urls: string[] = [];
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/package')) return pkg ? pkg() : json({ error: 'No existe.' }, 404);
        urls.push(url);
        return answer();
      }) as typeof fetch;
      return { urls, fetch: fetchImpl };
    };

    beforeAll(async () => {
      const keys = await generateSigningKeys();
      privateKey = keys.privateKey;
      const publicKey = await exportPublicKey(keys.publicKey);
      avatar = { endpoint: 'https://estudio.example/v1/embed/vk_demo_demo_demo_demo_demo', publicKey, keyId: await keyIdOf(publicKey) };
    });

    it('applies a valid grant: only the granted tools up to its risk ceiling reach the model', async () => {
      now = T0;
      const s = studio(async () => json(await sign(grantAt(now))));
      await start({ manifest: manifest(), grant: { fetch: s.fetch, now: () => now } });
      const i = await info();
      expect(i.grant).toMatchObject({ status: 'ok', tools: ['buscar', 'crear_tarea', 'enviar_correo'], maxRisk: 'write' });
      // enviar_correo is irreversible: above the ceiling. leer_guia is no host action: untouched by the grant.
      expect(i.tools.map((t) => t.name)).toEqual(['buscar', 'crear_tarea', 'leer_guia']);
      expect(s.urls).toEqual([`${avatar.endpoint}/grant`]);
      const run = parseSse((await chat('Busca a Laura Pérez')).body);
      expect(run.find((e) => e.type === 'tool_result')).toMatchObject({ outcome: 'ok' });
    });

    it('tells the page where the avatar is, and takes the published personality for the prompt when the package verifies', async () => {
      now = T0;
      const doc = fixtureDocument();
      doc.personality = { ...doc.personality, displayName: 'Pixel', tone: 'divertido', formality: 0.1, verbosity: 0.9, emoji: true, greeting: '¡Hola, soy Pixel!', about: 'Mascota de una aseguradora.', language: 'es' };
      const signed = await signPackage({ format: 'vex-avatar-package', packageVersion: 1, avatarId: doc.id, revision: 1, publishedAt: iso(now), document: doc, assets: [{ hash: FIXTURE_HASH, type: 'image/svg+xml', size: 1 }] }, privateKey, avatar.publicKey);
      const spy = new Spy();
      const s = studio(
        async () => json(await sign(grantAt(now))),
        async () => json(signed),
      );
      await start({ provider: spy, manifest: manifest(), grant: { fetch: s.fetch, now: () => now } });
      const i = await info();
      expect(i.host.avatar).toEqual(avatar);
      expect(i.personality.name).toBe('Pixel');
      expect(i.personality.tone).toMatch(/desenfadado.*tuteo.*detalladas.*emoji.*español.*¡Hola, soy Pixel!.*aseguradora/);
      await chat('Hola');
      expect(spy.systems[0]).toContain('Eres Pixel, el operador de Demo Negocio');

      // A package altered on the way: the server's own personality, never the altered one.
      const tampered = { ...signed, document: { ...doc, personality: { ...doc.personality, displayName: 'Impostor' } } };
      const t = studio(
        async () => json(await sign(grantAt(now))),
        async () => json(tampered),
      );
      await start({ manifest: manifest(), grant: { fetch: t.fetch, now: () => now } });
      expect((await info()).personality.name).toBe('Vex');
    });

    it('a grant altered by one byte, signed by another key, or with another key id, leaves no tool', async () => {
      now = T0;
      const signed = await sign(grantAt(now));
      const altered = { ...signed, grant: { ...(signed.grant as Record<string, unknown>), maxRisk: 'irreversible' } };
      const s = studio(async () => json(altered));
      await start({ manifest: manifest(), grant: { fetch: s.fetch, now: () => now } });
      expect((await info()).grant).toMatchObject({ status: 'invalid', reason: expect.stringContaining('firma') });
      expect(await names()).toEqual(['leer_guia']);

      const other = await generateSigningKeys();
      expect(await verifySignedGrant(await sign(grantAt(now), other.privateKey), avatar, 'demo-negocio.example', now)).toMatchObject({ status: 'invalid' });
      expect(await verifySignedGrant(await sign(grantAt(now), privateKey, 'otra-clave-0001'), avatar, 'demo-negocio.example', now)).toMatchObject({ status: 'invalid', reason: expect.stringContaining('otra clave') });
      expect(await verifySignedGrant(await sign({ ...grantAt(now), sorpresa: 1 }), avatar, 'demo-negocio.example', now)).toMatchObject({ status: 'invalid', reason: expect.stringContaining('contenido') });
    });

    it('a grant for another site is not for this host', async () => {
      now = T0;
      const s = studio(async () => json(await sign(grantAt(now, { origins: ['https://otro.example'] }))));
      await start({ manifest: manifest(), grant: { fetch: s.fetch, now: () => now } });
      expect((await info()).grant).toMatchObject({ status: 'foreign' });
      expect(await names()).toEqual(['leer_guia']);
    });

    it('expires when the studio said, and is asked for again once the clock passes that instant', async () => {
      now = T0;
      let issued = T0;
      const s = studio(async () => json(await sign(grantAt(issued))));
      await start({ manifest: manifest(), grant: { fetch: s.fetch, now: () => now, refreshMs: 60_000 } });
      expect((await info()).grant).toMatchObject({ status: 'ok', expiresAt: iso(T0 + 10 * 60_000) });
      expect(s.urls).toHaveLength(1);
      now = T0 + 30_000;
      await info();
      expect(s.urls).toHaveLength(1);
      // Past the expiry with the old grant still on offer: refused, and the refusal is reused for a while.
      now = T0 + 11 * 60_000;
      expect((await info()).grant).toMatchObject({ status: 'expired' });
      expect(await names()).toEqual(['leer_guia']);
      expect(s.urls).toHaveLength(2);
      // The studio issues a new one: picked up at the next refresh.
      issued = now;
      now += 61_000;
      expect((await info()).grant).toMatchObject({ status: 'ok', expiresAt: iso(issued + 10 * 60_000) });
      expect(s.urls).toHaveLength(3);
    });

    it('a revoked integration stops working at the next refresh; a studio that does not answer keeps a live grant', async () => {
      now = T0;
      let mode: 'ok' | 'revoked' | 'down' = 'ok';
      const s = studio(async () => {
        if (mode === 'down') throw new Error('ECONNREFUSED');
        return mode === 'ok' ? json(await sign(grantAt(T0))) : json({ error: 'Integración no válida o revocada.' }, 404);
      });
      await start({ manifest: manifest(), grant: { fetch: s.fetch, now: () => now, refreshMs: 60_000 } });
      expect((await info()).grant).toMatchObject({ status: 'ok' });
      mode = 'down';
      now = T0 + 61_000;
      expect((await info()).grant).toMatchObject({ status: 'ok' });
      mode = 'revoked';
      now = T0 + 122_000;
      expect((await info()).grant).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('revocada') });
      expect(await names()).toEqual(['leer_guia']);
      // Nothing cached survives a revocation: a later outage does not bring the old grant back.
      mode = 'down';
      now = T0 + 183_000;
      expect((await info()).grant).toMatchObject({ status: 'unavailable' });
    });

    it('the endpoint must pass the outbound policy like any other URL the server fetches', async () => {
      now = T0;
      const s = studio(async () => json(await sign(grantAt(now, { origins: ['http://localhost:5174'] }))));
      const local: HostManifest = { ...loadHostManifest('demo-negocio'), host: { name: 'Local', domain: 'localhost' }, avatar: { ...avatar, endpoint: 'http://127.0.0.1:8788/v1/embed/vk_local_local_local_local_l' } };
      await start({ manifest: local, grant: { fetch: s.fetch, now: () => now } });
      expect((await info()).grant).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('https') });
      expect(s.urls).toEqual([]);
      await start({ manifest: local, grant: { fetch: s.fetch, now: () => now }, connectors: { urlPolicy: LOCAL } });
      expect((await info()).grant).toMatchObject({ status: 'ok' });
    });
  });
});
