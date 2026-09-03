import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.HWS_DASHBOARD_URL || 'http://127.0.0.1:19119';
const apiKey = process.env.API_SERVER_KEY || '';
const evidence = process.env.HWS_UI_EVIDENCE || '.seal/ui-report.json';
const ignoreHTTPSErrors = process.env.HWS_SEAL_IGNORE_HTTPS_ERRORS === '1';

export default defineConfig({
  testDir: './tests',
  testMatch: 'target_ui.spec.mjs',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: '.seal/playwright-artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: evidence }],
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors,
    extraHTTPHeaders: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    {
      name: 'mobile-landscape-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 667, height: 375 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
});
