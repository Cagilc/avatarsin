import { expect, test } from '../fixtures.ts';

/** Vex, the operator's avatar, imported into the studio from its flattened rig: faces per state and visemes while talking. */
test('Vex entra en el estudio con sus caras y sus visemas', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('dev-login').click();
  await page.getByTestId('new-avatar-name').fill('Vex');
  await page.getByTestId('new-avatar').click();
  await page.getByTestId('use-vex').click();
  await expect(page.locator('.part-row')).toHaveCount(37);
  await expect(page.locator('.stage-avatar [data-part]')).toHaveCount(37);

  // At rest: neutral face only.
  const opacity = (part: string) => page.locator(`.stage-avatar [data-part="${part}"]`).evaluate((el) => el.getAttribute('opacity') ?? '1');
  await expect.poll(() => opacity('ojos-neutral')).toBe('1');
  await expect.poll(() => opacity('ojos-happy')).toBe('0.000');
  await expect.poll(() => opacity('visema-a')).toBe('0.000');

  // Talking: the mouth shapes take turns; no plain mouth shows.
  await page.getByTestId('state-select').selectOption('talk');
  const seen = new Set<string>();
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(60);
    const on = await page.locator('.stage-avatar [data-part^="visema-"]').evaluateAll((els) => els.filter((e) => (e.getAttribute('opacity') ?? '1') === '1').map((e) => e.getAttribute('data-part')!));
    for (const v of on) seen.add(v);
  }
  expect(seen.size).toBeGreaterThanOrEqual(4);
  await expect.poll(() => opacity('boca-neutral')).toBe('0.000');
  await expect.poll(() => opacity('ojos-happy')).toBe('1');
  await page.screenshot({ path: 'screens/6-vex-hablando.png' });
});
