import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/** Every test gets its own table, because the server remembers what earlier tests marked. */
const newTable = () => `e2e-${crypto.randomUUID().slice(0, 12)}`;

async function prepared(context: BrowserContext, table = newTable()): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/?mesa=${table}`);
  await page.getByRole('button', { name: 'Preparar mesa' }).click();
  // Waits for either outcome, so that being slow and being wrongly refused look different.
  await expect(page.getByTestId('remaining').or(page.getByText('No se pudo preparar'))).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('No se pudo preparar')).toHaveCount(0);
  await expect(page.getByTestId('no-room')).toHaveCount(0);
  await expect(page.getByTestId('remaining')).toContainText('Faltan 350 de 350');
  // The service worker has to control the page before the connection goes away.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  return page;
}

async function pendingOperations(page: Page): Promise<number> {
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

test('opens without signal, keeps what was marked and sends it when signal returns', async ({ context }) => {
  const page = await prepared(context);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('remaining')).toContainText('Faltan 350 de 350');

  for (let i = 0; i < 3; i += 1) await page.getByTestId('person').first().click();
  await expect(page.getByTestId('remaining')).toContainText('Faltan 347 de 350');
  await expect(page.getByTestId('sync-status')).toContainText('3 sin enviar');

  await page.reload();
  await expect(page.getByTestId('remaining')).toContainText('Faltan 347 de 350');
  expect(await pendingOperations(page)).toBe(3);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  expect(await pendingOperations(page)).toBe(0);
});

test('undoing a mark while another fiscal marks the same person keeps the person as voted', async ({ browser }) => {
  const table = newTable();
  const options = { ...test.info().project.use, baseURL: test.info().project.use.baseURL };
  const first = await browser.newContext(options);
  const second = await browser.newContext(options);
  const pageOne = await prepared(first, table);
  const pageTwo = await prepared(second, table);

  await first.setOffline(true);
  await second.setOffline(true);
  await pageOne.getByTestId('person').first().click();
  await pageTwo.getByTestId('person').first().click();
  await pageOne.getByRole('button', { name: 'Deshacer' }).click();
  await expect(pageOne.getByTestId('remaining')).toContainText('Faltan 350 de 350');
  await expect(pageTwo.getByTestId('remaining')).toContainText('Faltan 349 de 350');

  await first.setOffline(false);
  await second.setOffline(false);
  await pageOne.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(pageOne.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  await pageTwo.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(pageTwo.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  await pageOne.evaluate(() => window.dispatchEvent(new Event('online')));

  // The mark of the second fiscal survives on both phones.
  await expect(pageOne.getByTestId('remaining')).toContainText('Faltan 349 de 350', { timeout: 20_000 });
  await expect(pageTwo.getByTestId('remaining')).toContainText('Faltan 349 de 350');
  await first.close();
  await second.close();
});

test('the urgent alert offers a call, WhatsApp and SMS when it cannot go out', async ({ context }) => {
  const page = await prepared(context);
  await page.getByRole('button', { name: 'Aviso urgente' }).click();
  await page.getByLabel('Teléfono del jefe de distrito').fill('+54 9 341 000-0000');
  await page.getByLabel('Teléfono del jefe de distrito').blur();
  await context.setOffline(true);
  await page.getByTestId('report').click();
  await expect(page.getByRole('alert')).toContainText('Todavía no salió');
  await expect(page.getByRole('link', { name: 'Llamar' })).toHaveAttribute('href', 'tel:+54 9 341 000-0000');
  await expect(page.getByRole('link', { name: 'Mandar WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/5493410000000\?text=/);
  await expect(page.getByRole('link', { name: 'Mandar SMS' })).toHaveAttribute('href', /^sms:\+54 9 341 000-0000\?&body=/);
  expect(await pendingOperations(page)).toBe(1);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
});

test('a mark that could not be saved goes back to the list, and says so', async ({ context }) => {
  const page = await prepared(context);
  await page.evaluate(() => {
    (window as unknown as { realPut: unknown }).realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('no room', 'QuotaExceededError');
    };
  });
  await page.getByTestId('person').first().click();
  await expect(page.getByTestId('save-failed')).toBeVisible();
  await expect(page.getByTestId('remaining')).toContainText('Faltan 350 de 350');
  await expect(page.getByText('Tachaste a')).toHaveCount(0);
  expect(await pendingOperations(page)).toBe(0);

  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (window as unknown as { realPut: typeof IDBObjectStore.prototype.put }).realPut;
  });
  await page.getByTestId('person').first().click();
  await expect(page.getByTestId('remaining')).toContainText('Faltan 349 de 350');
  await expect(page.getByTestId('save-failed')).toHaveCount(0);
});

test('with no room left crossing out is blocked, and it works again once there is room', async ({ context }) => {
  await context.addInitScript(() => {
    const real = Cache.prototype.put;
    Cache.prototype.put = function (this: Cache, ...args: Parameters<Cache['put']>) {
      if (localStorage.getItem('test-disk-full')) return Promise.reject(new DOMException('no room', 'QuotaExceededError'));
      return real.apply(this, args);
    };
  });
  const page = await prepared(context);
  await page.evaluate(() => localStorage.setItem('test-disk-full', '1'));
  await page.reload();
  await expect(page.getByTestId('no-room')).toBeVisible();
  await expect(page.getByTestId('person').first()).toBeDisabled();
  expect(await pendingOperations(page)).toBe(0);

  await page.evaluate(() => localStorage.removeItem('test-disk-full'));
  // Without touching anything: the check repeats by itself while there is no room.
  await expect(page.getByTestId('no-room')).toHaveCount(0, { timeout: 30_000 });
  await page.getByTestId('person').first().click();
  await expect(page.getByTestId('remaining')).toContainText('Faltan 349 de 350');
});

test('the first install does not reload the page or announce an update', async ({ context }) => {
  await context.addInitScript(() => {
    sessionStorage.setItem('loads', String(Number(sessionStorage.getItem('loads') ?? 0) + 1));
  });
  const page = await prepared(context);
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => sessionStorage.getItem('loads'))).toBe('1');
  await expect(page.getByRole('button', { name: 'Actualizar' })).toHaveCount(0);
});

test('a room check that never answers does not hold the app back', async ({ context }) => {
  await context.addInitScript(() => {
    Cache.prototype.put = () => new Promise(() => undefined);
  });
  const page = await prepared(context);
  await expect(page.getByTestId('no-room')).toHaveCount(0);
  await page.getByTestId('person').first().click();
  await expect(page.getByTestId('remaining')).toContainText('Faltan 349 de 350');
});

test('a phone that lost its data says so, and does not claim everything was sent', async ({ context }) => {
  const page = await prepared(context);
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.deleteDatabase('urna-abierta');
        request.onsuccess = request.onerror = request.onblocked = resolve;
      }),
  );
  await page.reload();
  await expect(page.getByTestId('data-lost')).toBeVisible();
  await expect(page.getByTestId('sync-status')).not.toContainText('Todo enviado');
  await expect(page.getByRole('button', { name: 'Preparar mesa' })).toBeVisible();
});

test('if saved data cannot be opened it says what to do, instead of hanging', async ({ context }) => {
  await context.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('broken', 'UnknownError');
    };
  });
  const page = await context.newPage();
  await page.goto(`/?mesa=${newTable()}`);
  await expect(page.getByTestId('storage-broken')).toBeVisible();
  await expect(page.getByTestId('sync-status')).not.toContainText('Todo enviado');
});

test('Spanish is the default language and the choice is remembered', async ({ context }) => {
  const page = await prepared(context);
  await expect(page.getByRole('button', { name: 'Mesa', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Idioma' }).selectOption('en');
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('remaining')).toContainText('350 of 350 left');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('es');
  await expect(page.getByTestId('remaining')).toContainText('Faltan 350 de 350');
});

test('finds a person with no accents in the search, and can undo right after marking', async ({ context }) => {
  const page = await prepared(context);
  await page.getByRole('searchbox').fill('nunez');
  const found = page.getByTestId('person').first();
  await expect(found.locator('.name')).toContainText('Núñez');
  await found.click();
  await expect(page.getByTestId('remaining')).toContainText('Faltan 349 de 350');
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByTestId('remaining')).toContainText('Faltan 350 de 350');
});
