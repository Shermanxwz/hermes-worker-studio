import { expect, test } from '@playwright/test';

const EXPECTED_CANDIDATE = process.env.HWS_CANDIDATE_SHA || '';
const PRIMARY_PAGES = [
  { nav: '对话', heading: null, selector: '.hws3-conversation' },
  { nav: 'Worker', heading: 'Hermes Worker', selector: '.hws3-page' },
  { nav: '模型', heading: '模型', selector: '.hws3-page' },
  { nav: 'MOA', heading: 'MOA', selector: '.hws3-moa-page' },
  { nav: '完全访问', heading: '完全访问', selector: '.hws3-page' },
  { nav: '完整历史', heading: '完整历史', selector: '.hws3-page' },
];

async function assertNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(metrics.html).toBeLessThanOrEqual(metrics.viewport + 2);
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 2);
}

async function assertProductViewportBounded(page) {
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('.hws3-root');
    const rect = root?.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      top: rect?.top ?? 0,
      bottom: rect?.bottom ?? 0,
      height: rect?.height ?? 0,
    };
  });
  expect(metrics.height).toBeGreaterThan(0);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 2);
}

async function assertExclusiveProductHome(page) {
  // Hermes 0.20.6 has no public exclusive-shell field, so the installed
  // preview uses a narrow host-shell compatibility layer. If the official
  // shell is present in the DOM, it must not be visible on the Studio root.
  for (const selector of ['#app-sidebar', '#app-sidebar + div > header', '#root > [data-layout-variant] > header']) {
    const hostShell = page.locator(selector);
    if (await hostShell.count()) await expect(hostShell).toBeHidden();
  }
  await expect(page.locator('.hws3-advanced')).toHaveCount(0);
  const nativeDashboard = page.locator('.hws3-native-dashboard-link');
  await expect(nativeDashboard).toHaveCount(1);
  await expect(nativeDashboard).toHaveAttribute('href', /\/sessions$/);
  await expect(nativeDashboard).toContainText('高级 · Hermes Dashboard');
  await expect(page.locator('a[href$="/sessions"]:visible')).toHaveCount(1);
  for (const suffix of ['/cron', '/skills', '/plugins', '/mcp', '/profiles', '/analytics', '/logs', '/config']) {
    await expect(page.locator(`a[href$="${suffix}"]:visible`), `native Hermes navigation leaked ${suffix} onto product home`).toHaveCount(0);
  }
}

async function assertRunningCandidate(page) {
  expect(EXPECTED_CANDIDATE, 'HWS_CANDIDATE_SHA must identify the exact browser-seal candidate').toMatch(/^[0-9a-f]{40}$/);
  const caps = await page.evaluate(async () => {
    const sdk = window.__HERMES_PLUGIN_SDK__;
    if (!sdk?.fetchJSON) throw new Error('Hermes Dashboard Plugin SDK fetchJSON is unavailable');
    return sdk.fetchJSON('/api/plugins/hermes-worker-studio/product-capabilities');
  });
  expect(caps?.version).toBe(3);
  expect(caps?.candidate_sha).toBe(EXPECTED_CANDIDATE);
}

async function openPrimary(page, label, mobile) {
  if (mobile) {
    const trigger = page.locator('.hws3-mobile-bar button[aria-label="打开菜单"]');
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.hws3-mobile-scrim')).toBeVisible();
  }
  // Navigation labels share their button with a decorative icon, so match
  // the semantic button containing the label rather than an exact text node.
  const item = page.locator('.hws3-nav button').filter({ hasText: label }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.locator('.hws3-nav button[aria-current="page"]')).toContainText(label);
  if (mobile) await expect(page.locator('.hws3-mobile-scrim')).toHaveCount(0);
}

async function assertPrimaryPage(page, spec) {
  await expect(page.locator(spec.selector).first()).toBeVisible();
  if (spec.heading) await expect(page.getByRole('heading', { name: spec.heading, exact: true }).first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertProductViewportBounded(page);
}

test('Worker Studio product shell is usable at the real target', async ({ page }, testInfo) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('Hermes Worker Studio');
  await expect(page.locator('.hws3-root')).toBeVisible();
  await assertRunningCandidate(page);
  await expect(page.getByText('Hermes Worker Studio', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.hws3-composer textarea')).toBeVisible();
  await expect(page.locator('.hws3-composer textarea')).toHaveAttribute('aria-label', '给 Hermes 发送消息');
  await expect(page.locator('.hws3-send')).toHaveAttribute('aria-label', '发送消息');
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
  await expect(page.locator('.hws3-plus')).toHaveAttribute('aria-label', '添加文件');

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

  // Every existing first-level product page is part of the seal matrix. This
  // catches layout regressions that a chat-only screenshot cannot see.
  for (const spec of PRIMARY_PAGES) {
    await openPrimary(page, spec.nav, mobile);
    await assertPrimaryPage(page, spec);
    if (spec.nav === '完全访问') {
      await expect(page.getByText(/Clarify 等交互请求自动 Skip\/Decline/)).toBeVisible();
      await expect(page.getByText(/Hardline Blocklist/)).toBeVisible();
      await expect(page.locator('.hws3-switch')).toHaveAttribute('aria-label', /完全访问/);
    }
  }

  // Return to chat before checking the viewport-bound composer contract.
  await openPrimary(page, '对话', mobile);
  await expect(page.locator('.hws3-composer')).toBeVisible();
  const composerBox = await page.locator('.hws3-composer').boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual((await page.evaluate(() => window.innerHeight)) + 2);
  await assertNoHorizontalOverflow(page);
  await assertProductViewportBounded(page);
  await page.screenshot({ path: testInfo.outputPath('worker-studio.png'), fullPage: true });
});

test('native Hermes Dashboard keeps the Worker Studio return path', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'native mobile shell is upstream-owned; product mobile pages are sealed in the primary test');

  // The return slot is intentionally available when native navigation is
  // entered through Studio's Advanced link. A cold direct /sessions load is
  // repaired to the product root by the pinned Hermes compatibility layer.
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.hws3-native-dashboard-link')).toBeVisible();
  await page.locator('.hws3-native-dashboard-link').click();
  await expect(page).toHaveURL(/\/sessions$/);
  const backs = page.getByText('← Worker Studio', { exact: true });
  const back = backs.first();
  await expect(back).toBeVisible();
  expect(await page.locator('a[href$="/skills"]').count()).toBeGreaterThanOrEqual(1);
  expect(await page.locator('a[href$="/config"]').count()).toBeGreaterThanOrEqual(1);
  await back.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.hws3-root')).toBeVisible();
  await assertRunningCandidate(page);
  await assertExclusiveProductHome(page);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('native-return.png'), fullPage: true });
});
