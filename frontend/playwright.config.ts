import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);
const previewBaseUrl = 'http://127.0.0.1:4173';
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const baseURL = externalBaseUrl || previewBaseUrl;

export default defineConfig({
  testDir: './e2e',
  ...(externalBaseUrl ? {} : { testIgnore: ['**/production-integration.spec.ts'] }),
  outputDir: 'test-results/playwright',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  ...(isCi ? { workers: 1 } : {}),
  reporter: isCi
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-1280x800',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: 'npm run preview -- --host 127.0.0.1 --port 4173',
          url: previewBaseUrl,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
});
