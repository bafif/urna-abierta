// Runs the phone test on a real Chrome inside the Android emulator.
//
//   deploy/serve.sh
//   deploy/android-emulator.sh --headless
//   ADB=<path to adb> node apps/web/e2e-android/check.mjs results.json screenshots/
//
// The address of the app stays reachable in airplane mode, because adb does not use the
// network. Cutting the signal therefore means turning on airplane mode and removing the tunnel.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const ADB = process.env.ADB ?? 'adb';
const PORT = 8090;
const SITE = `http://localhost:${PORT}`;
// Starts in ten days, so that moving the clock does not end the election and the roll stays.
const seed = async (body) => (await fetch(`${SITE}/api/test/seed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const demo = await seed({ size: 350, tables: 1, startsInDays: 10 });
const TABLE = demo.tables[0].table;
// The second poll watcher of the table is the one that reads what reached the server.
const { token: READER } = await (await fetch(`${SITE}/api/auth/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: demo.tables[0].invitations[1] }) })).json();
const [resultsPath, shotsDirectory] = process.argv.slice(2);
const results = [];

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 180_000 }).trim();
const shell = (command) => adb('shell', command);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function record(step, ok, detail = {}) {
  results.push({ step, ok, ...detail });
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${step} ${JSON.stringify(detail)}`);
}

function screenshot(name) {
  if (!shotsDirectory) return;
  mkdirSync(shotsDirectory, { recursive: true });
  const image = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(`${shotsDirectory}/${name}.png`, image);
}

/** As a normal user, like the videos on a real phone: the system keeps its own reserve. */
function fillDisk(leaveMB) {
  const free = Math.floor(Number(shell("df -k /sdcard | tail -n 1 | awk '{print $4}'")) / 1024);
  const count = leaveMB === 0 ? free + 1024 : Math.max(0, free - leaveMB);
  shell(`su 2000 sh -c 'dd if=/dev/zero of=/sdcard/Download/relleno bs=1048576 count=${count} 2>/dev/null'; true`);
  return Math.round(Number(shell("df -k /sdcard | tail -n 1 | awk '{print $4}'")) / 1024);
}

function emptyDisk() {
  shell('rm -f /sdcard/Download/relleno /data/local/tmp/relleno');
}

async function waitForBoot() {
  adb('wait-for-device');
  while (shell('getprop sys.boot_completed') !== '1') await sleep(2_000);
  // Right after booting, the phone's side of adb may still refuse this.
  for (let attempt = 0; ; attempt += 1) {
    try {
      adb('root');
      break;
    } catch (error) {
      if (attempt >= 20) throw error;
      await sleep(3_000);
    }
  }
  await sleep(2_000);
  adb('wait-for-device');
  while (shell('getprop sys.boot_completed') !== '1') await sleep(1_000);
  shell('echo "chrome --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line');
  shell('chmod 644 /data/local/tmp/chrome-command-line');
  shell('am set-debug-app --persistent com.android.chrome');
  shell('settings put global window_animation_scale 0');
  shell('settings put global transition_animation_scale 0');
}

function signal(on) {
  shell(`cmd connectivity airplane-mode ${on ? 'disable' : 'enable'}`);
  if (on) adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
  else adb('reverse', '--remove-all');
}

async function openChrome(invitation) {
  shell('am force-stop com.android.chrome');
  await sleep(1_000);
  const address = invitation ? `${SITE}/#invitacion=${invitation}` : `${SITE}/`;
  shell(`am start -a android.intent.action.VIEW -d "${address}" -n com.android.chrome/com.google.android.apps.chrome.Main`);
  adb('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote');
  for (let attempt = 0; ; attempt += 1) {
    try {
      const browser = await chromium.connectOverCDP('http://localhost:9222');
      for (let wait = 0; wait < 60; wait += 1) {
        const page = browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().startsWith(SITE));
        if (page) {
          page.on('dialog', (dialog) => void dialog.accept());
          return { browser, page };
        }
        await sleep(1_000);
      }
      throw new Error('la app no apareció en Chrome');
    } catch (error) {
      // After a cold start Chrome takes a while to open its debugging port.
      if (attempt >= 120) throw error;
      await sleep(2_000);
    }
  }
}

/** From the plan to the roll. Before the election it is the secondary way in. */
async function openRoll(page) {
  await page.getByRole('button', { name: /Abrir el padrón/ }).click({ timeout: 90_000 });
  await page.getByTestId('remaining').waitFor({ timeout: 30_000 });
}

const inOneLine = (text) => text.replace(/\s+/g, ' ').trim();

async function status(page) {
  const faltan = inOneLine(await page.getByTestId('remaining').innerText());
  const envios = await page.getByTestId('sync-status').innerText();
  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: 'Ajustes' }).click();
  const values = await page.locator('dl').evaluate((list) => {
    const terms = [...list.querySelectorAll('dt')].map((item) => item.textContent.trim());
    const details = [...list.querySelectorAll('dd')].map((item) => item.textContent.trim());
    return Object.fromEntries(terms.map((term, index) => [term, details[index]]));
  });
  await page.getByRole('button', { name: 'Volver' }).click();
  await openRoll(page);
  return { ...values, faltan, envios };
}

async function markFirst(page, count) {
  for (let i = 0; i < count; i += 1) {
    await page.getByTestId('person').first().click();
    await sleep(120);
  }
}

function setClock(milliseconds) {
  const date = new Date(milliseconds);
  const two = (value) => String(value).padStart(2, '0');
  shell('settings put global auto_time 0');
  shell(
    `date ${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${date.getUTCFullYear()}.${two(date.getUTCSeconds())}`,
  );
}

async function pendingOnServer() {
  let since = 0;
  let total = 0;
  for (;;) {
    const body = await (await fetch(`${SITE}/api/sync/pull?table=${TABLE}&since=${since}`, { headers: { authorization: `Bearer ${READER}` } })).json();
    total += body.operations.length;
    since = body.next;
    if (!body.more) return total;
  }
}

async function loadTest(size) {
  // Another table for the same phone: it lets go of the previous roll and prepares this one.
  const other = await seed({ size, tables: 1 });
  const { browser, page } = await openChrome(other.tables[0].invitations[0]);
  await page.getByRole('button', { name: 'Preparar la mesa' }).click({ timeout: 90_000 });
  await openRoll(page);
  await page.getByTestId('remaining').filter({ hasText: `de ${size}` }).waitFor({ timeout: 120_000 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await markFirst(page, 40);
  const values = await status(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await browser.close();
  return values['Respuesta al tachar (mediana / peor)'];
}

// This test erases Chrome and fills the disk: it must never touch a real phone.
adb('wait-for-device');
if (shell('getprop ro.kernel.qemu') !== '1' && shell('getprop ro.boot.qemu') !== '1') {
  console.error('Esto no es un emulador: la prueba borraría los datos de Chrome de este teléfono.');
  process.exit(2);
}
await waitForBoot();
emptyDisk();
const startedAt = Date.now();
setClock(startedAt);
shell('pm clear com.android.chrome');
shell('echo "chrome --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line');
signal(true);
let marks = 0;

{
  const { browser, page } = await openChrome(demo.tables[0].invitations[0]);
  const userAgent = await page.evaluate(() => navigator.userAgent);
  await page.getByRole('button', { name: 'Empezar' }).click({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Usar este' }).click();
  await page.getByRole('button', { name: 'Preparar la mesa' }).click();
  await openRoll(page);
  await page.getByTestId('remaining').filter({ hasText: 'faltan, de 350' }).waitFor({ timeout: 60_000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  const values = await status(page);
  record('prepara la mesa con señal', true, { chrome: /Chrome\/([\d.]+)/.exec(userAgent)?.[1], protegido: values['Almacenamiento protegido'] });
  screenshot('1-mesa');
  await browser.close();
}

signal(false);
await sleep(3_000);

{
  const { browser, page } = await openChrome();
  await openRoll(page);
  const opened = inOneLine(await page.getByTestId('remaining').innerText());
  record('abre sin señal, desde cero', opened.includes('350 faltan, de 350'), { faltan: opened });
  await markFirst(page, 20);
  marks += 20;
  await page.getByRole('searchbox').fill('nunez');
  const found = await page.getByTestId('person').first().locator('.nombre').innerText();
  record('la búsqueda sin acentos encuentra', found.includes('Núñez'));
  await page.getByTestId('person').first().click();
  marks += 1;
  screenshot('2-sin-senal');
  const values = await status(page);
  record('tacha sin señal', values.faltan.includes('329 faltan, de 350'), { faltan: values.faltan, envios: values.envios, tachar: values['Respuesta al tachar (mediana / peor)'], guardar: values['Guardado en el teléfono (mediana / peor)'] });
  await page.getByRole('button', { name: 'Algo anda mal' }).click();
  await page.getByTestId('report').click();
  await page.getByRole('link', { name: 'Mandar WhatsApp' }).waitFor({ timeout: 30_000 });
  marks += 1;
  record('el aviso urgente ofrece el plan B', true);
  screenshot('3-aviso');
  await browser.close();
}

{
  adb('reboot');
  await sleep(5_000);
  await waitForBoot();
  const { browser, page } = await openChrome();
  await openRoll(page);
  const values = await status(page);
  record('sobrevive al reinicio, sin señal', values.faltan.includes('329 faltan, de 350') && values['Datos intactos'] === 'sí', { faltan: values.faltan, intactos: values['Datos intactos'], envios: values.envios });
  await browser.close();
}

{
  setClock(startedAt + 9 * 86_400_000);
  await sleep(2_000);
  const { browser, page } = await openChrome();
  await openRoll(page);
  const values = await status(page);
  record('sigue todo con el reloj 9 días después', values.faltan.includes('329 faltan, de 350'), { faltan: values.faltan, sinAbrir: values['Mayor tiempo sin abrirla'] });
  await browser.close();
}

{
  // On a phone with no room at all, a write breaks the database. The app must see it coming.
  const left = fillDisk(0);
  const { browser, page } = await openChrome();
  await openRoll(page);
  const warned = await page.getByTestId('no-room').waitFor({ timeout: 30_000 }).then(() => true, () => false);
  const blocked = await page.getByTestId('person').first().isDisabled().catch(() => false);
  const offered = await page.getByRole('button', { name: 'Probar de nuevo' }).isVisible().catch(() => false);
  record('sin espacio, avisa y no deja tachar', warned && blocked && offered, { libresMB: left });
  screenshot('5-sin-espacio');
  await sleep(2_000);
  emptyDisk();
  const freedAt = Date.now();
  await page.getByRole('button', { name: 'Probar de nuevo' }).click();
  await page.getByTestId('no-room').waitFor({ state: 'detached', timeout: 300_000 });
  record('al liberar espacio, el aviso se va solo', true, { segundos: Math.round((Date.now() - freedAt) / 1000) });
  await markFirst(page, 2);
  marks += 2;
  const values = await status(page);
  record('al liberar espacio, sigue todo y vuelve a tachar', values.faltan.includes('327 faltan, de 350') && values['Datos intactos'] === 'sí', { faltan: values.faltan, intactos: values['Datos intactos'] });
  await browser.close();
}

{
  setClock(Date.now());
  signal(true);
  await sleep(3_000);
  const { browser, page } = await openChrome();
  await openRoll(page);
  await page.getByTestId('sync-status').filter({ hasText: 'Todo enviado' }).waitFor({ timeout: 120_000 });
  const onServer = await pendingOnServer();
  record('al volver la señal, llega todo al servidor', onServer === marks, { enElServidor: onServer, hechas: marks });
  screenshot('4-enviado');
  await browser.close();
}

{
  // A little room left, more than the check asks for: everything has to keep working.
  const left = fillDisk(800);
  const { browser, page } = await openChrome();
  await openRoll(page);
  await sleep(5_000);
  const warned = await page.getByTestId('no-room').isVisible();
  await markFirst(page, 2);
  marks += 2;
  await page.getByTestId('sync-status').filter({ hasText: 'Todo enviado' }).waitFor({ timeout: 60_000 });
  const onServer = await pendingOnServer();
  record('con poco espacio, pero suficiente, anda normal', !warned && onServer === marks, { libresMB: left, aviso: warned, enElServidor: onServer, hechas: marks });
  await browser.close();
  emptyDisk();
}

for (const size of [350, 5000]) {
  record(`tachar con ${size} personas, CPU 6 veces más lenta`, true, { mediana_y_peor: await loadTest(size) });
}

shell('settings put global auto_time 1');
if (resultsPath) writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
process.exit(results.every((item) => item.ok) ? 0 : 1);
