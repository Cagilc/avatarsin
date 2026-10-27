import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, openContext, test } from '../fixtures.ts';
import { PORTS } from '../playwright.config.ts';

/**
 * The avatar designed in the studio operates in the demo and in a plain HTML page: published and
 * integrated here, named by a host manifest that this test writes, then served by a Vex Core
 * started here with that manifest. The grant fetched from the studio limits the tools; the
 * published personality names the operator.
 */

const STUDIO = `http://localhost:${PORTS.server}`;
const DEMO = `http://localhost:${PORTS.demo}`;
const SITE = `http://localhost:${PORTS.host}`;
const CORE = `http://127.0.0.1:${PORTS.core}`;
const TOOLS = ['buscar', 'leer_expediente', 'crear_expediente', 'crear_tarea', 'redactar_correo', 'enviar_correo'];
const LONG_REQUEST = /^Busca a Laura Pérez, abre expediente/;

let core: ChildProcess | null = null;
let dir: string | null = null;

async function newAvatarFromSample(page: Page, name: string) {
  await page.goto('/');
  await page.getByTestId('dev-login').click();
  await page.getByTestId('new-avatar-name').fill(name);
  await page.getByTestId('new-avatar').click();
  await page.getByTestId('use-sample').click();
  await expect(page.locator('.part-row')).toHaveCount(7);
}

async function acceptProposal(page: Page, message: string) {
  await page.getByTestId('assistant-input').fill(message);
  await page.getByTestId('assistant-propose').click();
  await expect(page.getByTestId('proposal')).toBeVisible();
  const before = await page.getByTestId('revision').innerText();
  await page.getByTestId('assistant-accept').click();
  await expect(page.getByTestId('proposal')).toBeHidden();
  await expect(page.getByTestId('revision')).not.toHaveText(before);
}

async function waitFor(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} no responde`);
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeAll(async () => {
  // 1. Design, publish and integrate an avatar in the studio, as the owner would.
  const context = await openContext();
  const page = await context.newPage();
  await newAvatarFromSample(page, 'Pixel');
  await acceptProposal(page, 'dibujo plano, la antena rebota, se llama Pixel');
  const token = await page.evaluate(() => sessionStorage.getItem('vexstudio.token'));
  expect(token).toBeTruthy();
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${STUDIO}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const { avatars } = await api<{ avatars: Array<{ id: string; name: string; revision: number }> }>('GET', '/api/avatars');
  const pixel = avatars.find((a) => a.name === 'Pixel')!;
  const saved = await api<{ revision: number }>('POST', `/api/avatars/${pixel.id}/ops`, {
    ops: [
      { op: 'setPersonality', patch: { displayName: 'Pixel', tone: 'divertido', greeting: '¡Hola! Soy Pixel.' } },
      { op: 'setCapabilities', capabilities: { tools: TOOLS, maxRisk: 'irreversible' } },
    ],
    baseRevision: pixel.revision,
    summary: 'Personalidad y capacidades para la demo',
  });
  await api('POST', `/api/avatars/${pixel.id}/publish`, {});
  const { key } = await api<{ key: { id: string } }>('POST', `/api/avatars/${pixel.id}/keys`, { label: 'Demo', origins: [DEMO, SITE], tools: TOOLS, maxRisk: 'irreversible' });
  const signing = await api<{ publicKey: string; keyId: string }>('GET', `/api/avatars/${pixel.id}/keys`);
  await context.close();
  expect(saved.revision).toBeGreaterThan(pixel.revision);

  // 2. A host manifest that names that integration, and a Vex Core started with it.
  dir = mkdtempSync(join(tmpdir(), 'vex-host-'));
  const manifest = {
    format: 'vex-host',
    version: 1,
    host: { name: 'Demo Negocio', domain: 'localhost' },
    avatar: { endpoint: `${STUDIO}/v1/embed/${key.id}`, publicKey: signing.publicKey, keyId: signing.keyId },
    screenContext: { pantalla: { description: 'Vista abierta.' }, contactoId: { description: 'Id del contacto abierto.' }, contactoEmail: { description: 'Correo del contacto abierto.' }, expedienteId: { description: 'Expediente abierto.' } },
    features: { announcements: true, quickActions: true, tours: true, presenter: true },
    tours: [{ id: 'paseo', title: 'Un paseo', steps: [{ target: 'titulo', say: 'Este es el título de la página.' }, { target: 'no-existe', say: 'Esto no está.' }, { say: 'Y eso es todo.', pose: 'celebrate' }] }],
    presenter: { reset: { url: `${SITE}/reset`, secretEnv: 'DEMO_RESET_SECRET' } },
    scripts: [
      {
        id: 'demo',
        title: 'Demo para un cliente',
        scenes: [
          { target: 'titulo', say: 'Esta es la plataforma del cliente.', pose: 'point', notes: 'Saludar y presentar a Pixel.' },
          { say: 'Pixel busca a una persona con sus propias palabras.', action: 'buscar-laura', notes: 'Enter lanza la búsqueda.' },
          { target: 'no-existe', say: 'Esto no se ve en esta página.' },
          { say: 'Cada acción queda en la auditoría con quién y cuándo.', pose: 'attention' },
          { say: '¡Y eso es Pixel!', pose: 'celebrate' },
        ],
      },
    ],
    quickActions: [
      { id: 'buscar-laura', label: 'Buscar a Laura', icon: '🔎', tool: 'buscar', params: { consulta: 'Laura Pérez', tipo: 'contactos' } },
      { id: 'quien-es-marco', label: '¿Quién es Marco?', prompt: '¿Quién es Marco Rossi?' },
    ],
    announcements: [{ id: 'bienvenida', title: 'Pixel ya opera aquí', body: 'Pídeme cosas con tus propias palabras.', cta: { kind: 'quickAction', id: 'buscar-laura' } }],
  };
  const file = join(dir, 'manifest.json');
  writeFileSync(file, JSON.stringify(manifest));
  const apiDir = fileURLToPath(new URL('../../apps/api/', import.meta.url));
  // Its output goes to a file, not to pipes: a pipe would keep this worker alive after the tests.
  const log = openSync(join(dir, 'vex-core.log'), 'a');
  core = spawn(process.execPath, ['src/server.ts'], {
    cwd: apiDir,
    env: { ...process.env, PORT: String(PORTS.core), HOST: '127.0.0.1', VEX_DB: 'memory', VEX_PROVIDER: 'scripted', VEX_DEMO_LOGIN: '1', VEX_RATE_LIMIT: '200', CORS_ORIGIN: `${DEMO},${SITE}`, VEX_HOST_MANIFEST: file, DEMO_RESET_SECRET: 'secreto-de-la-demo' },
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  core.unref();
  await waitFor(`${CORE}/health`, 30_000);

  // Vex Core read and verified the grant: the integration's tools, the published personality.
  const info = (await (await fetch(`${CORE}/operator/info`)).json()) as { grant: { status: string; tools?: string[] }; personality: { name: string }; tools: Array<{ name: string }> };
  expect(info.grant.status).toBe('ok');
  expect(info.grant.tools).toEqual(TOOLS);
  expect(info.personality.name).toBe('Pixel');
  expect(info.tools.map((t) => t.name)).toEqual([...TOOLS, 'leer_guia']);
});

test.afterAll(async () => {
  if (core && core.exitCode === null) {
    const gone = new Promise<void>((resolve) => core!.once('exit', () => resolve()));
    core.kill();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5_000))]);
  }
  core = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('el avatar del estudio opera en la demo: nombre, estados por fase y el correo real con confirmación', async ({ page }) => {
  await page.goto(`${DEMO}/`);
  await expect(page.getByRole('button', { name: /Laura Pérez laura\.perez/ })).toBeVisible();
  const assistant = page.locator('vex-assistant');
  await expect(assistant.locator('.name')).toHaveText('Pixel');
  const avatar = assistant.locator('vex-avatar');
  await expect(avatar).toHaveCount(1);
  // Drawn from the signed package: the runtime put the parts on the stage.
  await expect.poll(() => avatar.evaluate((el) => (el as HTMLElement & { avatar: { personality: { displayName: string } } | null }).avatar?.personality.displayName ?? null)).toBe('Pixel');

  await page.getByRole('button', { name: LONG_REQUEST }).click();
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  const card = page.getByRole('alertdialog');
  await expect(card).toContainText('laura.perez@ejemplo.es');
  await expect(page.locator('.vex .label')).toHaveText('espero tu OK');
  await expect(avatar).toHaveAttribute('state', 'attention');
  await test.info().attach('esperando-ok', { body: await page.locator('.vex-head').screenshot(), contentType: 'image/png' });

  await card.getByRole('button', { name: 'Aprobar' }).click();
  await expect(page.locator('.msg.vex').last()).toContainText('Correo enviado a laura.perez@ejemplo.es');
  await expect(page.locator('.turn').last().locator('.step-state')).toHaveText(['hecho', 'hecho', 'hecho', 'hecho', 'hecho']);
  await expect(avatar).toHaveAttribute('state', 'happy');
  await expect(page.getByText(/Pedir documentación \(expediente EXP-\d{4}-\d+\)/).first()).toBeVisible();
});

test('una página HTML sin framework: dos líneas, el avatar del estudio y una petición', async ({ page }) => {
  await page.goto(`${SITE}/asistente?api=${encodeURIComponent(CORE)}`);
  await expect(page.locator('#status')).toHaveText('listo:Pixel avatar:Pixel');
  const assistant = page.locator('vex-assistant');
  await expect(assistant.locator('.who')).toHaveText('actúa como César Gil');
  // The registry knows the title and leaves the password field out, value included.
  const snapshot = await assistant.evaluate((el) => (el as HTMLElement & { registry: { snapshot(): unknown[] } }).registry.snapshot());
  expect(snapshot).toEqual([{ id: 'titulo', role: 'heading', label: 'Página simple' }]);

  // The announcement from the manifest, dismissed once; the quick action from the manifest, through the loop.
  const news = assistant.locator('.news-item:not(.tour-card)');
  await expect(news).toHaveCount(1);
  await expect(news).toContainText('Pixel ya opera aquí');
  await news.getByRole('button', { name: 'Entendido' }).click();
  await expect(news).toHaveCount(0);
  await assistant.getByRole('button', { name: '🔎 Buscar a Laura' }).click();
  await expect(page.locator('.msg.vex').last()).toContainText('Hecho (Buscar a Laura)');
  await expect(page.locator('.turn').last().locator('.step-text').first()).toContainText('Buscar "Laura Pérez" en contactos');
  await expect(page.locator('.turn').last().locator('.step-state').first()).toHaveText('hecho');

  await assistant.getByRole('button', { name: '¿Quién es Marco?' }).click();
  await expect(page.locator('.msg.vex').last()).toContainText('Marco Rossi');
  await expect(page.locator('.turn').last().locator('.step-state').first()).toHaveText('hecho');
});

test('el tour: la mascota sale del panel, señala el título, salta lo que no está y vuelve celebrando', async ({ page }) => {
  await page.goto(`${SITE}/asistente?api=${encodeURIComponent(CORE)}`);
  await expect(page.locator('#status')).toHaveText('listo:Pixel avatar:Pixel');
  const assistant = page.locator('vex-assistant');
  await page.evaluate(() => {
    const w = window as Window & { __tour?: string[] };
    w.__tour = [];
    document.getElementById('vex')!.addEventListener('vex-tour', (e) => {
      const d = (e as CustomEvent<{ event: string; index?: number }>).detail;
      w.__tour!.push(`${d.event}${d.index ?? ''}`);
    });
  });
  const card = assistant.locator('.tour-card');
  await expect(card).toContainText('Tour: Un paseo');
  await card.getByRole('button', { name: 'Empezar' }).click();

  const bubble = assistant.locator('.tour-bubble');
  await expect(bubble).toContainText('Este es el título de la página.');
  await expect(bubble).toContainText('1 de 3');
  const mascot = assistant.locator('.tour-mascot vex-avatar');
  await expect(mascot).toHaveAttribute('state', 'point');
  await expect(mascot).toHaveAttribute('aim', /^-?\d+$/);
  await expect(assistant.locator('.tour-highlight')).toBeVisible();
  await test.info().attach('tour-paso-1', { body: await page.screenshot(), contentType: 'image/png' });

  // The second step's target is not on the page: straight to the last one, spoken from the panel.
  await bubble.getByRole('button', { name: 'Siguiente' }).click();
  await expect(bubble).toContainText('Y eso es todo.');
  await expect(assistant.locator('.avatar vex-avatar')).toHaveAttribute('state', 'celebrate');
  await bubble.getByRole('button', { name: 'Terminar' }).click();
  await expect(bubble).toHaveCount(0);
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __tour?: string[] }).__tour)).toEqual(['start', 'step0', 'step2', 'done']);

  // Completed for this person: a reload no longer offers it. With reduced motion, nothing travels and Escape leaves.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('#status')).toHaveText('listo:Pixel avatar:Pixel');
  await expect(assistant.locator('.tour-card')).toHaveCount(0);
  await assistant.evaluate((el) => (el as HTMLElement & { startTour(id: string): Promise<void> }).startTour('paseo'));
  await expect(assistant.locator('.tour-stage')).toHaveClass(/reduced/);
  await expect(assistant.locator('.tour-bubble')).toContainText('Este es el título');
  await page.keyboard.press('Escape');
  await expect(assistant.locator('.tour-bubble')).toHaveCount(0);
  await expect(assistant.locator('.avatar vex-avatar')).toHaveCount(1);
});

test('el modo presentador: cinco escenas con el teclado, una acción sin modelo, el coste y el reinicio firmado', async ({ page }) => {
  await page.goto(`${SITE}/asistente?api=${encodeURIComponent(CORE)}&presenter=1`);
  await expect(page.locator('#status')).toHaveText('listo:Pixel avatar:Pixel');
  const assistant = page.locator('vex-assistant');
  await page.evaluate(() => {
    const w = window as Window & { __script?: string[] };
    w.__script = [];
    document.getElementById('vex')!.addEventListener('vex-script', (e) => {
      const d = (e as CustomEvent<{ event: string; index?: number; action?: string }>).detail;
      w.__script!.push(`${d.event}${d.index ?? ''}${d.action ? `:${d.action}` : ''}`);
    });
  });
  await assistant.evaluate((el) => (el as HTMLElement & { startScript(id: string): Promise<void> }).startScript('demo'));

  // Scene 1 points at the title; the strip shows where we are and the presenter's notes, the bubble does not.
  const bar = assistant.locator('.presenter-bar');
  await expect(bar).toContainText('Demo para un cliente · escena 1 de 5');
  await expect(bar).toContainText('Saludar y presentar a Pixel.');
  await expect(assistant.locator('.tour-bubble')).toContainText('Esta es la plataforma del cliente.');
  await expect(assistant.locator('.tour-bubble')).not.toContainText('Saludar');
  await expect(assistant.locator('.tour-highlight')).toBeVisible();
  await expect(bar).toContainText('coste: 0 tokens hoy');
  await test.info().attach('presentador-escena-1', { body: await page.screenshot(), contentType: 'image/png' });

  // → scene 2, Enter fires its quick action through the loop (scripted: no model, no cost).
  await page.keyboard.press('ArrowRight');
  await expect(bar).toContainText('escena 2 de 5');
  await page.keyboard.press('Enter');
  await expect(assistant.locator('.step.is-ok')).toHaveCount(1);
  await expect(assistant.locator('.msg.user')).toContainText('Botón: Buscar a Laura');
  await expect(bar).toContainText('coste: 0 tokens hoy');

  // → skips the scene whose target is not here, ← comes back, → → to the end.
  await page.keyboard.press('ArrowRight');
  await expect(bar).toContainText('escena 4 de 5');
  await page.keyboard.press('ArrowLeft');
  await expect(bar).toContainText('escena 2 de 5');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(bar).toContainText('escena 5 de 5');

  // The reset hook: signed with the secret the manifest names, through the guard; only an administrator may call it.
  await bar.locator('[data-action="reset"]').click();
  await expect(bar).toContainText('demo reiniciada');
  const last = (await (await fetch(`${SITE}/reset/last`)).json()) as { body: string; headers: Record<string, string> };
  expect(JSON.parse(last.body)).toMatchObject({ type: 'presenter_reset', host: 'Demo Negocio', principal: { id: 'u-cesar' } });
  const { createHmac } = await import('node:crypto');
  expect(last.headers['x-vex-signature']).toBe(`sha256=${createHmac('sha256', 'secreto-de-la-demo').update(last.body).digest('hex')}`);
  expect(last.headers['x-vex-event']).toBe('presenter_reset');
  const ana = ((await (await fetch(`${CORE}/platform/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'u-ana' }) })).json()) as { token: string }).token;
  expect((await fetch(`${CORE}/engage/presenter/reset`, { method: 'POST', headers: { authorization: `Bearer ${ana}`, 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);

  await page.keyboard.press('ArrowRight');
  await expect(assistant.locator('.presenter-bar')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __script?: string[] }).__script)).toEqual(['start', 'step0', 'step1', 'action1:buscar-laura', 'step3', 'step1', 'step3', 'step4', 'reset', 'done']);
});
