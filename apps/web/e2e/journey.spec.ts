import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { backOnline, enter, expectLeft, onIphone, openRoll, PHOTO, prepare, prepared, seed, totp, typeNumber } from './helpers.ts';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const useThis = (page: Page) => page.getByRole('button', { name: 'Usar este' }).click();
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test('the first run: code, party, team, security, and a second step when the profile asks for it', async ({ page }) => {
  test.skip(onIphone(), 'A server has only one first run.');
  await page.goto('/#setup=codigo-de-prueba');
  await expect(page).toHaveURL(/\/$/);
  await page.getByTestId('setup-name').fill('Laura Paz');
  await expect(button(page, 'Empezar')).toBeDisabled();
  await page.getByTestId('setup-accept').check();
  await button(page, 'Empezar').click();
  await useThis(page);

  await expect(page.getByRole('heading')).toHaveText('Hola, Laura');
  await expect(page.locator('.estacion.ahora')).toContainText('Tu partido');
  await button(page, 'Seguir').click();
  await page.getByTestId('party-name').fill('Agrupación Ejemplo');
  await button(page, 'Seguir').click();

  await expect(page.locator('.estacion.ahora')).toContainText('Tu equipo');
  await button(page, 'Seguir').click();
  await button(page, 'Seguir').click();

  await expect(page.locator('.estacion.ahora')).toContainText('Seguridad');
  await button(page, 'Seguir').click();
  await page.getByRole('radio', { name: /Municipal o provincial/ }).click();
  await button(page, 'Seguir').click();

  // That profile asks chiefs and administrators for a second step, on each device.
  const secret = await page.getByTestId('totp-secret').innerText();
  await button(page, 'Seguir').click();
  await typeNumber(page, Number(`1${totp(secret)}`));
  await page.locator('.tecla').filter({ hasText: '←' }).click();
  for (let i = 0; i < 6; i += 1) await page.locator('.tecla').filter({ hasText: '←' }).click();
  for (const digit of totp(secret)) await page.locator('.tecla', { hasText: new RegExp(`^${digit}$`) }).click();
  await button(page, 'Confirmar').click();
  await expect(page.locator('.estacion.ahora')).toContainText('Tu primera elección');
  await expect(button(page, 'Crear una elección')).toBeVisible();

  // Back to the profile the other tests assume.
  await page.evaluate(async () => {
    await fetch('/api/security', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('urna-abierta-token')}` },
      body: JSON.stringify({ profile: 'estudiantil' }),
    });
  });
});

test('a whole election: from the empty party to erasing the names', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const demo = await seed(request, { size: 5 });
  await page.goto(`/#invitacion=${demo.links.coordinacion}`);
  await useThis(page);

  // The election, one question per screen.
  await button(page, 'Crear una elección').click();
  await page.getByTestId('election-name').fill('Centro de estudiantes');
  await button(page, 'Seguir').click();
  const today = await page.evaluate(() => new Date().getDate());
  await page.getByTestId('day').nth(today - 1).click();
  await expect(page.getByText('Es un día.')).toBeVisible();
  await button(page, 'Seguir').click();
  await page.getByTestId('category-name').fill('Centro');
  await page.getByTestId('category-lists').fill('Lista Azul\nLista Verde');
  await button(page, 'Crear la elección').click();

  // The roll: it shows what it understood before loading anything.
  await expect(page.locator('.estacion.ahora')).toContainText('Padrón');
  await button(page, 'Subir el padrón').click();
  const rows = Array.from({ length: 25 }, (_, i) => `Prueba${String(i).padStart(2, '0')} Ana,${90000000 + i}`);
  await page.getByTestId('roll-file').setInputFiles({ name: 'padron.csv', mimeType: 'text/csv', buffer: Buffer.from(`nombre,dni\n${rows.join('\n')}\n`) });
  await expect(page.getByTestId('roll-summary')).toContainText('25 personas');
  await button(page, 'Cargarlo').click();

  // The tables: the app proposes.
  await expect(page.locator('.estacion.ahora')).toContainText('Mesas');
  await page.locator('.pie').getByRole('button', { name: 'Ver las mesas' }).click();
  await page.getByTestId('table-size').fill('10');
  await expect(page.getByRole('heading')).toHaveText('Te proponemos 3 mesas');
  await button(page, 'Está bien').click();
  await expect(page.getByTestId('table')).toHaveCount(3);
  await page.getByTestId('table').first().click();
  await page.getByTestId('table-place').fill('Escuela Normal 1');
  await button(page, 'Guardar').click();
  await button(page, 'Listo').click();

  // The poll watchers, one link each.
  await expect(page.locator('.estacion.ahora')).toContainText('Fiscales');
  await page.locator('.pie').getByRole('button', { name: 'Ver los fiscales' }).click();
  await expect(page.getByRole('heading')).toHaveText('Faltan 3 mesas sin fiscal');
  let link = '';
  for (const name of ['Marta Ibáñez', 'Sol Ruiz', 'Eva Paz']) {
    await page.getByTestId('table-missing').first().click();
    await page.getByTestId('person-name').fill(name);
    await page.getByTestId('person-phone').fill('+54 9 341 555-0000');
    await button(page, 'Invitar').click();
    const url = (await page.getByTestId('invite-link').textContent())!;
    if (name.startsWith('Marta')) link = url;
    await expect(page.getByRole('link', { name: 'Mandar por WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/5493415550000\?text=/);
    await button(page, 'Listo').click();
  }
  await expect(page.getByRole('heading')).toHaveText('Todas las mesas tienen fiscal');
  await button(page, 'Invitar a los fiscales').click();
  await expect(page.getByTestId('pending-invite')).toHaveCount(3);
  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: 'Volver' }).click();
  await button(page, 'Abrir la votación').click();
  await expect(page.locator('.estacion.ahora')).toContainText('Votación');

  // The poll watcher's day, on another phone. The last invitation is the one that is still good.
  const pending = await page.evaluate(async (election) => {
    const response = await fetch(`/api/elections/${election}/invitations`, { method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('urna-abierta-token')}` } });
    return (await response.json()).invitations as { name: string; table: string; invitation: string }[];
  }, await page.evaluate(async () => {
    const response = await fetch('/api/elections', { headers: { authorization: `Bearer ${localStorage.getItem('urna-abierta-token')}` } });
    return (await response.json()).elections.find((item: { name: string }) => item.name === 'Centro de estudiantes').id as string;
  }));
  expect(link).toContain('#invitacion=');
  const marta = pending.find((item) => item.name.startsWith('Marta'))!;

  const phone = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const fiscal = await prepared(phone, marta.invitation);
  await expectLeft(fiscal, 10, 10);
  for (let i = 0; i < 3; i += 1) await fiscal.getByTestId('person').first().click();
  await expectLeft(fiscal, 7, 10);
  await button(fiscal, 'Ver los 3 que votaron').click();
  await expect(fiscal.getByTestId('voted-person')).toHaveCount(3);
  await fiscal.getByRole('button', { name: 'Volver' }).click();
  await fiscal.getByRole('button', { name: 'Volver' }).click();

  // Closing: the envelopes against what was crossed out.
  await button(fiscal, 'Ya cerró la mesa: contar los sobres').click();
  await typeNumber(fiscal, 4);
  await expect(fiscal.getByTestId('envelopes-result')).toContainText('Tachaste 3 y contaste 4');
  await fiscal.locator('.tecla').filter({ hasText: '←' }).click();
  await typeNumber(fiscal, 3);
  await expect(fiscal.getByTestId('envelopes-result')).toContainText('Coincide con los 3');
  await button(fiscal, 'Guardar').click();

  // The count, one list at a time, and the photo.
  await button(fiscal, 'Empezar el escrutinio').click();
  await expect(fiscal.getByRole('heading')).toHaveText('¿Cuántos votos sacó Lista Azul?');
  await typeNumber(fiscal, 2);
  await button(fiscal, 'Seguir').click();
  await expect(fiscal.getByRole('heading')).toHaveText('¿Cuántos votos sacó Lista Verde?');
  await typeNumber(fiscal, 1);
  await button(fiscal, 'Seguir').click();
  for (let i = 0; i < 3; i += 1) await button(fiscal, 'Seguir').click();
  await expect(fiscal.getByTestId('tally-total')).toHaveText('3');
  await button(fiscal, 'Guardar').click();
  await expect(fiscal.getByRole('heading')).toHaveText('Sacale una foto al acta');
  await fiscal.getByTestId('photo-input').setInputFiles({ name: 'acta.png', mimeType: 'image/png', buffer: PHOTO });
  await button(fiscal, 'Terminé').click();
  await expect(fiscal.getByRole('heading')).toHaveText('Terminaste. Gracias');
  await expect(fiscal.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 30_000 });

  // Whoever coordinates sees it, and what needs someone comes first.
  await button(page, 'Ver cómo va').click();
  await expect(page.getByRole('heading')).toHaveText('2 mesas te necesitan');
  await expect(page.getByText('La otra anda bien.')).toBeVisible();
  await button(page, 'Ver esas mesas').click();
  await page.locator('.fila-mesa').first().click();
  await expect(page.getByTestId('voted')).toHaveText('3');
  await expect(page.getByTestId('envelope-count')).toContainText('coincide');
  await expect(page.getByTestId('tally-photo')).toBeVisible();
  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: 'Volver' }).click();

  // The end: only totals remain.
  await button(page, 'Pasar al escrutinio').click();
  await button(page, 'Cerrar la elección').click();
  await button(page, 'Números').click();
  await expect(page.getByTestId('share')).toHaveText('12 %');
  await page.getByRole('button', { name: 'Volver' }).click();
  await button(page, 'Borrar los datos personales').click();
  await expect(button(page, 'Borrar los datos personales')).toHaveCount(0);
  const left = await page.evaluate(async () => {
    const response = await fetch('/api/persons?q=prueba', { headers: { authorization: `Bearer ${localStorage.getItem('urna-abierta-token')}` } });
    return (await response.json()).people.length as number;
  });
  expect(left).toBe(0);

  // And the phone lets go of the roll as soon as it hears the election closed.
  await fiscal.reload();
  await expect(fiscal.getByRole('heading')).toHaveText('Todavía no tenés mesa');
  await expect.poll(() => fiscal.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('urna-abierta');
    open.onsuccess = () => {
      const count = open.result.transaction('electors').objectStore('electors').count();
      count.onsuccess = () => {
        resolve(count.result);
        open.result.close();
      };
    };
  }))).toBe(0);
  await phone.close();
});

test('the first time it opens, every theme can be tried on the whole screen, and the choice stays', async ({ page, request }) => {
  const demo = await seed(request, { size: 10 });
  await page.goto(`/#invitacion=${demo.tables[0]!.invitations[0]}`);
  await page.getByRole('button', { name: 'Empezar' }).click();
  await expect(page.locator('.nombre-tema')).toContainText('Aula');
  await expect(page.locator('.pantalla')).toHaveAttribute('data-tachado', 'lapicera');
  await page.getByRole('button', { name: 'Ver otro' }).click();
  await expect(page.locator('.nombre-tema')).toContainText('Vidrio');
  await expect(page.locator('.pantalla')).toHaveAttribute('data-material', 'vidrio');
  await page.getByRole('button', { name: 'Oscuro' }).click();
  await expect(page.getByRole('button', { name: 'Oscuro' })).toHaveAttribute('aria-pressed', 'true');
  await useThis(page);
  await expect(page.getByRole('button', { name: 'Preparar la mesa' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.pantalla')).toHaveAttribute('data-material', 'vidrio');
  await expect(page.getByRole('button', { name: 'Usar este' })).toHaveCount(0);
});

test('before the election there is practice, and nothing of it reaches the server', async ({ page, request }) => {
  const demo = await seed(request, { size: 10, startsInDays: 5 });
  await enter(page, demo.tables[0]!.invitations[0]!);
  await prepare(page);
  await expect(page.getByText('La elección empieza el')).toBeVisible();
  await page.getByRole('button', { name: 'Practicar' }).click();
  await expect(page.getByTestId('practice')).toBeVisible();
  await page.getByRole('button', { name: 'Preparar la mesa' }).click();
  await openRoll(page);
  await page.getByTestId('person').first().click();
  await expectLeft(page, 39, 40);
  await page.getByRole('button', { name: 'Terminar la práctica' }).click();
  await expect(page.getByRole('button', { name: 'Practicar' })).toBeVisible();
  await expect(page.getByTestId('practice')).toHaveCount(0);
  const stored = await page.evaluate(async (table) => {
    const response = await fetch(`/api/sync/pull?table=${table}&since=0`, { headers: { authorization: `Bearer ${localStorage.getItem('urna-abierta-token')}` } });
    return (await response.json()).operations.length as number;
  }, demo.tables[0]!.table);
  expect(stored).toBe(0);
});

test('with several days, each night ends the day and the next one continues', async ({ context, request }) => {
  const demo = await seed(request, { size: 10 });
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await page.getByTestId('person').first().click();
  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: 'Ya cerró la mesa: contar los sobres' }).click();
  await typeNumber(page, 1);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading')).toHaveText('Por hoy ya está');
  await expect(page.getByText('Seguís el')).toBeVisible();
});

test('the chief gets the alert, sees who is silent, and two different counts wait for a person', async ({ browser, page, request }, info) => {
  const demo = await seed(request, { size: 10, tables: 2 });
  const phone = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const fiscal = await prepared(phone, demo.tables[0]!.invitations[0]!);
  await fiscal.getByRole('button', { name: 'Algo anda mal' }).click();
  await fiscal.getByTestId('report').click();
  await expect(fiscal.getByText('Le llegó el aviso a Rubén.')).toBeVisible({ timeout: 20_000 });

  await enter(page, demo.links.jefe!);
  await expect(page.getByRole('heading')).toHaveText('2 mesas te necesitan');
  await expect(page.locator('.tarjeta.alerta')).toContainText('Mesa 12: aviso urgente');
  await expect(page.getByTestId('needs').nth(1)).toContainText('Mesa 13: sin datos');
  await page.locator('.tarjeta.alerta').click();
  await expect(page.getByRole('heading')).toHaveText('Marta avisó que algo anda mal');
  await expect(page.getByRole('link', { name: 'Llamar a Marta' })).toHaveAttribute('href', /^tel:/);
  await page.getByTestId('resolve').click();
  await expect(page.getByTestId('resolve')).toHaveCount(0);
  await page.getByRole('button', { name: 'Volver' }).click();
  await expect(page.locator('.tarjeta.alerta')).toHaveCount(0, { timeout: 15_000 });

  const send = (payload: object) => fiscal.evaluate(async ({ table, payload }) => {
    const token = localStorage.getItem('urna-abierta-token');
    const id = () => {
      const hex = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    };
    await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ table, operations: [{ id: id(), schema: 1, table, device: 'otro', device_seq: 1, device_time: new Date().toISOString(), type: 'tally.submitted', payload }] }),
    });
  }, { table: demo.tables[0]!.table, payload });
  await send({ category: 'cat-1', results: { l1: 10, l2: 5 } });
  await send({ category: 'cat-1', results: { l1: 11, l2: 5 } });
  // The panel refreshes by itself: nobody has to do anything to see it.
  await expect(page.getByTestId('needs').first()).toContainText('dos escrutinios distintos', { timeout: 30_000 });
  await page.getByTestId('needs').first().click();
  await page.getByTestId('choose-tally').nth(1).click();
  await expect(page.getByText('Es la que vale')).toBeVisible();
  await phone.close();
});

test('the traffic light starts empty, and the numbers never show a name', async ({ page, browser, request }, info) => {
  const demo = await seed(request, { size: 10 });
  await page.goto(`/#invitacion=${demo.links.coordinacion}`);
  await useThis(page);
  await button(page, 'Más cosas').click();
  await page.getByRole('button', { name: /^Semáforo/ }).click();
  await page.getByTestId('category-new').fill(`Puede ser ${test.info().project.name}`);
  await button(page, 'Agregar categoría').click();
  await expect(page.getByText(`Puede ser ${test.info().project.name}`)).toBeVisible();

  const other = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const light = await other.newPage();
  await enter(light, demo.links.semaforo!);
  await light.getByRole('searchbox').fill('99000001');
  await light.getByTestId('light-person').first().click();
  await light.getByRole('radio', { name: `Puede ser ${test.info().project.name}` }).click();
  await button(light, 'Guardar y seguir').click();
  await expect(light.getByRole('searchbox')).toHaveValue('');
  await light.getByRole('searchbox').fill('99000001');
  await expect(light.getByTestId('light-person').first()).toContainText('Puede ser');
  await other.close();

  const third = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const numbers = await third.newPage();
  await enter(numbers, demo.links.estadistico!);
  await expect(numbers.getByTestId('share')).toBeVisible();
  await expect(numbers.locator('body')).not.toContainText('Acuña');
  await third.close();
});

test('whoever coordinates sees what each task can do, and can change it', async ({ page, request }) => {
  const demo = await seed(request, { size: 5 });
  await page.goto(`/#invitacion=${demo.links.coordinacion}`);
  await useThis(page);
  await button(page, 'Más cosas').click();
  await page.getByRole('button', { name: /^Permisos/ }).click();
  await page.getByTestId('role').filter({ hasText: 'Ayudar a varios fiscales' }).click();
  const stats = page.getByTestId('permission').filter({ hasText: 'Ver los números' });
  await expect(stats).toHaveAttribute('aria-pressed', 'false');
  await stats.click();
  await button(page, 'Guardar').click();
  await expect(page.getByText('Ya vale para todos')).toBeVisible();
  await button(page, 'Volver a lo recomendado').click();
  await expect(stats).toHaveAttribute('aria-pressed', 'false');
});

test('a theme with its own fonts, in one file, stays on the phone with no signal', async ({ browser, page, request }, info) => {
  const demo = await seed(request, { size: 5 });
  await page.goto(`/#invitacion=${demo.links.coordinacion}`);
  await useThis(page);
  await expect(page.getByRole('heading')).toHaveText('Tus elecciones');
  const font = readFileSync(new URL('../src/lib/fuentes/nunito-latin-wght-normal.woff2', import.meta.url)).toString('base64');
  const added = await page.evaluate(async (data) => {
    const theme = { ...(window as any).TEMAS[4], id: `con-letras-${Date.now()}`, nombre: 'Tema con Letras', fuentes: { titulo: "'Letra Propia'", texto: "'Letra Propia'", boton: "'Letra Propia'", numero: "'Letra Propia'" }, archivosFuentes: [{ familia: 'Letra Propia', peso: '200 1000', datos: `data:font/woff2;base64,${data}` }] };
    const response = await fetch('/api/themes', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('urna-abierta-token')}` }, body: JSON.stringify({ theme }) });
    return { status: response.status, id: theme.id };
  }, font);
  expect(added.status).toBe(200);

  const device = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const phone = await device.newPage();
  await phone.goto(`/#invitacion=${demo.tables[0]!.invitations[0]}`);
  await phone.getByRole('button', { name: 'Empezar' }).click();
  while (!(await phone.locator('.nombre-tema').innerText()).includes('Tema con Letras')) await phone.getByRole('button', { name: 'Ver otro' }).click();
  await useThis(phone);
  await expect(phone.getByRole('button', { name: 'Preparar la mesa' })).toBeVisible();
  // The service worker has to be in charge, and the font saved, before the signal goes.
  await phone.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await expect.poll(() => phone.evaluate(async () => (await (await caches.open('temas-propios')).keys()).length)).toBeGreaterThan(0);

  await device.setOffline(true);
  await phone.reload();
  await expect(phone.getByRole('button', { name: 'Preparar la mesa' })).toBeVisible();
  const look = await phone.evaluate(async () => {
    const loaded = await document.fonts.load('16px "Letra Propia"');
    return { fonts: loaded.length, family: getComputedStyle(document.querySelector('.pantalla')!).getPropertyValue('--f-titulo') };
  });
  expect(look.fonts).toBeGreaterThan(0);
  expect(look.family).toContain('Letra Propia');
  await device.close();
});

test('someone asks for their data and to be erased', async ({ page, request }) => {
  const demo = await seed(request, { size: 10 });
  await page.goto(`/#invitacion=${demo.links.coordinacion}`);
  await useThis(page);
  await button(page, 'Más cosas').click();
  await page.getByRole('button', { name: /^Pedidos de personas/ }).click();
  await page.getByRole('searchbox').fill('99000001');
  await button(page, 'Buscar').click();
  await page.getByTestId('found-person').first().click();
  const download = page.waitForEvent('download');
  await page.getByTestId('person-export').click();
  expect((await download).suggestedFilename()).toMatch(/^datos-/);
  await page.getByTestId('person-fix-name').fill('Nombre Corregido');
  await page.getByTestId('person-fix').click();
  await expect(page.getByText('Datos corregidos.')).toBeVisible();
  await expect(page.getByRole('heading')).toHaveText('Nombre Corregido');
  await page.getByTestId('person-erase').click();
  await expect(page.getByText('Sus datos se borraron.')).toBeVisible();
  await page.getByRole('searchbox').fill('borrado a pedido');
  await button(page, 'Buscar').click();
  await expect(page.getByTestId('found-person')).toHaveCount(0);
  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: /^Registro/ }).click();
  await expect(page.getByTestId('audit-entry').filter({ hasText: 'Borró los datos de una persona' }).first()).toBeVisible();
});

test('an invitation works once, and a person removed from the team loses access', async ({ browser, page, request }, info) => {
  const demo = await seed(request, { size: 10 });
  const invitation = demo.tables[0]!.invitations[0]!;
  await enter(page, invitation);
  await expect(page.getByRole('button', { name: 'Preparar la mesa' })).toBeVisible();

  const other = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const stranger = await other.newPage();
  await stranger.goto(`/#invitacion=${invitation}`);
  await expect(stranger.getByTestId('invitation-used')).toBeVisible();
  await other.close();

  const boss = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const admin = await boss.newPage();
  await admin.goto(`/#invitacion=${demo.links.coordinacion}`);
  await useThis(admin);
  await expect(admin.getByRole('heading')).toHaveText('Tus elecciones');
  await admin.evaluate(async () => {
    const headers = { authorization: `Bearer ${localStorage.getItem('urna-abierta-token')}` };
    const { users } = await (await fetch('/api/users', { headers })).json();
    const marta = users.findLast((user: { name: string }) => user.name === 'Marta');
    await fetch(`/api/users/${marta.id}`, { method: 'DELETE', headers });
  });
  await boss.close();

  await page.reload();
  await expect(page.getByRole('heading')).toHaveText('Este teléfono ya no tiene acceso');
});

test('on an iPhone, a number carries the session into the installed app', async ({ browser, page, request }, info) => {
  test.skip(!onIphone(), 'Only an iPhone gives the installed app its own storage.');
  const demo = await seed(request, { size: 10 });
  await enter(page, demo.tables[0]!.invitations[0]!);
  await page.getByRole('button', { name: 'Preparar la mesa' }).click();
  const code = (await page.getByTestId('handoff-code').innerText()).replace(/\D/g, '');
  expect(code).toHaveLength(8);

  const installed = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const app = await installed.newPage();
  await app.goto('/');
  await app.getByTestId('code').fill(code);
  await app.getByRole('button', { name: 'Entrar' }).click();
  await expect(app.getByRole('button', { name: 'Empezar' })).toBeVisible();
  await installed.close();
});

test('the signal comes back by itself after a closed door', async ({ context, request }) => {
  const demo = await seed(request, { size: 10 });
  const page = await prepared(context, demo.tables[0]!.invitations[0]!);
  await context.setOffline(true);
  await page.getByTestId('person').first().click();
  await expect(page.getByTestId('sync-status')).toContainText('1 sin enviar');
  await context.setOffline(false);
  await backOnline(page);
  await expect(page.getByTestId('sync-status')).toContainText('Todo enviado', { timeout: 20_000 });
});
