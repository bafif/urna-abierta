import { expect, test, type Page } from '@playwright/test';

const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });

async function toWhere(page: Page) {
  await page.goto('');
  await button(page, 'Empezar').click();
  await expect(page.getByRole('heading')).toHaveText('¿Dónde va a vivir tu Urna Abierta?');
}

// Before any other test chooses a language: the installer keeps the choice for the next time, and every test here
// shares its folder.
test.describe('on a computer in English', () => {
  test.use({ locale: 'en-US' });

  test('it opens in English, offers Spanish on every screen, and remembers the choice', async ({ page }) => {
    await page.goto('');
    await expect(page.getByRole('heading')).toHaveText('Let’s install Urna Abierta');
    await expect(page).toHaveTitle('Install Urna Abierta');
    await button(page, 'Start').click();
    await expect(page.getByRole('heading')).toHaveText('Where will your Urna Abierta live?');
    await button(page, 'Leer en castellano').click();
    await expect(page.getByRole('heading')).toHaveText('¿Dónde va a vivir tu Urna Abierta?');
    await page.reload();
    await expect(page.getByRole('heading')).toHaveText('Vamos a instalar Urna Abierta');
  });
});

test('it says what is going to happen, in both languages', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading')).toHaveText('Vamos a instalar Urna Abierta');
  await expect(page).toHaveTitle('Instalar Urna Abierta');
  await button(page, 'Read this in English').click();
  await expect(page.getByRole('heading')).toHaveText('Let’s install Urna Abierta');
  await button(page, 'Leer en castellano').click();
  await expect(page.getByRole('heading')).toHaveText('Vamos a instalar Urna Abierta');
});

test('it opens only with its own address', async ({ request, baseURL }) => {
  const url = new URL(baseURL!);
  expect((await request.get(`${url.origin}/`)).status()).toBe(403);
  expect((await request.get(`${url.origin}/otro/api/job`)).status()).toBe(403);
  expect((await request.get(`${baseURL}urna`)).status()).toBe(404);
});

test('a cloud without its data does not move on, and each one asks for its own', async ({ page }) => {
  await toWhere(page);
  await button(page, 'Seguir').click();
  await expect(page.getByRole('heading')).toHaveText('¿En qué nube?');
  await expect(page.getByText('OCID del tenancy')).toBeVisible();
  await button(page, 'Seguir').click();
  await expect(page.getByRole('alert')).toContainText('Faltan datos');
  await page.getByRole('radio', { name: /AWS/ }).click();
  await expect(page.getByText('Clave secreta')).toBeVisible();
  await page.getByRole('radio', { name: /Google Cloud/ }).click();
  await page.locator('textarea').fill('esto no es un json');
  await button(page, 'Seguir').click();
  await expect(page.getByRole('alert')).toContainText('Faltan datos');
  await page.locator('textarea').fill('{"client_email":"a@b","private_key":"k","project_id":"p"}');
  await button(page, 'Seguir').click();
  await expect(page.getByRole('heading')).toHaveText('¿Cómo leemos los padrones escaneados?');
});

test('a server it cannot reach is said right there, not at the end', async ({ page }) => {
  await toWhere(page);
  await page.getByRole('radio', { name: /Ya tengo un servidor/ }).click();
  await button(page, 'Seguir').click();
  await page.locator('[data-field="address"]').fill('esto no es una dirección');
  await button(page, 'Seguir').click();
  await expect(page.getByRole('alert')).toContainText('no parece válida');
  await page.locator('[data-field="address"]').fill('127.0.0.1');
  await page.locator('[data-field="privateKey"]').fill('tampoco es una llave');
  await button(page, 'Seguir').click();
  await expect(page.getByRole('alert')).toContainText('No pudimos entrar');
});

test('every theme can be seen in light and dark before choosing', async ({ page }) => {
  await toWhere(page);
  await page.getByRole('radio', { name: /pegar un texto/ }).click();
  await button(page, 'Seguir').click();
  await button(page, 'Seguir').click();
  await expect(page.getByRole('radio', { name: /Con mi propia IA/ })).toBeDisabled();
  // It says what each option really means: the reader is a separate download, and a spreadsheet needs nothing else.
  await expect(page.getByRole('radio', { name: /En esta computadora/ })).toContainText('se baja aparte');
  await expect(page.getByRole('radio', { name: /Después/ })).toContainText('se carga directo en la app');
  await button(page, 'Seguir').click();
  await expect(page.getByTestId('previews').locator('.pantalla')).toHaveCount(2);
  const names = ['Aula', 'Vidrio', 'Feria', 'Tablero', 'Mate'];
  await expect(page.locator('.vista-doble .opcion')).toHaveText(names);
  await expect(page.getByTestId('previews').locator('.pantalla').first()).toHaveAttribute('data-tachado', 'lapicera');
  await page.getByRole('radio', { name: 'Feria' }).click();
  await expect(page.getByTestId('previews').locator('.pantalla').first()).toHaveAttribute('data-tachado', 'sello');
  await page.screenshot({ path: '/salida/instalador-temas.png' }).catch(() => undefined);
});

test('your own theme comes from a file: it is checked, and one that cannot be read does not get in', async ({ page }) => {
  await toWhere(page);
  await page.getByRole('radio', { name: /pegar un texto/ }).click();
  await button(page, 'Seguir').click();
  await button(page, 'Seguir').click();
  await button(page, 'Seguir').click();
  const file = page.getByTestId('theme-file');
  const send = (content: string) => file.setInputFiles({ name: 'tema.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  await send('esto no es un tema');
  await expect(page.getByTestId('theme-problem')).toContainText('no es un tema');
  const good = await page.evaluate(() => (window as any).TEMAS[4]);
  await send(JSON.stringify(good));
  await expect(page.getByTestId('theme-problem')).toContainText('Ya hay un tema con ese id');
  await send(JSON.stringify({ ...good, id: 'propio', nombre: 'Ilegible', claro: { ...good.claro, texto: '#999999' } }));
  await expect(page.getByTestId('theme-problem')).toContainText('texto sobre fondo');
  await expect(page.locator('.vista-doble .opcion')).toHaveCount(5);
  await send(JSON.stringify({ ...good, id: 'propio', nombre: 'Tema de Prueba' }));
  await expect(page.getByTestId('theme-problem')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Tema de Prueba' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('previews').locator('.pantalla').first()).toHaveAttribute('data-material', 'almohada');
  // Back and forward, it stays there, and only once.
  await page.getByRole('radio', { name: 'Aula' }).click();
  await send(JSON.stringify({ ...good, id: 'otro', nombre: 'Otro Tema' }));
  await expect(page.locator('.vista-doble .opcion')).toHaveCount(6);
});

test('the fonts come inside the same file, and the preview already uses them', async ({ page }) => {
  await toWhere(page);
  await page.getByRole('radio', { name: /pegar un texto/ }).click();
  await button(page, 'Seguir').click();
  await button(page, 'Seguir').click();
  await button(page, 'Seguir').click();
  const send = (content: string) => page.getByTestId('theme-file').setInputFiles({ name: 'tema.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  const data = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch('fuentes/nunito-latin-wght-normal.woff2')).arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  });
  const base = await page.evaluate(() => (window as any).TEMAS[4]);
  const own = { ...base, id: 'con-letras', nombre: 'Con Letras', fuentes: { titulo: "'Letra Propia'", texto: "'Letra Propia'", boton: "'Letra Propia'", numero: "'Letra Propia'" } };

  // Without the font inside, it says which one is missing.
  await send(JSON.stringify(own));
  await expect(page.getByTestId('theme-problem')).toContainText('la letra Letra Propia no viene con la app ni adentro del archivo');
  // It looks like a font but cannot be opened.
  await send(JSON.stringify({ ...own, archivosFuentes: [{ familia: 'Letra Propia', datos: `data:font/woff2;base64,${btoa('wOF2 esto no es una letra')}` }] }));
  await expect(page.getByTestId('theme-problem')).toContainText('no se puede abrir: Letra Propia');
  await expect(page.getByRole('radio', { name: 'Con Letras' })).toHaveCount(0);

  await send(JSON.stringify({ ...own, archivosFuentes: [{ familia: 'Letra Propia', peso: '200 1000', datos: `data:font/woff2;base64,${data}` }] }));
  await expect(page.getByTestId('theme-problem')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Con Letras' })).toHaveAttribute('aria-checked', 'true');
  const used = await page.getByTestId('previews').locator('.t1').first().evaluate((title) => getComputedStyle(title).fontFamily);
  expect(used).toContain('Letra Propia');
  expect(await page.evaluate(() => document.fonts.check('16px "Letra Propia"'))).toBe(true);
});

test('pasting a text: it gives the block, with its keys, and waits for the address', async ({ page }) => {
  await toWhere(page);
  await page.getByRole('radio', { name: /pegar un texto/ }).click();
  await button(page, 'Seguir').click();
  await button(page, 'Seguir').click();
  await button(page, 'Seguir').click();
  await button(page, 'Instalar').click();
  await expect(page.getByRole('heading')).toHaveText('Pegá este bloque al crear el servidor', { timeout: 20_000 });
  const block = await page.getByTestId('paste-block').inputValue();
  expect(block.startsWith('#!/bin/sh\n')).toBe(true);
  expect(block).toContain('URNA_SITE=auto');
  // The way in for later: the public half of the installer's key, never the private one.
  expect(block).toMatch(/^URNA_ADMIN_KEY=AAAA[\w+/=]+$/m);
  expect(block).not.toContain('PRIVATE KEY');
  expect(Buffer.byteLength(block)).toBeLessThan(16 * 1024);
  await page.locator('[data-field="pasteAddress"]').fill('no');
  await button(page, 'Comprobar').click();
  await expect(page.getByRole('alert')).toContainText('no parece válida');
});

test('on this computer: from the first screen to the first administrator, with their own theme', async ({ page, browser }) => {
  await toWhere(page);
  await page.getByRole('radio', { name: /Probar en esta computadora/ }).click();
  await button(page, 'Seguir').click();
  await expect(page.getByText(/Vamos a usar (podman|docker)/)).toBeVisible();
  await button(page, 'Seguir').click();
  await button(page, 'Seguir').click();
  // Dragged onto the window, like someone who has the file on their desktop.
  const theme = await page.evaluate(() => JSON.stringify({ ...(window as any).TEMAS[4], id: 'propio', nombre: 'Tema de Prueba' }));
  const dragged = await page.evaluateHandle((content) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], 'tema.json', { type: 'application/json' }));
    return transfer;
  }, theme);
  await page.dispatchEvent('[data-testid="theme-dropzone"]', 'drop', { dataTransfer: dragged });
  await expect(page.getByRole('radio', { name: 'Tema de Prueba' })).toHaveAttribute('aria-checked', 'true');
  await button(page, 'Instalar').click();
  await expect(page.getByRole('heading')).toHaveText('Tu Urna Abierta ya está andando', { timeout: 150_000 });
  await expect(page.getByTestId('theme-failed')).toHaveCount(0);
  // On this computer there are no backups, so there is no key to keep, and nothing to tick before opening it.
  await expect(page.getByTestId('recovery-key')).toHaveCount(0);
  await expect(page.getByTestId('local-note')).toContainText('no hay llave para guardar');
  await expect(button(page, 'Abrir Urna Abierta')).toBeEnabled();
  await expect(page.getByTestId('address')).toHaveText(/^http:\/\/localhost:\d+$/);
  const reader = page.getByTestId('reader-link');
  await expect(reader).toHaveText('bajá el lector de padrones');
  await expect(reader).toHaveAttribute('href', 'https://github.com/bafif/urna-abierta-padrones#descargar');
  await expect(reader).toHaveAttribute('target', '_blank');

  const { result } = await (await page.request.get('api/job')).json();
  const app = await (await browser.newContext()).newPage();
  await app.goto(result.setupLink);
  await app.getByTestId('setup-name').fill('Laura Paz');
  await app.getByTestId('setup-accept').check();
  await app.getByRole('button', { name: 'Empezar' }).click();
  // The whole party starts with it, and it can be chosen like any other.
  await expect(app.locator('.nombre-tema')).toContainText('Tema de Prueba');
  await expect(app.locator('.pantalla')).toHaveAttribute('data-material', 'almohada');
});
