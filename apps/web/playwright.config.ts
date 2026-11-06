import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // Phones in Argentina, like the elections the seed makes: «today» is the same day for both, at any hour.
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:8090', serviceWorkers: 'allow', timezoneId: 'America/Argentina/Buenos_Aires' },
  projects: [
    { name: 'android', use: { ...devices['Pixel 5'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
});
