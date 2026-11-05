import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

export interface Seed {
  election: string;
  links: Record<string, string>;
  tables: { table: string; invitations: string[] }[];
}

/** Every test gets its own election, because the server remembers what earlier tests marked. */
export async function seed(request: APIRequestContext, options: { size?: number; tables?: number; startsInDays?: number } = {}): Promise<Seed> {
  const response = await request.post('/api/test/seed', { data: { size: 350, tables: 1, ...options } });
  expect(response.ok()).toBe(true);
  return response.json();
}

export const onIphone = () => test.info().project.name === 'iphone';

/** Comes in through the link, like someone opening it for the first time. */
export async function enter(page: Page, invitation: string): Promise<void> {
  await page.goto(`/#invitacion=${invitation}`);
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Usar este' }).click();
}

export async function prepare(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Preparar la mesa' }).click();
  if (onIphone()) {
    await page.getByRole('button', { name: 'Seguir en Safari igual' }).click();
    await page.getByRole('button', { name: 'Preparar la mesa' }).click();
  }
  // Waits for either outcome, so that being slow and being wrongly refused look different.
  await expect(page.getByRole('button', { name: 'Abrir el padrón' }).or(page.getByText('No se pudo preparar'))).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('No se pudo preparar')).toHaveCount(0);
  await expect(page.getByTestId('no-room')).toHaveCount(0);
}

export async function openRoll(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Abrir el padrón' }).click();
  await expect(page.getByTestId('remaining')).toBeVisible();
}

/** A phone with its table ready and the roll on screen, which also works with no signal from here on. */
export async function prepared(context: BrowserContext, invitation: string): Promise<Page> {
  const page = await context.newPage();
  await enter(page, invitation);
  await prepare(page);
  await openRoll(page);
  // The service worker has to control the page before the connection goes away.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  return page;
}

export async function expectLeft(page: Page, left: number, total: number): Promise<void> {
  await expect(page.getByTestId('remaining').locator('.faltan')).toHaveText(String(left));
  await expect(page.getByTestId('remaining').locator('.de')).toHaveText(`faltan, de ${total}`);
}

export async function reopen(page: Page): Promise<void> {
  await page.reload();
  await openRoll(page);
}

export async function pendingOperations(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('urna-abierta');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('operations').objectStore('operations').getAll();
          all.onsuccess = () => {
            resolve((all.result as { queue: number }[]).filter((row) => row.queue === 1).length);
            open.result.close();
          };
        };
      }),
  );
}

export const backOnline = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('online')));

export async function typeNumber(page: Page, value: number): Promise<void> {
  for (const digit of String(value)) await page.locator('.tecla', { hasText: new RegExp(`^${digit}$`) }).click();
}

/** The six digits an authenticator app would show now. */
export function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((chunk) => parseInt(chunk, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  return String(digest.readUInt32BE(digest[19]! & 0xf) & 0x7fffffff).padStart(6, '0').slice(-6);
}

/** A small valid image, so that a test can send a photo. */
export const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
