import { expect, test } from '@playwright/test';
import { backOnline, enter, expectLeft, pendingOperations, prepared, reopen, seed } from './helpers.ts';

test('opens without signal, keeps what was marked and sends it when signal returns', async ({ context, request }) => {
  const demo = await seed(request);
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await context.setOffline(true);
  await reopen(page);
  await expectLeft(page, 350, 350);

  for (let i = 0; i < 3; i += 1) await page.getByTestId('person').first().click();
  await expectLeft(page, 347, 350);
  await expect(page.getByTestId('sync-status')).toContainText('3 sin enviar');

  await reopen(page);
  await expectLeft(page, 347, 350);
  expect(await pendingOperations(page)).toBe(3);

  await context.setOffline(false);
  await backOnline(page);
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  expect(await pendingOperations(page)).toBe(0);
});

test('undoing a mark while another fiscal marks the same person keeps the person as voted', async ({ browser, request }) => {
  const demo = await seed(request);
  const options = { ...test.info().project.use, baseURL: test.info().project.use.baseURL };
  const first = await browser.newContext(options);
  const second = await browser.newContext(options);
  const pageOne = await prepared(first, demo.tables[0]!.invitations[0]!);
  const pageTwo = await prepared(second, demo.tables[0]!.invitations[1]!);

  await first.setOffline(true);
  await second.setOffline(true);
  await pageOne.getByTestId('person').first().click();
  await pageTwo.getByTestId('person').first().click();
  await pageOne.getByRole('button', { name: 'Deshacer' }).click();
  await expectLeft(pageOne, 350, 350);
  await expectLeft(pageTwo, 349, 350);

  await first.setOffline(false);
  await second.setOffline(false);
  await backOnline(pageOne);
  await expect(pageOne.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  await backOnline(pageTwo);
  await expect(pageTwo.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  await backOnline(pageOne);

  // The mark of the second fiscal survives on both phones.
  await expect(pageOne.getByTestId('remaining').locator('.faltan')).toHaveText('349', { timeout: 20_000 });
  await expectLeft(pageTwo, 349, 350);
  await first.close();
  await second.close();
});

test('the urgent alert offers a call, WhatsApp and SMS when it cannot go out', async ({ context, request }) => {
  const demo = await seed(request);
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await page.getByRole('button', { name: 'Algo anda mal' }).click();
  await context.setOffline(true);
  await page.getByTestId('report').click();
  await expect(page.getByRole('alert')).toContainText('Todavía no salió');
  await expect(page.getByRole('link', { name: 'Llamar' })).toHaveAttribute('href', 'tel:+54 9 341 000-0000');
  await expect(page.getByRole('link', { name: 'Mandar WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/5493410000000\?text=/);
  await expect(page.getByRole('link', { name: 'Mandar SMS' })).toHaveAttribute('href', /^sms:\+54 9 341 000-0000\?&body=/);
  expect(await pendingOperations(page)).toBe(1);
  await context.setOffline(false);
  await backOnline(page);
  await page.getByRole('button', { name: 'Volver' }).click();
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
});

test('a mark that could not be saved goes back to the list, and says so', async ({ context, request }) => {
  const demo = await seed(request);
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await page.evaluate(() => {
    (window as unknown as { realPut: unknown }).realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('no room', 'QuotaExceededError');
    };
  });
  await page.getByTestId('person').first().click();
  await expect(page.getByTestId('save-failed')).toBeVisible();
  await expectLeft(page, 350, 350);
  await expect(page.getByText('Tachaste a')).toHaveCount(0);
  expect(await pendingOperations(page)).toBe(0);

  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (window as unknown as { realPut: typeof IDBObjectStore.prototype.put }).realPut;
  });
  await page.getByTestId('person').first().click();
  await expectLeft(page, 349, 350);
  await expect(page.getByTestId('save-failed')).toHaveCount(0);
});

test('with no room left crossing out is blocked, and it works again once there is room', async ({ context, request }) => {
  await context.addInitScript(() => {
    const real = Cache.prototype.put;
    Cache.prototype.put = function (this: Cache, ...args: Parameters<Cache['put']>) {
      if (localStorage.getItem('test-disk-full')) return Promise.reject(new DOMException('no room', 'QuotaExceededError'));
      return real.apply(this, args);
    };
  });
  const demo = await seed(request);
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await page.evaluate(() => localStorage.setItem('test-disk-full', '1'));
  await reopen(page);
  await expect(page.getByTestId('no-room')).toBeVisible();
  await expect(page.getByTestId('person').first()).toBeDisabled();
  expect(await pendingOperations(page)).toBe(0);

  await page.evaluate(() => localStorage.removeItem('test-disk-full'));
  // Without touching anything: the check repeats by itself while there is no room.
  await expect(page.getByTestId('no-room')).toHaveCount(0, { timeout: 30_000 });
  await page.getByTestId('person').first().click();
  await expectLeft(page, 349, 350);
});

test('the first install does not reload the page or announce an update', async ({ context, request }) => {
  await context.addInitScript(() => {
    sessionStorage.setItem('loads', String(Number(sessionStorage.getItem('loads') ?? 0) + 1));
  });
  const demo = await seed(request);
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => sessionStorage.getItem('loads'))).toBe('1');
  await expect(page.getByRole('button', { name: 'Actualizar' })).toHaveCount(0);
});

test('a room check that never answers does not hold the app back', async ({ context, request }) => {
  await context.addInitScript(() => {
    Cache.prototype.put = () => new Promise(() => undefined);
  });
  const demo = await seed(request);
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await expect(page.getByTestId('no-room')).toHaveCount(0);
  await page.getByTestId('person').first().click();
  await expectLeft(page, 349, 350);
});

test('a phone that lost its data says so, and does not claim everything was sent', async ({ context, request }) => {
  const demo = await seed(request);
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
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
  await expect(page.getByTestId('sync-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preparar la mesa' })).toBeVisible();
});

test('if saved data cannot be opened it says what to do, instead of hanging', async ({ context, request }) => {
  await context.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('broken', 'UnknownError');
    };
  });
  const demo = await seed(request);
  const page = await context.newPage();
  await page.goto(`/#invitacion=${demo.tables[0]!.invitations[0]}`);
  await expect(page.getByTestId('storage-broken')).toBeVisible();
  await expect(page.getByTestId('sync-status')).toHaveCount(0);
});

test('Spanish is the default language and the choice is remembered', async ({ context, request }) => {
  const demo = await seed(request);
  const page = await context.newPage();
  await enter(page, demo.tables[0]!.invitations[0]!);
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByRole('button', { name: 'Español' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading')).toHaveText('Settings');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Prepare the table' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Español' }).click();
  await expect(page.getByRole('heading')).toHaveText('Ajustes');
});

test('finds a person with no accents in the search, and can undo right after marking', async ({ context, request }) => {
  const demo = await seed(request);
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await page.getByRole('searchbox').fill('nunez');
  const found = page.getByTestId('person').first();
  await expect(found.locator('.nombre')).toContainText('Núñez');
  await found.click();
  await expectLeft(page, 349, 350);
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expectLeft(page, 350, 350);
});
