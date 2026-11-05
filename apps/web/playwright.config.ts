import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:8090', serviceWorkers: 'allow' },
  projects: [
    { name: 'android', use: { ...devices['Pixel 5'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
});
