import { importPublicKey, verifyAsset, verifyPackage, type AvatarDocument, type Op } from '@vexstudio/format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, normalizeOrigin } from './app.ts';
import { HeuristicAssistant } from './assistant/index.ts';
import { hashPassword, TokenService } from './auth.ts';
import { loadSigner } from './signing.ts';
import { StudioStore } from './store.ts';

const STUDIO = 'http://localhost:5180';
const SITE = 'https://app.cliente.example';
const LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
    '<rect x="156" y="220" width="200" height="220" fill="#3b82f6"/>' +
    '<circle cx="256" cy="160" r="70" fill="#60a5fa"/>' +
    '<rect x="250" y="30" width="12" height="64" fill="#1e3a8a"/>' +
    '</svg>',
);

async function setup() {
  const store = new StudioStore(':memory:');
  const { signer } = await loadSigner({});
  const tokens = TokenService.ephemeral();
  store.addUser({ id: 'u-owner', email: 'cesar@example.com', name: 'César', role: 'owner', passwordHash: await hashPassword('una-clave-muy-larga') });
  store.addUser({ id: 'u-editor', email: 'ana@example.com', name: 'Ana', role: 'editor', passwordHash: await hashPassword('otra-clave-muy-larga') });
  const app = buildApp({ store, tokens, signer, assistant: new HeuristicAssistant(), allowedOrigins: [STUDIO] });
  const owner = tokens.issue({ id: 'u-owner', email: 'cesar@example.com', name: 'César', role: 'owner' });
  const editor = tokens.issue({ id: 'u-editor', email: 'ana@example.com', name: 'Ana', role: 'editor' });
  return { app, store, signer, owner, editor };
}

type Ctx = Awaited<ReturnType<typeof setup>>;
let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(async () => {
  await ctx.app.close();
  ctx.store.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function post(url: string, token: string | null, payload: unknown, headers: Record<string, string> = {}) {
  return ctx.app.inject({ method: 'POST', url, headers: { ...(token ? auth(token) : {}), ...headers }, payload: payload as object });
}

/** Creates an avatar from the three-shape logo, as the editor's import would. */
async function avatarWithLogo(token = ctx.owner): Promise<{ id: string; doc: AvatarDocument; revision: number }> {
  const created = (await post('/api/avatars', token, { name: 'Mascota' })).json() as { id: string; revision: number };
  const up = await ctx.app.inject({ method: 'POST', url: '/api/assets', headers: { ...auth(token), 'content-type': 'application/octet-stream' }, payload: LOGO });
  expect(up.statusCode).toBe(200);
  const asset = up.json() as { hash: string; width: number; height: number };
  const boxes = [
    { x: 156, y: 220, width: 200, height: 220 },
    { x: 186, y: 90, width: 140, height: 140 },
    { x: 250, y: 30, width: 12, height: 64 },
  ];
  const ops: Op[] = [
    { op: 'addSource', source: { id: 'logo', asset: asset.hash, kind: 'svg', width: asset.width, height: asset.height, placement: { x: 0, y: 0, scale: 1 } } },
    ...boxes.map((bbox, i): Op => ({ op: 'addPart', part: { id: `p${i}`, name: `Pieza ${i + 1}`, source: 'logo', nodes: [[i]], bbox, pivot: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }, parent: null, z: i, visible: true } })),
  ];
  const r = await post(`/api/avatars/${created.id}/ops`, token, { ops, baseRevision: created.revision, lock: false });
  expect(r.statusCode).toBe(200);
  const body = r.json() as { doc: AvatarDocument; revision: number };
  return { id: created.id, ...body };
}

describe('acceso privado', () => {
  it('sin token no hay nada', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/avatars' })).statusCode).toBe(401);
  });

  it('entra con correo y contraseña; el error no dice si la cuenta existe', async () => {
    const ok = await post('/api/login', null, { email: 'CESAR@example.com', password: 'una-clave-muy-larga' });
    expect(ok.statusCode).toBe(200);
    const wrong = await post('/api/login', null, { email: 'cesar@example.com', password: 'mala' });
    const ghost = await post('/api/login', null, { email: 'nadie@example.com', password: 'mala' });
    expect(wrong.statusCode).toBe(401);
    expect(ghost.json()).toEqual(wrong.json());
  });

  it('limita los intentos de login', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await post('/api/login', null, { email: 'cesar@example.com', password: 'mala' })).statusCode;
    expect(last).toBe(429);
  });

  it('el login sin contraseña solo existe en desarrollo', async () => {
    expect((await post('/api/dev-login', null, {})).statusCode).toBe(404);
  });

  it('rechaza peticiones que cambian algo desde otro origen', async () => {
    const r = await post('/api/avatars', ctx.owner, { name: 'X' }, { origin: 'https://evil.example' });
    expect(r.statusCode).toBe(403);
    const fine = await post('/api/avatars', ctx.owner, { name: 'X' }, { origin: STUDIO });
    expect(fine.statusCode).toBe(200);
    expect(fine.headers['access-control-allow-origin']).toBe(STUDIO);
  });

  it('un token manipulado no vale', async () => {
    const [v, payload, sig] = ctx.editor.split('.');
    const forged = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as { principal: { role: string } };
    forged.principal.role = 'owner';
    const token = `${v}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })).statusCode).toBe(401);
  });
});

describe('edición con historial', () => {
  it('guarda cada cambio como versión y detecta ediciones simultáneas', async () => {
    const a = await avatarWithLogo();
    const stale = await post(`/api/avatars/${a.id}/ops`, ctx.owner, { ops: [{ op: 'setInfo', name: 'Otro' }], baseRevision: a.revision - 1 });
    expect(stale.statusCode).toBe(409);
    const ok = await post(`/api/avatars/${a.id}/ops`, ctx.owner, { ops: [{ op: 'setInfo', name: 'Otro' }], baseRevision: a.revision });
    expect(ok.statusCode).toBe(200);
    const history = (await ctx.app.inject({ method: 'GET', url: `/api/avatars/${a.id}/history`, headers: auth(ctx.owner) })).json() as { history: unknown[] };
    expect(history.history).toHaveLength(3);
    const back = await post(`/api/avatars/${a.id}/revert`, ctx.owner, { revision: 2, baseRevision: a.revision + 1 });
    expect((back.json() as { doc: AvatarDocument }).doc.name).toBe('Mascota');
  });

  it('rechaza operaciones que no cumplen el esquema', async () => {
    const a = await avatarWithLogo();
    const r = await post(`/api/avatars/${a.id}/ops`, ctx.owner, { ops: [{ op: 'updatePart', id: 'p0', patch: { onclick: 'x' } }], baseRevision: a.revision });
    expect(r.statusCode).toBe(422);
  });

  it('un editor no cambia capacidades ni publica', async () => {
    const a = await avatarWithLogo(ctx.editor);
    const caps = await post(`/api/avatars/${a.id}/ops`, ctx.editor, { ops: [{ op: 'setCapabilities', capabilities: { maxRisk: 'irreversible' } }], baseRevision: a.revision });
    expect(caps.statusCode).toBe(403);
    expect((await post(`/api/avatars/${a.id}/publish`, ctx.editor, {})).statusCode).toBe(403);
  });
});

describe('asistente', () => {
  it('propone un borrador completo, pregunta solo lo que falta y no guarda hasta aceptar', async () => {
    const a = await avatarWithLogo();
    const p = (await post(`/api/avatars/${a.id}/assistant`, ctx.owner, { message: 'una mascota para la web' })).json() as { id: string; ops: Op[]; questions: Array<{ id: string }>; summary: string[] };
    expect(p.ops.length).toBeGreaterThan(0);
    expect(p.questions.map((q) => q.id)).toContain('estilo');
    expect(p.questions.length).toBeLessThanOrEqual(3);
    const still = (await ctx.app.inject({ method: 'GET', url: `/api/avatars/${a.id}`, headers: auth(ctx.owner) })).json() as { revision: number };
    expect(still.revision).toBe(a.revision);

    const accepted = await post(`/api/avatars/${a.id}/proposals/${p.id}/accept`, ctx.owner, { baseRevision: a.revision });
    expect(accepted.statusCode).toBe(200);
    const doc = (accepted.json() as { doc: AvatarDocument }).doc;
    expect(doc.parts.find((x) => x.id === 'p2')).toMatchObject({ parent: 'p1', role: 'antenna' });
    expect(doc.parts.find((x) => x.id === 'p2')!.physics?.enabled).toBe(true);
    expect(doc.states.idle).toBeDefined();
    expect(doc.provenance['part:p2:pivot']?.by).toBe('ai');
  });

  it('no pregunta lo que ya dice la petición', async () => {
    const a = await avatarWithLogo();
    const p = (await post(`/api/avatars/${a.id}/assistant`, ctx.owner, { message: 'estilo dibujo plano, que la antena rebote, se llama Pixel y es divertido' })).json() as { questions: unknown[]; ops: Op[] };
    expect(p.questions).toEqual([]);
    expect(p.ops).toContainEqual({ op: 'setPersonality', patch: { tone: 'divertido', displayName: 'Pixel' } });
  });

  it('una propuesta caduca si el avatar cambia antes de aceptarla', async () => {
    const a = await avatarWithLogo();
    const p = (await post(`/api/avatars/${a.id}/assistant`, ctx.owner, { message: '' })).json() as { id: string };
    await post(`/api/avatars/${a.id}/ops`, ctx.owner, { ops: [{ op: 'setInfo', name: 'Cambio' }], baseRevision: a.revision });
    expect((await post(`/api/avatars/${a.id}/proposals/${p.id}/accept`, ctx.owner, { baseRevision: a.revision + 1 })).statusCode).toBe(409);
  });

  it('respeta lo que fijó una persona', async () => {
    const a = await avatarWithLogo();
    const fixed = await post(`/api/avatars/${a.id}/ops`, ctx.owner, { ops: [{ op: 'updatePart', id: 'p2', patch: { pivot: { x: 1, y: 1 } } }], baseRevision: a.revision });
    const rev = (fixed.json() as { revision: number }).revision;
    const p = (await post(`/api/avatars/${a.id}/assistant`, ctx.owner, { message: '' })).json() as { id: string };
    const doc = ((await post(`/api/avatars/${a.id}/proposals/${p.id}/accept`, ctx.owner, { baseRevision: rev })).json() as { doc: AvatarDocument }).doc;
    expect(doc.parts.find((x) => x.id === 'p2')!.pivot).toEqual({ x: 1, y: 1 });
  });
});

describe('publicación e integraciones', () => {
  async function published() {
    const a = await avatarWithLogo();
    const p = (await post(`/api/avatars/${a.id}/assistant`, ctx.owner, { message: 'plano y que rebote' })).json() as { id: string };
    const acc = (await post(`/api/avatars/${a.id}/proposals/${p.id}/accept`, ctx.owner, { baseRevision: a.revision })).json() as { revision: number };
    const caps = await post(`/api/avatars/${a.id}/ops`, ctx.owner, { ops: [{ op: 'setCapabilities', capabilities: { tools: ['buscar_contacto', 'enviar_correo'], maxRisk: 'irreversible' } }], baseRevision: acc.revision });
    expect(caps.statusCode).toBe(200);
    const pub = await post(`/api/avatars/${a.id}/publish`, ctx.owner, {});
    expect(pub.statusCode).toBe(200);
    const key = ((await post(`/api/avatars/${a.id}/keys`, ctx.owner, { label: 'Web cliente', origins: [SITE], tools: ['buscar_contacto'], maxRisk: 'write' })).json() as { key: { id: string } }).key;
    return { id: a.id, key: key.id };
  }

  it('no publica un avatar sin piezas', async () => {
    const created = (await post('/api/avatars', ctx.owner, { name: 'Vacío' })).json() as { id: string };
    expect((await post(`/api/avatars/${created.id}/publish`, ctx.owner, {})).statusCode).toBe(409);
  });

  it('el sitio autorizado recibe un paquete firmado que se verifica, con sus recursos', async () => {
    const { key } = await published();
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/embed/${key}/package`, headers: { origin: SITE } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(SITE);
    const pkey = (await ctx.app.inject({ method: 'GET', url: '/v1/public-key' })).json() as { publicKey: string; keyId: string };
    const v = await verifyPackage(res.json(), await importPublicKey(pkey.publicKey), pkey.keyId);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const ref = v.pkg.assets[0]!;
    const asset = await ctx.app.inject({ method: 'GET', url: `/v1/embed/${key}/assets/${ref.hash}`, headers: { origin: SITE } });
    expect(asset.headers['content-security-policy']).toContain('sandbox');
    expect(await verifyAsset(new Uint8Array(asset.rawPayload), ref)).toBe(true);
  });

  it('otro sitio no puede cargarlo, ni pedir archivos que no son del paquete', async () => {
    const { key } = await published();
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/embed/${key}/package`, headers: { origin: 'https://copia.example' } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/embed/${key}/assets/${'b'.repeat(64)}`, headers: { origin: SITE } })).statusCode).toBe(404);
  });

  it('la integración solo puede estrechar lo aprobado', async () => {
    const { key } = await published();
    const g = (await ctx.app.inject({ method: 'GET', url: `/v1/embed/${key}/grant` })).json() as { grant: { tools: string[]; maxRisk: string; issuedAt: string; expiresAt: string } };
    expect(g.grant.tools).toEqual(['buscar_contacto']);
    expect(g.grant.maxRisk).toBe('write');
    // Short-lived: the host's backend asks again, so revoking the key takes effect within minutes.
    const life = Date.parse(g.grant.expiresAt) - Date.parse(g.grant.issuedAt);
    expect(life).toBeGreaterThan(0);
    expect(life).toBeLessThanOrEqual(15 * 60_000);
  });

  it('una clave revocada deja de funcionar al momento', async () => {
    const { key } = await published();
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/keys/${key}`, headers: auth(ctx.owner) })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/embed/${key}/package`, headers: { origin: SITE } })).statusCode).toBe(404);
  });

  it('valida los orígenes de una integración', () => {
    expect(normalizeOrigin('https://app.example.com')).toBe('https://app.example.com');
    expect(normalizeOrigin('https://app.example.com/ruta')).toBeNull();
    expect(normalizeOrigin('http://app.example.com')).toBeNull();
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
  });
});
