// Turns a theme written like the ones in temas.js into the file the app takes in
// Más cosas > Ajustes > Agregar un tema propio. The logo goes inside the file.
//   node design/tema-a-archivo.mjs mi-tema.js salida.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import vm from 'node:vm';
import { themeProblems } from '../packages/domain/src/theme-check.ts';

const [source, output] = process.argv.slice(2);
if (!source || !output) {
  console.error('Uso: node design/tema-a-archivo.mjs <tema.js> <salida.json>');
  process.exit(2);
}

const context = { window: {} };
vm.runInNewContext(readFileSync(source, 'utf8'), context);
const [theme] = JSON.parse(JSON.stringify(context.window.TEMAS ?? []));
if (!theme) {
  console.error('Ese archivo no agrega ningún tema a window.TEMAS.');
  process.exit(1);
}

const TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
if (theme.logo && !theme.logo.startsWith('data:')) {
  const type = TYPES[extname(theme.logo)];
  if (!type) {
    console.error('El logo tiene que ser SVG, PNG o WebP.');
    process.exit(1);
  }
  // Paths in a theme are relative to the design folder, which is where the gallery opens them from.
  const path = [resolve(dirname(source), theme.logo), resolve(dirname(source), '..', theme.logo)].find((candidate) => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!path) {
    console.error('No se encuentra el archivo del logo.');
    process.exit(1);
  }
  theme.logo = `data:${type};base64,${readFileSync(path).toString('base64')}`;
}
delete theme.privado;

const problems = themeProblems(theme);
if (problems.length > 0) {
  console.error(`Ese tema no se puede usar:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  process.exit(1);
}
writeFileSync(output, JSON.stringify(theme), { mode: 0o600 });
console.log(`Listo: ${output}. Cargalo en la app, en Ajustes.`);
