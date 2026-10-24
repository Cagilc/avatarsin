import { expect, test, type Page } from '@playwright/test';

const LONG_REQUEST = /^Busca a Laura Pérez, abre expediente/;

async function ask(page: Page, text: string) {
  await page.getByPlaceholder(/qué hacer/).fill(text);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
}

/** The avatar header, for screenshots of each phase. */
async function snapAvatar(page: Page, name: string) {
  await test.info().attach(name, { body: await page.locator('.vex-head').screenshot(), contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Wait until the demo has logged in and loaded the platform.
  await expect(page.getByRole('button', { name: /Laura Pérez laura\.perez/ })).toBeVisible();
});

test('completes a five-step request, stopping for the user to approve the real email', async ({ page }) => {
  await page.getByRole('button', { name: LONG_REQUEST }).click();
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();

  const card = page.getByRole('alertdialog');
  await expect(card).toBeVisible();
  // The card shows the stored draft, not the model's description of it.
  await expect(card).toContainText('laura.perez@ejemplo.es');
  await expect(card).toContainText('Pedir documentación');
  await expect(card).toContainText('Hola Laura');
  await expect(page.locator('.vex .label')).toHaveText('espero tu OK');
  await expect(page.getByRole('button', { name: 'Detener' })).toBeVisible();
  await snapAvatar(page, 'esperando-ok');

  await card.getByRole('button', { name: 'Aprobar' }).click();
  await expect(page.locator('.msg.vex').last()).toContainText('Correo enviado a laura.perez@ejemplo.es');
  await expect(page.locator('.turn').last().locator('.step-state')).toHaveText(['hecho', 'hecho', 'hecho', 'hecho', 'hecho']);
  // The platform view refreshes with the new record and the sent email.
  await expect(page.getByText(/Pedir documentación \(expediente EXP-\d{4}-\d+\)/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible();
  await snapAvatar(page, 'terminado');
});

test('a rejected email is not sent and Vex says it stopped', async ({ page }) => {
  await ask(page, 'Busca a Marco Rossi y mándale un correo con el presupuesto');
  const card = page.getByRole('alertdialog');
  await expect(card).toContainText('marco.rossi@ejemplo.it');
  await card.getByRole('button', { name: 'Rechazar' }).click();
  await expect(page.locator('.msg.vex').last()).toContainText('Me he detenido');
  await expect(page.locator('.turn').last().locator('.step-state').last()).toHaveText('rechazado');
  await expect(page.getByText('para marco.rossi@ejemplo.it')).toHaveCount(0);
});

test('Detener stops the run at the confirmation and nothing more happens', async ({ page }) => {
  await page.getByRole('button', { name: LONG_REQUEST }).click();
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();

  await page.getByRole('button', { name: 'Detener' }).click();
  await expect(page.getByText('Detenido. No he hecho nada más.')).toBeVisible();
  await expect(page.locator('.turn').last().locator('.step-state').last()).toHaveText('detenido');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible();
  await expect(page.locator('.vex .label')).toHaveText('Vex');
});

test('uses the selected contact as screen context ("este cliente")', async ({ page }) => {
  await page.getByRole('button', { name: /Marco Rossi marco\.rossi/ }).click();
  await expect(page.locator('.vex .hint code')).toContainText('"contactoId":"c-002"');
  await ask(page, 'Envíale el presupuesto por correo a este cliente');
  const card = page.getByRole('alertdialog');
  await expect(card).toContainText('marco.rossi@ejemplo.it');
  // No search was needed: the first step is already the draft.
  await expect(page.locator('.turn').last().locator('.step-text').first()).toContainText('Redactar correo a marco.rossi@ejemplo.it');
  await card.getByRole('button', { name: 'Rechazar' }).click();
  await expect(page.locator('.msg.vex').last()).toContainText('Me he detenido');
});

test('asks instead of acting when the request has no recipient', async ({ page }) => {
  await ask(page, 'Envía un correo con el presupuesto');
  await expect(page.locator('.msg.vex').last()).toContainText('¿A quién se lo envío?');
  await expect(page.locator('.turn').last().locator('.step')).toHaveCount(0);
});
