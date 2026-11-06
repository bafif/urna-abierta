import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-lector',
  timeout: 240_000,
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL: process.env.LECTOR_URL },
});
