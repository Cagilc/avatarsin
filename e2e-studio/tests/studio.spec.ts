import { expect, test, type Page } from '@playwright/test';
import { PORTS } from '../playwright.config.ts';

const SERVER = `http://localhost:${PORTS.server}`;
const HOST = `http://localhost:${PORTS.host}`;
const INTRUDER = `http://localhost:${PORTS.intruder}`;
const SHOTS = 'screens';

async function newAvatarFromSample(page: Page, name: string) {
  await page.goto('/');
  await page.getByTestId('dev-login').click();
  await page.getByTestId('new-avatar-name').fill(name);
  await page.getByTestId('new-avatar').click();
  await page.getByTestId('use-sample').click();
  await expect(page.locator('.part-row')).toHaveCount(7);
  await expect(page.locator('.stage-avatar [data-part]')).toHaveCount(7);
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

/** Rotation of a part relative to another, read from what the runtime drew on the stage. */
async function relativeAngle(page: Page, part: string, parent: string): Promise<number> {
  return page.evaluate(
    ([part, parent]) => {
      const ang = (id: string) => {
        const t = document.querySelector(`.stage-avatar [data-part="${id}"]`)?.getAttribute('transform') ?? '';
        const m = /matrix\(([^)]+)\)/.exec(t)?.[1]?.split(' ').map(Number) ?? [1, 0];
        return (Math.atan2(m[1]!, m[0]!) * 180) / Math.PI;
      };
      return ang(part) - ang(parent);
    },
    [part, parent] as const,
  );
}

test('del logo al avatar animado: importar, proponer, responder y aceptar', async ({ page }) => {
  await newAvatarFromSample(page, 'Pixel');
  await page.screenshot({ path: `${SHOTS}/1-importado.png` });

  await page.getByTestId('assistant-input').fill('Una mascota simpática para una aseguradora, se llama Pixel');
  await page.getByTestId('assistant-propose').click();
  // Only what it cannot deduce: style and how the swinging parts behave.
  await expect(page.getByTestId('question-estilo')).toBeVisible();
  await expect(page.getByTestId('question-movimiento')).toBeVisible();
  await expect(page.getByTestId('question-material')).toHaveCount(0);

  // With volume, the material starts to matter: now it asks.
  await page.getByTestId('option-estilo-volumen').click();
  await expect(page.getByTestId('question-estilo')).toHaveCount(0);
  await expect(page.getByTestId('question-material')).toBeVisible();
  await page.getByTestId('option-material-brillante').click();
  await page.getByTestId('option-movimiento-rebote').click();
  await expect(page.locator('.stage-banner')).toContainText('Vista previa');
  await page.screenshot({ path: `${SHOTS}/2-propuesta.png` });

  await page.getByTestId('assistant-accept').click();
  await expect(page.getByTestId('proposal')).toBeHidden();
  await expect(page.locator('.part-row', { hasText: 'antena' })).toContainText('Antena · muelle');
  await expect(page.locator('.part-row', { hasText: 'cabeza' })).toContainText('Cabeza');

  // Skeleton in the tree: the antenna hangs from the head, the head from the body.
  const ids = await page.locator('.stage-avatar [data-part]').evaluateAll((els) => els.map((e) => e.getAttribute('data-part')));
  expect(ids).toHaveLength(7);

  // Physics is live: jumping ("happy") makes the antenna swing relative to the head.
  await page.getByTestId('state-select').selectOption('happy');
  let peak = 0;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(40);
    peak = Math.max(peak, Math.abs(await relativeAngle(page, 'p6', 'p7')));
  }
  expect(peak).toBeGreaterThan(2);
  await page.screenshot({ path: `${SHOTS}/3-contento.png` });
});

test('el pivote se arrastra en reposo y queda fijado por la persona', async ({ page }) => {
  await newAvatarFromSample(page, 'Pivotes');
  await page.getByTestId('mode-rest').click();
  await page.getByTestId('part-p6').click();
  const handle = page.getByTestId('pivot-handle');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  const before = await page.getByTestId('revision').innerText();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y - 30, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('revision')).not.toHaveText(before);
  await expect(page.getByTestId('part-panel').locator('.origin.user').first()).toBeVisible();

  // The assistant no longer moves that pivot.
  const pivotX = await page.getByTestId('part-panel').locator('input[type=number]').first().inputValue();
  await acceptProposal(page, 'plano y que rebote');
  await page.getByTestId('part-p6').click();
  await expect(page.getByTestId('part-panel').locator('input[type=number]').first()).toHaveValue(pivotX);
});

test('el control de estilo cambia los materiales de todo el avatar', async ({ page }) => {
  await newAvatarFromSample(page, 'Estilo');
  await page.getByRole('tab', { name: 'Estilo y física' }).click();
  await page.getByTestId('realism').fill('0');
  await page.getByTestId('realism').dispatchEvent('pointerup');
  await expect(page.locator('.stage-avatar filter')).toHaveCount(0);
  await page.getByTestId('realism').fill('1');
  await page.getByTestId('realism').dispatchEvent('pointerup');
  await expect(page.locator('.stage-avatar filter')).toHaveCount(7);
  await page.screenshot({ path: `${SHOTS}/4-realista.png` });
});

test('publicar e incrustar en otro dominio: solo el sitio autorizado, y nada alterado', async ({ page, context }) => {
  await newAvatarFromSample(page, 'Integrado');
  await acceptProposal(page, 'dibujo plano, la antena rebota, se llama Pixel');
  await page.getByTestId('open-publish').click();
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('publish-panel')).toContainText('publicada y firmada');
  await page.getByTestId('key-label').fill('Web del cliente');
  await page.getByTestId('key-origins').fill(HOST);
  await page.getByTestId('key-create').click();
  const snippet = await page.getByTestId('snippet').innerText();
  const attr = (name: string) => new RegExp(`${name}="([^"]+)"`).exec(snippet)![1]!;
  const query = new URLSearchParams({ server: SERVER, endpoint: attr('endpoint'), pk: attr('public-key'), kid: attr('key-id'), state: 'wave' }).toString();

  // The customer's site shows it.
  const site = await context.newPage();
  await site.goto(`${HOST}/?${query}`);
  await expect(site.locator('#status')).toHaveText('listo:Pixel');
  await site.screenshot({ path: `${SHOTS}/5-sitio-cliente.png` });

  // Another site with the same snippet gets nothing.
  const other = await context.newPage();
  await other.goto(`${INTRUDER}/?${query}`);
  await expect(other.locator('#status')).toContainText('error:');

  // A package altered on the way is refused before anything is drawn.
  const tampered = await context.newPage();
  await tampered.route('**/v1/embed/*/package', async (route) => {
    const res = await route.fetch();
    const pkg = (await res.json()) as { document: { capabilities: { maxRisk: string } } };
    pkg.document.capabilities.maxRisk = 'irreversible';
    await route.fulfill({ response: res, json: pkg });
  });
  await tampered.goto(`${HOST}/?${query}`);
  await expect(tampered.locator('#status')).toContainText('firma no es válida');

  // So is an altered drawing.
  const swapped = await context.newPage();
  await swapped.route('**/v1/embed/*/assets/*', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace('#f59e0b', '#ff0000');
    await route.fulfill({ response: res, body });
  });
  await swapped.goto(`${HOST}/?${query}`);
  await expect(swapped.locator('#status')).toContainText('huella');

  // Revoking the key turns it off at once.
  await page.getByRole('button', { name: 'Revocar' }).click();
  await expect(page.getByTestId('key-item')).toContainText('Revocada');
  const after = await context.newPage();
  await after.goto(`${HOST}/?${query}`);
  await expect(after.locator('#status')).toContainText('error:');
});
