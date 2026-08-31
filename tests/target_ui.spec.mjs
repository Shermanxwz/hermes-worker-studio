import { expect, test } from '@playwright/test';

async function assertNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(metrics.html).toBeLessThanOrEqual(metrics.viewport + 2);
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 2);
}

test('Worker Studio product shell is usable at the real target', async ({ page }, testInfo) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('Hermes Worker Studio');
  await expect(page.locator('.hws3-root')).toBeVisible();
  await expect(page.getByText('Hermes Worker Studio', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.hws3-composer textarea')).toBeVisible();

  const mobile = testInfo.project.name.startsWith('mobile-');
  if (mobile) {
    const menu = page.locator('.hws3-mobile-bar button[title="菜单"]');
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator('.hws3-mobile-scrim')).toBeVisible();
    await expect(page.locator('.hws3-nav').getByText('Worker', { exact: true })).toBeVisible();
    await page.locator('.hws3-mobile-scrim').click();
    await expect(page.locator('.hws3-mobile-scrim')).toHaveCount(0);
  } else {
    await expect(page.locator('.hws3-sidebar')).toBeVisible();
    for (const label of ['对话', 'Worker', '模型', '完全访问', '完整历史']) {
      await expect(page.locator('.hws3-nav').getByText(label, { exact: true })).toBeVisible();
    }
  }

  const composerBox = await page.locator('.hws3-composer').boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual((await page.evaluate(() => window.innerHeight)) + 2);
  await assertNoHorizontalOverflow(page);

  await page.screenshot({ path: testInfo.outputPath('worker-studio.png'), fullPage: true });
});

test('native Hermes Dashboard keeps the Worker Studio return path', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'desktop navigation contract is sufficient; mobile shell is covered separately');

  await page.goto('/sessions', { waitUntil: 'domcontentloaded' });
  const back = page.getByText('← Worker Studio', { exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.hws3-root')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('native-return.png'), fullPage: true });
});
