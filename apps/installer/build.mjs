// Builds the installer as a single executable for the platform it runs on, packed the way it gets published.
//   URNA_VERSION=v0.1.0 node build.mjs
// Files that it carries inside are declared in src/assets.ts.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { build } from 'esbuild';
import { assetFiles } from './src/assets.ts';

const version = process.env.URNA_VERSION ?? 'latest';
// Alpine and the other Linux with musl instead of glibc: the Node that runs this is built for musl, and so is the
// installer that comes out. The one built with glibc runs on any Linux with glibc 2.28 or newer.
const musl = process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime;
const platform = `${process.platform}-${process.arch}${musl ? '-musl' : ''}`;
const windows = process.platform === 'win32';
const mac = process.platform === 'darwin';
/** Names a person recognizes on the releases page. */
const FRIENDLY = { 'win32-x64': 'windows', 'darwin-arm64': 'mac-apple', 'darwin-x64': 'mac-intel', 'linux-x64': 'linux-x64', 'linux-x64-musl': 'linux-x64-musl', 'linux-arm64': 'linux-arm64' };
const name = `urna-abierta-instalador-${FRIENDLY[platform] ?? platform}`;
// Browsers drop the permission to run a bare file, and archives keep it. Windows does not need it.
const published = `dist/${name}${windows ? '.exe' : mac ? '.zip' : '.tar.gz'}`;
const output = windows ? published : 'dist/urna-abierta-instalador';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node26',
  format: 'cjs',
  outfile: 'dist/instalador.cjs',
  // Optional speedups of the SSH library. Without them it works in plain JavaScript.
  external: ['cpu-features', '*.node'],
  define: { 'process.env.URNA_VERSION': JSON.stringify(version), 'import.meta.url': '__importMetaUrl' },
  banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  legalComments: 'none',
});

// Node 26 builds the executable itself: a copy of the Node that runs this, with the program inside.
writeFileSync('dist/sea.json', JSON.stringify({
  main: 'dist/instalador.cjs',
  output,
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets: assetFiles(),
}));
execFileSync(process.execPath, ['--build-sea', 'dist/sea.json'], { stdio: 'inherit' });
// macOS only runs what carries a signature. An ad-hoc one identifies nobody.
if (mac) execFileSync('codesign', ['--sign', '-', output]);
if (mac) {
  // Unzipped, it has to leave the program and nothing around it. With --keepParent on a lone file, ditto did not
  // (v0.1.0 and v0.1.1): from a folder that holds only the program, it packs what the folder holds.
  const folder = 'dist/mac';
  mkdirSync(folder);
  renameSync(output, join(folder, basename(output)));
  execFileSync('ditto', ['-c', '-k', '--norsrc', '--noextattr', folder, published]);
  const inside = execFileSync('zipinfo', ['-1', published], { encoding: 'utf8' }).split('\n').filter((entry) => entry && !entry.endsWith('/'));
  if (inside.join() !== basename(output)) throw new Error(`${published} lleva ${inside.join(', ')} en vez de ${basename(output)}`);
}
if (!windows && !mac) execFileSync('tar', ['-czf', published, '-C', 'dist', basename(output)]);
// So that anyone can check that what they downloaded is what was published.
const digest = createHash('sha256').update(readFileSync(published)).digest('hex');
writeFileSync(`${published}.sha256`, `${digest}  ${basename(published)}\n`);
console.log(published);
