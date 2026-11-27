import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';
import { assertBrowserEnvironment, browserOrigin, browserUrl } from './tests/e2e/environment';
assertBrowserEnvironment();
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: {
    baseURL: browserOrigin,
    serviceWorkers: 'block',
    actionTimeout: 15000,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL },
    },
  ],
  webServer: {
    command: 'npx tsx scripts/browser-test-server.ts',
    url: browserUrl('/login'),
    // A healthy URL does not prove which database an old server is using.
    reuseExistingServer: false,
    timeout: 60000,
  },
});
