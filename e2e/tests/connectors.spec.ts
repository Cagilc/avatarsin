import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:8787';

async function ask(page: Page, text: string) {
  await page.getByPlaceholder(/qué hacer/).fill(text);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
}

// Start from a clean slate even when the servers are reused between runs.
test.beforeEach(async ({ request }) => {
  const login = await request.post(`${API}/platform/auth/demo`, { data: { userId: 'u-cesar' } });
  const { token } = (await login.json()) as { token: string };
  await request.delete(`${API}/connectors/citas`, { headers: { authorization: `Bearer ${token}` } });
});

test('a person imports a tool Vex never knew, approves its risks, and Vex uses it with confirmation', async ({ page }) => {
  await page.goto('/#conectores');
  await expect(page.getByRole('heading', { name: 'Conectores' })).toBeVisible();
  await expect(page.getByText(/Revisas como César Gil \(admin\)/)).toBeVisible();

  // Import from the third party's OpenAPI document alone.
  await page.getByRole('button', { name: 'Importar' }).click();
  const card = page.locator('.conn-card').filter({ hasText: 'Agenda de citas' });
  await expect(card.locator('tbody tr')).toHaveCount(6);
  const row = (name: string) => card.locator(`tr[data-tool="${name}"]`);
  await expect(row('citas_listar_huecos').locator('.risk')).toHaveText('Lectura');
  await expect(row('citas_crear_cita').locator('.risk')).toHaveText('Escritura');
  await expect(row('citas_cancelar_cita').locator('.risk')).toHaveText('Irreversible');
  await expect(row('citas_enviar_recordatorio').locator('.risk')).toHaveText('Irreversible');
  await expect(card.getByText('Sin revisar')).toHaveCount(6);
  await expect(card.locator('.pill')).toHaveText('0 de 6 activas');
  await test.info().attach('borrador', { body: await card.screenshot(), contentType: 'image/png' });

  // Lowering a suggested risk needs a written reason.
  await card.getByLabel('Riesgo de citas_cancelar_cita').selectOption('write');
  await expect(card.getByRole('button', { name: 'Guardar revisión' })).toBeDisabled();
  await card.getByLabel('Motivo para bajar el riesgo de citas_cancelar_cita').fill('Una cita cancelada se puede volver a reservar');
  await expect(card.getByRole('button', { name: 'Guardar revisión' })).toBeEnabled();

  // Everything on except cancelling; and a short guide for the model.
  for (const name of ['citas_listar_huecos', 'citas_listar_citas', 'citas_crear_cita', 'citas_obtener_cita', 'citas_enviar_recordatorio']) {
    await card.getByLabel(`Activar ${name}`).check();
  }
  await card.getByPlaceholder(/Para qué sirve/).fill('Reserva siempre un hueco que devuelva citas_listar_huecos.');
  await card.getByRole('button', { name: 'Guardar revisión' }).click();
  await expect(card.getByText('Revisión guardada')).toBeVisible();
  await expect(card.locator('.pill')).toHaveText('5 de 6 activas');
  await expect(row('citas_crear_cita').getByText(/Revisada por u-cesar/)).toBeVisible();
  await test.info().attach('revisado', { body: await card.screenshot(), contentType: 'image/png' });

  // Vex can now use it. A free day far ahead, so reruns against a reused service do not collide.
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Laura Pérez laura\.perez/ })).toBeVisible();
  const day = `2027-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`;
  await ask(page, `usa citas_listar_huecos {"fecha":"${day}"}`);
  await expect(page.locator('.msg.vex').last()).toContainText('Hecho (citas_listar_huecos)');
  const hour = ((await page.locator('.msg.vex').last().textContent()) ?? '').match(new RegExp(`${day}T(\\d{2}):00:00\\+01:00`))?.[1];
  expect(hour).toBeDefined();

  await ask(page, `usa citas_crear_cita {"body":{"cliente":"Laura Pérez","email":"laura.perez@ejemplo.es","inicio":"${day}T${hour}:00:00+01:00","motivo":"Entrega de documentación"}}`);
  const created = page.locator('.msg.vex').last();
  await expect(created).toContainText('Hecho (citas_crear_cita)');
  const id = ((await created.textContent()) ?? '').match(/CITA-\d+/)?.[0];
  expect(id).toBeDefined();

  // The reminder leaves the system: Vex shows the exact request and waits.
  await ask(page, `usa citas_enviar_recordatorio {"id":"${id}","body":{"canal":"email"}}`);
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Agenda de citas');
  await expect(confirm).toContainText('POST');
  await expect(confirm).toContainText(`/citas/${id}/recordatorio`);
  await expect(confirm).toContainText('"canal":"email"');
  await expect(page.locator('.vex .label')).toHaveText('espero tu OK');
  await test.info().attach('confirmacion', { body: await page.locator('aside.vex').screenshot(), contentType: 'image/png' });
  await confirm.getByRole('button', { name: 'Aprobar' }).click();
  await expect(page.locator('.msg.vex').last()).toContainText('Hecho (citas_enviar_recordatorio)');

  // What the person left off does not exist for Vex.
  await ask(page, `usa citas_cancelar_cita {"id":"${id}"}`);
  await expect(page.locator('.msg.vex').last()).toContainText('No tengo ninguna herramienta llamada citas_cancelar_cita');
});

test('a person without the admin role cannot connect tools', async ({ request }) => {
  const login = await request.post(`${API}/platform/auth/demo`, { data: { userId: 'u-ana' } });
  const { token } = (await login.json()) as { token: string };
  const res = await request.post(`${API}/connectors/import/openapi`, { headers: { authorization: `Bearer ${token}` }, data: { id: 'citas', url: 'http://127.0.0.1:8790/openapi.json' } });
  expect(res.status()).toBe(403);
});
