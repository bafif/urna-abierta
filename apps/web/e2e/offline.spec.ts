import { expect, test } from '@playwright/test';
import { backOnline, enter, expectLeft, onIphone, pendingOperations, PHOTO, prepared, reopen, seed, typeNumber } from './helpers.ts';

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

const UNROUTABLE = 'WebKit does not let a test stop the requests of a page that a service worker controls.';

test('the urgent alert goes out at once, even with a send of marks stuck in front of it', async ({ context, request }) => {
  test.skip(onIphone(), UNROUTABLE);
  const demo = await seed(request);
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  // The marks get stuck on the way: their answer never comes back.
  await context.route('**/api/sync/push', async (route) => {
    if (!route.request().postData()?.includes('voter.marked')) return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await route.abort().catch(() => undefined);
  });
  for (let i = 0; i < 5; i += 1) await page.getByTestId('person').first().click();
  await expect(page.getByTestId('sync-status')).toContainText('Enviando', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Algo anda mal' }).click();
  await page.getByTestId('report').click();
  await expect(page.getByText('Tu aviso ya está en el sistema. Si es urgente, llamá a Rubén.')).toBeVisible({ timeout: 5_000 });
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a roll changed after preparing the table reaches the phone, and its marks stay', async ({ context, request }) => {
  const demo = await seed(request, { size: 10 });
  const table = demo.tables[0]!.table;
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await page.getByTestId('person').first().click();
  await expectLeft(page, 9, 10);
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  const { token } = await (await request.post('/api/auth/redeem', { data: { token: demo.links.coordinacion } })).json();
  const corrected = await request.put(`/api/elections/${demo.election}/electors/${table}-e-000005`, { headers: { authorization: `Bearer ${token}` }, data: { full_name: 'Zamora, Renata' } });
  expect(corrected.ok()).toBe(true);
  await reopen(page);
  await expect(page.getByTestId('roll-updated')).toBeVisible({ timeout: 20_000 });
  await expectLeft(page, 9, 10);
  await page.getByRole('searchbox').fill('zamora');
  await expect(page.getByTestId('person').first().locator('.nombre')).toContainText('Zamora');
  await page.getByRole('button', { name: 'Entendido' }).click();
  await expect(page.getByTestId('roll-updated')).toHaveCount(0);
});

test('a phone prepared before the random ids changes to them once nothing is left to send, and keeps its marks', async ({ context, request }) => {
  const demo = await seed(request, { size: 10 });
  const table = demo.tables[0]!.table;
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  for (let i = 0; i < 2; i += 1) await page.getByTestId('person').first().click();
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  // As the version before left a phone: each person, and each mark, by the id of the roll.
  await page.evaluate(async (table) => {
    const ask = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = await ask(indexedDB.open('urna-abierta'));
    const tx = db.transaction(['electors', 'operations', 'meta'], 'readwrite');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    const electors = await ask(tx.objectStore('electors').getAll()) as { id: string; order: number }[];
    const old = new Map(electors.map((entry) => [entry.id, `${table}-e-${String(entry.order).padStart(6, '0')}`]));
    tx.objectStore('electors').clear();
    for (const entry of electors) tx.objectStore('electors').put({ ...entry, id: old.get(entry.id) });
    const rows = await ask(tx.objectStore('operations').getAll()) as { operation: { type: string; payload: { elector?: string } } }[];
    for (const row of rows) {
      if (row.operation.type.startsWith('voter.')) tx.objectStore('operations').put({ ...row, operation: { ...row.operation, payload: { ...row.operation.payload, elector: old.get(row.operation.payload.elector!) } } });
    }
    tx.objectStore('meta').delete('publicIds');
    tx.objectStore('meta').delete('rollRevision');
    await done;
    db.close();
  }, table);
  await reopen(page);
  await expectLeft(page, 8, 10);
  const changed = () => page.evaluate(async (table) => {
    const ask = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = await ask(indexedDB.open('urna-abierta'));
    const electors = await ask(db.transaction('electors').objectStore('electors').getAll()) as { id: string }[];
    const flag = await ask(db.transaction('meta').objectStore('meta').get('publicIds')) as { value: boolean } | undefined;
    db.close();
    return Boolean(flag?.value) && electors.length === 10 && electors.every((entry) => !entry.id.startsWith(table));
  }, table);
  await expect.poll(changed, { timeout: 20_000 }).toBe(true);
  await expectLeft(page, 8, 10);
  // Nothing changed for the person: there is no notice.
  await expect(page.getByTestId('roll-updated')).toHaveCount(0);
});

test('a photo the server refuses does not hold anything back, and the phone asks for it again', async ({ context, request }) => {
  test.skip(onIphone(), UNROUTABLE);
  const demo = await seed(request, { size: 10, startsInDays: 0 });
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: 'Ya cerró la mesa: contar los sobres' }).click();
  await typeNumber(page, 0);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Empezar el escrutinio' }).click();
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Seguir' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading')).toHaveText('Sacale una foto al acta');
  await context.route('**/api/tables/*/photos/*', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 413, contentType: 'application/json', body: '{"error":"too_large"}' }) : route.continue()));
  await page.getByTestId('photo-input').setInputFiles({ name: 'acta.png', mimeType: 'image/png', buffer: PHOTO });
  await page.getByRole('button', { name: 'Terminé' }).click();
  await expect(page.getByText('El servidor no aceptó la foto del acta. Sacala de nuevo.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado');
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await page.getByRole('button', { name: 'Sacar la foto del acta' }).click();
  await page.getByTestId('photo-input').setInputFiles({ name: 'acta.png', mimeType: 'image/png', buffer: PHOTO });
  await page.getByRole('button', { name: 'Terminé' }).click();
  await expect(page.getByRole('heading')).toHaveText('Terminaste. Gracias');
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 30_000 });
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

test('it never says everything was sent while something is still waiting on the phone', async ({ context, request }) => {
  const demo = await seed(request);
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
  // Every answer of the server takes a while, so that what gets saved falls in the middle of a send.
  await context.route('**/api/sync/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  for (let i = 0; i < 12; i += 1) {
    await page.getByTestId('person').first().click();
    await page.waitForTimeout(150);
  }
  await expectLeft(page, 338, 350);
  // No more marks from here on: what is pending can only go down, so the screen has no excuse.
  const wrong = await page.evaluate(async () => {
    const pending = () =>
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
      });
    let times = 0;
    for (let i = 0; i < 600; i += 1) {
      const left = await pending();
      if (left === 0) break;
      if (document.querySelector('[data-testid="sync-status"]')?.textContent?.includes('Todo enviado')) times += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return times;
  });
  expect(wrong).toBe(0);
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 30_000 });
  expect(await pendingOperations(page)).toBe(0);
});
