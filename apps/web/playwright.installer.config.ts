import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-installer',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: process.env.INSTALLER_URL },
});
