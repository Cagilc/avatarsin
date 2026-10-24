import { expect, test } from '@playwright/test';

test('the avatar lab renders every state, face and mouth, and the size switches the level of detail', async ({ page }) => {
  await page.goto('/#estados');
  await expect(page.getByRole('heading', { name: 'Laboratorio del avatar' })).toBeVisible();

  const section = (title: RegExp) => page.locator('.lab-section').filter({ has: page.getByRole('heading', { name: title }) });
  await expect(section(/^Estados/).locator('.lab-card')).toHaveCount(8);
  await expect(section(/^Expresiones/).locator('.lab-card')).toHaveCount(5);
  await expect(section(/^Visemas/).locator('.lab-card')).toHaveCount(9);
  // Every card actually draws the rig.
  await expect(page.locator('.lab-card svg')).toHaveCount(22);

  const size = section(/^Tamaño/);
  const slider = size.getByRole('slider');
  await slider.fill('40');
  await expect(size).toContainText('nivel head');
  await slider.fill('120');
  await expect(size).toContainText('nivel bust');
  await slider.fill('200');
  await expect(size).toContainText('nivel full');

  await test.info().attach('laboratorio', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('the scripted sequence steps through the phases of a request', async ({ page }) => {
  await page.goto('/#estados');
  const current = page.locator('.lab-seq .is-current');
  await expect(current).toContainText('greeting');
  await page.getByRole('button', { name: 'Siguiente paso' }).click();
  await expect(current).toContainText('listening');
  await page.getByRole('button', { name: 'Siguiente paso' }).click();
  await expect(current).toContainText('thinking');
});
