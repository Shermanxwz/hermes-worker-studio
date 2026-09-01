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

async function assertExclusiveProductHome(page) {
  await expect(page.locator('.hws3-hermes-nav a')).toHaveCount(0);
  const advanced = page.locator('.hws3-advanced');
  await expect(advanced.locator('summary')).toContainText('高级 · Hermes Dashboard');
  for (const suffix of ['/sessions', '/cron', '/skills', '/plugins', '/mcp', '/profiles', '/analytics', '/logs', '/config']) {
    await expect(advanced.locator(`a[href$="${suffix}"]`)).toHaveCount(1);
  }
  for (const suffix of ['/sessions', '/skills', '/plugins', '/mcp', '/config']) {
    const allNativeLinks = page.locator(`a[href$="${suffix}"]`);
    const advancedLinks = advanced.locator(`a[href$="${suffix}"]`);
    expect(await allNativeLinks.count(), `native Hermes shell leaked ${suffix} onto product home`).toBe(await advancedLinks.count());
  }
}

test('Worker Studio product shell is usable at the real target', async ({ page }, testInfo) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('Hermes Worker Studio');
  await expect(page.locator('.hws3-root')).toBeVisible();
  await expect(page.getByText('Hermes Worker Studio', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.hws3-composer textarea')).toBeVisible();
  await assertExclusiveProductHome(page);

  const gatewayContract = await page.evaluate(() => window.__HERMES_WORKER_STUDIO_GATEWAY_NATIVE__ || null);
  expect(gatewayContract).not.toBeNull();
  expect(gatewayContract.protocol).toBe('tui_gateway_jsonrpc_websocket');
  expect(gatewayContract.chat).toBe('prompt.submit');
  expect(gatewayContract.reconnect).toBe('session.resume(close_on_disconnect=false)');
  expect(gatewayContract.context).toEqual(['session.usage', 'session.context_breakdown']);
  expect(gatewayContract.compact).toEqual(['status.update:compacting', 'status.update:compacted']);
  expect(gatewayContract.plan).toBe('todo.updated');
  expect(gatewayContract.stop).toBe('session.interrupt');
  expect(gatewayContract.steer).toBe('session.steer');
  expect(gatewayContract.approval).toBe('approval.respond');
  expect(gatewayContract.attachments).toEqual(['image.attach_bytes', 'pdf.attach', 'file.attach']);
  expect(gatewayContract.unattended_input).toContain('clarify.respond');
  expect(gatewayContract.unattended_input).toContain('mcp.setup.respond');

  const picker = page.locator('.hws3-composer input[type="file"]');
  await expect(picker).toHaveCount(1);
  await expect(picker).not.toHaveAttribute('accept', /image/i);
  await expect(page.locator('.hws3-plus')).toHaveAttribute('title', '添加文件');

  const mobile = testInfo.project.name.startsWith('mobile-');
  if (!mobile) {
    const gatewayProbe = await page.evaluate(async () => {
      const sdk = window.__HERMES_PLUGIN_SDK__;
      const title = `HWS browser gateway probe ${Date.now()}`;
      const created = await sdk.fetchJSON('/api/plugins/hermes-worker-studio/hermes/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, source: 'hermes_worker_studio_seal' }),
      });
      const sessionId = created?.session?.id || created?.session_id || created?.id;
      if (!sessionId) throw new Error(`Hermes Session create returned no id: ${JSON.stringify(created)}`);
      try {
        const context = await sdk.fetchJSON(`/api/plugins/hermes-worker-studio/hermes/sessions/${encodeURIComponent(sessionId)}/context`);
        return { sessionId, context };
      } finally {
        await sdk.fetchJSON(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      }
    });
    expect(gatewayProbe.sessionId).toBeTruthy();
    expect(gatewayProbe.context.available).toBe(true);
    expect(gatewayProbe.context.source).toBe('hermes.gateway.session.usage');
    expect(gatewayProbe.context.measurement).toBe('Hermes Gateway');
    expect(gatewayProbe.context.context_used == null || Number.isFinite(Number(gatewayProbe.context.context_used))).toBe(true);
    expect(gatewayProbe.context.context_max == null || Number.isFinite(Number(gatewayProbe.context.context_max))).toBe(true);
  }

  if (mobile) {
    const menu = page.locator('.hws3-mobile-bar button[title="菜单"]');
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator('.hws3-mobile-scrim')).toBeVisible();
    await expect(page.locator('.hws3-nav').getByText('Worker', { exact: true })).toBeVisible();
    await expect(page.locator('.hws3-advanced summary')).toContainText('高级 · Hermes Dashboard');
    await page.locator('.hws3-mobile-scrim').click();
    await expect(page.locator('.hws3-mobile-scrim')).toHaveCount(0);
  } else {
    await expect(page.locator('.hws3-sidebar')).toBeVisible();
    for (const label of ['对话', 'Worker', '模型', '完全访问', '完整历史']) {
      await expect(page.locator('.hws3-nav').getByText(label, { exact: true })).toBeVisible();
    }
    await page.locator('.hws3-nav').getByText('完全访问', { exact: true }).click();
    await expect(page.getByText(/Clarify 等交互请求自动 Skip\/Decline/)).toBeVisible();
    await expect(page.getByText(/Hardline Blocklist/)).toBeVisible();
    await page.locator('.hws3-nav').getByText('对话', { exact: true }).click();
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
  const backs = page.getByText('← Worker Studio', { exact: true });
  expect(await backs.count()).toBeGreaterThanOrEqual(1);
  const back = backs.first();
  await expect(back).toBeVisible();
  expect(await page.locator('a[href$="/skills"]').count()).toBeGreaterThanOrEqual(1);
  expect(await page.locator('a[href$="/config"]').count()).toBeGreaterThanOrEqual(1);
  await back.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.hws3-root')).toBeVisible();
  await assertExclusiveProductHome(page);
  await page.screenshot({ path: testInfo.outputPath('native-return.png'), fullPage: true });
});
