import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { seed } from './helpers.ts';

const READER = 'https://github.com/bafif/urna-abierta-padrones#descargar';
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** A ZIP written by hand: without compression, enough for a .padron broken on purpose; or compressed, as a spreadsheet program does. */
function zip(files: Record<string, string>, { deflate = false } = {}): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const packed = deflate ? deflateRawSync(data) : data;
    const fileName = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, fileName, packed);
    directory.push(central, fileName);
    offset += 30 + fileName.length + packed.length;
  }
  const listing = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(listing.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, listing, end]);
}

/** A .padron with 25 kinds of problems, each on its own line of the file. */
function brokenPadron(): Buffer {
  const lines = (rows: unknown[]) => rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n');
  const person = (extra: object) => ({ id: `p-${Math.random()}`, full_name: 'Prueba, Persona', ...extra });
  const units = [{ id: 'm-1', name: 'Mesa 1' }, { name: 'Mesa 2' }, { id: 'm-3' }, { id: 'm-4', name: 'Mesa 4', level: 5 }, { id: 'm-5', name: 'Mesa 5', parent: 5 }, { id: 'm-6', name: 'Mesa 6', declared_total: 'x' }, { id: 'm-7', name: 'x'.repeat(121) }, '{roto'];
  const electors = [
    { id: 'a', full_name: 'Prueba, Ana', table: 'm-1' }, { full_name: 'Prueba, Persona' }, { id: 'b' }, person({ table: 5 }), person({ order: 0 }), person({ family_name: 5 }), person({ given_names: 5 }),
    person({ identifiers: 'x' }), person({ address: 5 }), person({ birth_year: 'x' }), person({ extra: 'x' }), person({ review: { status: 'x' } }), person({ full_name: 'x'.repeat(201) }),
    person({ address: 'x'.repeat(201) }), person({ id: 'x'.repeat(65) }), { id: 'a', full_name: 'Prueba, Otra' }, { id: 'z', full_name: 'Prueba, Luis', table: 'm-9' }, '{roto',
  ];
  const manifest = { format: 'padron-abierto', format_version: '0.1.0', files: { units: { path: 'units.jsonl', count: units.length }, electors: { path: 'electors.jsonl', count: electors.length + 1 } } };
  return zip({ 'manifest.json': JSON.stringify(manifest), 'units.jsonl': lines(units), 'electors.jsonl': lines(electors) });
}

/** An Excel file with `count` invented people, their documents starting with 99: as big as the roll of a whole university. */
function bigSheet(count: number): Buffer {
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (content: string) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${content}</Relationships>`;
  const text = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const rows = [`<row r="1">${text('A1', 'Apellido y nombre')}${text('B1', 'DNI')}</row>`];
  for (let i = 1; i <= count; i += 1) rows.push(`<row r="${i + 1}">${text(`A${i + 1}`, `Prueba, Persona ${i}`)}<c r="B${i + 1}"><v>${99000000 + i}</v></c></row>`);
  return zip({
    '_rels/.rels': rels(rel('rId1', 'officeDocument', 'xl/workbook.xml')),
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hoja1" sheetId="1" r:id="rIdS"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': rels(rel('rIdS', 'worksheet', 'worksheets/sheet1.xml')),
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`,
  }, { deflate: true });
}

/** An administrator with a new election, on the screen to upload its roll. */
async function toUpload(page: Page, request: Parameters<typeof seed>[0]) {
  const demo = await seed(request, { size: 5 });
  await page.goto(`/#invitacion=${demo.links.coordinacion}`);
  await button(page, 'Usar este').click();
  await button(page, 'Crear una elección').click();
  await page.getByTestId('election-name').fill('Padrón de prueba');
  await button(page, 'Seguir').click();
  const today = await page.evaluate(() => new Date().getDate());
  await page.getByTestId('day').nth(today - 1).click();
  await button(page, 'Seguir').click();
  await page.getByTestId('category-name').fill('Centro');
  await page.getByTestId('category-lists').fill('Lista Azul\nLista Verde');
  await button(page, 'Crear la elección').click();
  await button(page, 'Subir el padrón').click();
  await expect(page.getByRole('heading')).toHaveText('Subí el padrón');
}

test('an Excel spreadsheet goes in as it is, header below a title and all', async ({ page, request }) => {
  await toUpload(page, request);
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/roll')) sent.push(r.headers()['content-type'] ?? '');
  });
  const xlsx = readFileSync(new URL('./padron-prueba.xlsx', import.meta.url));
  await page.getByTestId('roll-file').setInputFiles({ name: 'padron.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  await expect(page.getByTestId('roll-summary')).toContainText('12 personas');
  // The row without a name is pointed out by the number Excel shows, and nothing it says.
  await expect(page.getByTestId('roll-problems')).toContainText('Mirá esto antes de cargarlo');
  await expect(page.getByTestId('roll-problems')).toContainText('Fila 16: no tiene nombre, así que quedó afuera.');
  await expect(page.getByTestId('roll-problems')).not.toContainText('99000300');
  // Its second sheet has a note: only the first one is read, and it says so.
  await expect(page.getByTestId('roll-problems')).toContainText('otras hojas con algo escrito, y solo se lee la primera');
  await button(page, 'Cargarlo').click();
  // Its tables came in the file, so the next step is already the poll watchers.
  await expect(page.locator('.estacion.ahora')).toContainText('Fiscales');
  // The server got a .padron built in the browser, never the spreadsheet.
  expect(sent).toEqual(['application/zip', 'application/zip']);
});

test('a big spreadsheet is read without freezing the page, which says it is reading meanwhile', async ({ page, request }) => {
  await toUpload(page, request);
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/roll')) sent.push(r.headers()['content-type'] ?? '');
  });
  // A beat every 10 ms: the longest wait between two is how long the page stopped answering.
  await page.evaluate(() => {
    const beats = window as unknown as { longest: number };
    beats.longest = 0;
    let last = performance.now();
    window.setInterval(() => {
      const now = performance.now();
      beats.longest = Math.max(beats.longest, now - last);
      last = now;
    }, 10);
  });
  await page.getByTestId('roll-file').setInputFiles({ name: 'grande.xlsx', mimeType: 'application/octet-stream', buffer: bigSheet(100_000) });
  await expect(page.getByText('Leyendo…')).toBeVisible();
  await expect(page.getByTestId('roll-summary')).toContainText(/100\.?000 personas/);
  // Reading it on the page took seconds; in a worker the page never waits for it.
  expect(await page.evaluate(() => (window as unknown as { longest: number }).longest)).toBeLessThan(1000);
  expect(sent).toEqual(['application/zip']);
});

test('a scanned PDF is not uploaded: it says how to read it, with the reader a tap away', async ({ page, request }) => {
  await toUpload(page, request);
  await expect(page.locator('.aclara').getByRole('link', { name: 'Bajar el lector de padrones' })).toHaveAttribute('href', READER);
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/roll')) sent.push(r.url());
  });
  await page.getByTestId('roll-file').setInputFiles({ name: 'padron escaneado.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%prueba\n') });
  const card = page.getByTestId('roll-pdf');
  await expect(card).toContainText('Un PDF no se sube directo');
  const link = card.getByRole('link', { name: 'Bajar el lector de padrones' });
  await expect(link).toHaveAttribute('href', READER);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(page.getByTestId('roll-summary')).toHaveCount(0);
  expect(sent).toEqual([]);
});

test('what cannot be read says why and where, in a short list without the content of any row', async ({ page, request }) => {
  await toUpload(page, request);
  const file = page.getByTestId('roll-file');

  await file.setInputFiles({ name: 'padron.padron', mimeType: 'application/octet-stream', buffer: Buffer.from('esto no es un padrón') });
  await expect(page.getByRole('alert')).toContainText('No se pudo leer ese archivo');
  await expect(page.getByTestId('roll-problems').locator('li')).toHaveText(['No es un archivo .padron ni una planilla.']);

  await file.setInputFiles({ name: 'padron.csv', mimeType: 'text/csv', buffer: Buffer.from('dni;mesa\n99000400;1\n') });
  await expect(page.getByTestId('roll-problems')).toContainText('Fila 1: no encontramos la columna de los nombres');

  await file.setInputFiles({ name: 'padron.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('tampoco es una planilla') });
  await expect(page.getByRole('alert')).toHaveText('No es una planilla de Excel que se pueda abrir. Guardala de nuevo como .xlsx o como CSV.');
  await expect(page.getByTestId('roll-problems')).toHaveCount(0);

  // Many rows without a name are one line, with the first rows and how many more. The same person twice is loaded once, at the first
  // row; another name with the same DNI is one more person, and both are left for review.
  const rows = ['nombre,dni', 'Prueba Ana,99000500', ...Array.from({ length: 25 }, (_, i) => `,${99000600 + i}`), ',,', 'PRUEBA ANA,99.000.500', 'Prueba Luis,9900070000', 'Ejemplo Sol,99000500'];
  await file.setInputFiles({ name: 'padron.csv', mimeType: 'text/csv', buffer: Buffer.from(`${rows.join('\n')}\n`) });
  await expect(page.getByTestId('roll-summary')).toContainText('3 personas');
  await expect(page.getByTestId('roll-summary')).toContainText('3 filas quedan para que las mires.');
  const list = page.getByTestId('roll-problems');
  await expect(list.locator('li')).toHaveText([
    'Filas 2 y 31: tienen el mismo DNI o legajo que otra fila, pero el nombre es otro o está escrito distinto. Se cargan igual y quedan para que las revises.',
    'Filas 3, 4, 5 y 22 más: no tienen nombre, así que quedaron afuera.',
    'Fila 29: es la misma persona que en una fila anterior (mismo DNI o legajo y mismo nombre, seguramente en otra carrera). Vota una sola vez, en la mesa de la primera fila, así que queda solo ahí.',
    'Fila 30: el documento no tiene 7 u 8 números. Se carga igual y queda para que lo revises.',
  ]);
  await expect(list).not.toContainText('990006');
});

test('a long list of problems shows twenty kinds and counts the rest', async ({ page, request }) => {
  await toUpload(page, request);
  await page.getByTestId('roll-file').setInputFiles({ name: 'roto.padron', mimeType: 'application/octet-stream', buffer: brokenPadron() });
  // Two people with one id and different names are both loaded.
  await expect(page.getByTestId('roll-summary')).toContainText('3 personas');
  const list = page.getByTestId('roll-problems');
  await expect(list.locator('li')).toHaveCount(20);
  await expect(list.locator('li').first()).toHaveText('Mesas, línea 2: no se entiende la identificación, así que quedó afuera.');
  await expect(list).toContainText('Mesas, línea 7: hay demasiado texto en el nombre, así que quedó afuera.');
  await expect(list).toContainText('y 5 más');
  await expect(list).not.toContainText('Prueba');
});

test('an old Excel file or an OpenDocument sheet is never sent: it says how to save it', async ({ page, request }) => {
  await toUpload(page, request);
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/roll')) sent.push(r.url());
  });
  const file = page.getByTestId('roll-file');
  const oldExcel = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  for (const picked of [{ name: 'padron.xls', buffer: oldExcel }, { name: 'padron.ods', buffer: Buffer.from('PK') }, { name: 'renombrada.xlsx', buffer: oldExcel }]) {
    await file.setInputFiles({ ...picked, mimeType: 'application/octet-stream' });
    // The reason is the whole message: the file is the roll, only in a format the app does not read.
    await expect(page.getByRole('alert')).toHaveText('Esta planilla no se puede leer así. Guardala como .xlsx o .csv y subila de nuevo.');
    await expect(page.getByTestId('roll-problems')).toHaveCount(0);
  }
  expect(sent).toEqual([]);
});
