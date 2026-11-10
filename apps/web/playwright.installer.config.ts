import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-installer',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  // A computer in Spanish, so the installer starts in Spanish; a test that wants another language says so.
  use: { ...devices['Desktop Chrome'], baseURL: process.env.INSTALLER_URL, locale: 'es-AR' },
});
