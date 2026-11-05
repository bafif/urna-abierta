// Builds the installer as a single executable for the platform it runs on.
//   URNA_VERSION=0.1.0 node build.mjs
// Files that it carries inside are declared in src/assets.ts.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { build } from 'esbuild';
import { assetFiles } from './src/assets.ts';

const version = process.env.URNA_VERSION ?? 'latest';
const platform = `${process.platform}-${process.arch}`;
const windows = process.platform === 'win32';
const output = `dist/urna-abierta-instalador-${platform}${windows ? '.exe' : ''}`;
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: 'dist/instalador.cjs',
  // Optional speedups of the SSH library. Without them it works in plain JavaScript.
  external: ['cpu-features', '*.node'],
  define: { 'process.env.URNA_VERSION': JSON.stringify(version), 'import.meta.url': '__importMetaUrl' },
  banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  legalComments: 'none',
});

writeFileSync('dist/sea.json', JSON.stringify({
  main: 'dist/instalador.cjs',
  output: 'dist/instalador.blob',
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets: assetFiles(),
}));
execFileSync(process.execPath, ['--experimental-sea-config', 'dist/sea.json'], { stdio: 'inherit' });

copyFileSync(process.execPath, output);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', output]);
execFileSync('npx', ['postject', output, 'NODE_SEA_BLOB', 'dist/instalador.blob', '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: 'inherit', shell: windows });
// macOS only runs what carries a signature. An ad-hoc one identifies nobody.
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', output]);
// So that anyone can check that what they downloaded is what was published.
const digest = createHash('sha256').update(readFileSync(output)).digest('hex');
writeFileSync(`${output}.sha256`, `${digest}  ${basename(output)}\n`);
console.log(output);
