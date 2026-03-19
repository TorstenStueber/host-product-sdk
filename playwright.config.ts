import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    headless: true,
    browserName: 'chromium',
  },
  webServer: {
    command: 'npx vite --config e2e/vite.config.ts --port 3199',
    port: 3199,
    reuseExistingServer: true,
  },
});
