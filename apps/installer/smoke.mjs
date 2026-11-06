// Takes a built installer as a person downloads it, unpacks it, starts it, and checks that its screens answer.
//   URNA_VERSION=v0.1.0 node smoke.mjs dist/urna-abierta-instalador-linux.tar.gz
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const asset = process.argv[2];
const version = process.env.URNA_VERSION ?? 'latest';
const folder = mkdtempSync(join(tmpdir(), 'urna-instalador-'));
const fail = (why) => {
  console.error(`El instalador ${asset} no pasó: ${why}`);
  process.exit(1);
};

let program = asset;
if (asset.endsWith('.zip')) {
  execFileSync('ditto', ['-x', '-k', asset, folder]);
  program = join(folder, 'urna-abierta-instalador');
} else if (asset.endsWith('.tar.gz')) {
  execFileSync('tar', ['-xzf', asset, '-C', folder]);
  program = join(folder, 'urna-abierta-instalador');
}
if (process.platform !== 'win32' && !(statSync(program).mode & 0o100)) fail('al desempacarlo no se puede ejecutar');

const child = spawn(program, [], { env: { ...process.env, URNA_NO_BROWSER: '1', URNA_CONFIG_DIR: folder }, stdio: ['ignore', 'pipe', 'inherit'] });
const finish = (code) => {
  child.kill();
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  process.exit(code);
};
const timer = setTimeout(() => fail('no dio su dirección en 60 segundos'), 60_000);
child.on('exit', (code) => fail(`se cerró solo, con el código ${code}`));

let said = '';
child.stdout.on('data', async (chunk) => {
  said += chunk;
  const url = /^http:\/\/127\.0\.0\.1:\d+\/[\w-]+\/$/m.exec(said)?.[0];
  if (!url) return;
  child.stdout.removeAllListeners('data');
  clearTimeout(timer);
  try {
    const page = await fetch(url);
    const html = await page.text();
    if (!page.ok || !html.includes('app.js')) fail(`su página contestó ${page.status}`);
    const script = await fetch(`${url}app.js`);
    if (!script.ok) fail(`app.js contestó ${script.status}`);
    const state = await (await fetch(`${url}api/state`)).json();
    if (state.version !== version) fail(`dice que es la versión ${state.version}, y es la ${version}`);
    console.log(`${asset}: arranca, muestra sus pantallas y es la versión ${state.version}`);
    child.removeAllListeners('exit');
    finish(0);
  } catch (error) {
    fail(error.message);
  }
});
