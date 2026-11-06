import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readPadron } from '../../../packages/domain/src/padron.ts';

// Made by hacer-padron.py: invented people, the first of them with a document of nine digits.
const ROLL = '/padrones/padron-de-prueba.pdf';
const NO_TABLE = '/padrones/sin-tabla.pdf';
const PEOPLE = 60;
const BAD_DOCUMENT = '990012345';
const FIXED_DOCUMENT = '99012345';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

/** The screen as it is, in light and in dark, for a person to look at. */
async function shot(page: Page, name: string) {
  for (const [scheme, mode] of [['light', 'claro'], ['dark', 'oscuro']] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `/salida/lector-${name}-${mode}.png` }).catch(() => undefined);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('it opens only with its own address', async ({ request, baseURL }) => {
  const url = new URL(baseURL!);
  expect((await request.get(`${url.origin}/`)).status()).toBe(404);
  expect((await request.get(`${url.origin}/otro/api/state`)).status()).toBe(404);
  expect((await request.get(`${baseURL}api/state`)).status()).toBe(200);
  // Without the final slash, the address still leads to the screens.
  const bare = await request.get(baseURL!.replace(/\/$/, ''), { maxRedirects: 0 });
  expect(bare.status()).toBe(308);
  expect(bare.headers()['location']).toBe(`${url.pathname}`);
});

test('a roll goes from a scanned PDF to a file for the app, with a person fixing what was not clear', async ({ page }) => {
  await page.goto('');
  await expect(heading(page)).toHaveText('¿Qué padrón leemos?');
  await expect(page.getByText('el archivo no sale de esta computadora')).toBeVisible();
  await shot(page, '1-elegir');
  await button(page, 'Read this in English').click();
  await expect(heading(page)).toHaveText('Which roll should we read?');
  await shot(page, '1-elegir-en');
  await button(page, 'Leer en castellano').click();
  await expect(heading(page)).toHaveText('¿Qué padrón leemos?');

  const file = page.getByTestId('pdf-file');
  await file.setInputFiles({ name: 'carta.txt', mimeType: 'text/plain', buffer: Buffer.from('Esto no es un padrón.') });
  await expect(page.getByRole('alert')).toContainText('Ese archivo no es un PDF');

  // A PDF without a ruled table: the reader says so in plain words and points to the app, which takes spreadsheets.
  await file.setInputFiles(NO_TABLE);
  await expect(heading(page)).toHaveText('No se pudo leer este PDF', { timeout: 60_000 });
  await expect(page.getByRole('alert')).toContainText('tabla con líneas');
  await expect(page.getByText('subila directo en la app, con «Subir el padrón»')).toBeVisible();
  await shot(page, '2-no-se-pudo');
  await button(page, 'Probar con otro PDF').click();
  await expect(heading(page)).toHaveText('¿Qué padrón leemos?');

  await page.getByTestId('pdf-file').setInputFiles(ROLL);
  await expect(heading(page)).toHaveText('Leyendo el padrón');
  await expect(page.getByTestId('rows-found')).not.toHaveText('0', { timeout: 120_000 });
  await expect(page.getByTestId('page')).toHaveText(/^Página \d de 5$/);
  // The progress changes every second, but a keyboard on «Cancelar» stays there.
  await button(page, 'Cancelar').focus();
  await page.waitForTimeout(2_500);
  await expect(button(page, 'Cancelar')).toBeFocused();
  await shot(page, '2-leyendo');

  await expect(heading(page)).toHaveText('Revisá lo que no quedó claro', { timeout: 180_000 });
  await expect(page.getByTestId('people')).toHaveText(String(PEOPLE));
  await expect(page.getByTestId('no-table')).toHaveText('La página 5 no tenía una tabla y no se leyó.');
  await shot(page, '3-resumen');

  await button(page, 'Empezar a revisar').click();
  const counter = page.getByTestId('counter');
  await expect(counter).toHaveText(/^1 de \d+$/);
  const total = Number((await counter.textContent())!.split(' de ')[1]);
  expect(total).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('row-image').locator('img').first()).toHaveJSProperty('complete', true);
  const document = page.locator('[data-field="document"]');
  await expect(document).toHaveValue(BAD_DOCUMENT);
  await expect(page.locator('.campo.mal')).toContainText('7 u 8 números');
  await expect(button(page, 'Guardar cambio')).toBeDisabled();
  await shot(page, '3-revisar');

  // What still breaks its format is said right there, and the row stays.
  await document.fill('123');
  await button(page, 'Guardar cambio').click();
  await expect(page.getByRole('alert')).toContainText('no tienen la forma esperada');
  await expect(counter).toHaveText(`1 de ${total}`);
  await shot(page, '3-revisar-error');
  await document.fill(FIXED_DOCUMENT);
  await button(page, 'Guardar cambio').click();

  await expect(counter).toHaveText(`2 de ${total}`);
  // Enter says the row is fine, and the rest can wait for the app.
  await page.keyboard.press('Enter');
  await expect(counter).toHaveText(`3 de ${total}`);
  await button(page, 'Las reviso después en la app').click();

  await expect(heading(page)).toHaveText('Guardá el padrón');
  const title = page.locator('[data-field="title"]');
  await expect(title).toHaveValue('padron de prueba');
  await title.fill('Padrón de prueba');
  await expect(page.getByText('Tocá «Subir el padrón» y elegí este archivo.')).toBeVisible();
  await expect(page.getByTestId('pending')).toContainText('para revisar en la app');
  await shot(page, '4-guardar');

  // If the file does not come, the screen says so instead of «Listo».
  await page.route('**/api/save?*', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"no_rows"}' }));
  await button(page, 'Guardar el archivo').click();
  await expect(page.getByRole('alert')).toContainText('No se pudo armar el archivo');
  await expect(page.getByTestId('saved')).toHaveCount(0);
  await page.unroute('**/api/save?*');

  const downloading = page.waitForEvent('download');
  await button(page, 'Guardar el archivo').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Padron-de-prueba.padron');
  const { padron, problems } = readPadron(new Uint8Array(readFileSync((await download.path())!)));
  expect(problems).toEqual([]);
  expect(padron!.manifest.title).toBe('Padrón de prueba');
  expect(padron!.manifest.extraction?.external_ai).toBe(false);
  expect(padron!.electors).toHaveLength(PEOPLE);
  const fixed = padron!.electors.find((elector) => elector.identifiers?.some((id) => id.value === FIXED_DOCUMENT));
  expect(fixed?.review?.status).toBe('ok');
  expect(padron!.electors.some((elector) => elector.identifiers?.some((id) => id.value === BAD_DOCUMENT))).toBe(false);
  await expect(page.getByTestId('saved')).toBeVisible();
  await shot(page, '4-guardado');

  await button(page, 'Cerrar el lector').click();
  await expect(heading(page)).toHaveText('Listo, ya podés cerrar esta ventana');
  await shot(page, '5-cerrado');
});
