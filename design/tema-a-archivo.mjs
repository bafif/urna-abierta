// Turns a theme written like the ones in temas.js into one file with everything inside: colors, logo
// and fonts. It is what the installer takes, or the app in Más cosas > Ajustes > Agregar un tema propio.
//   node design/tema-a-archivo.mjs mi-tema.js salida.json
//
// A font of your own is declared in the theme:
//   archivosFuentes: [{ familia: 'Mi Letra', peso: '400', archivo: 'mi-letra.woff2' }]
// Fonts of the app that the theme uses go inside as well, so that the file depends on nothing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const path = [resolve(dirname(source), theme.logo), resolve(dirname(source), '..', theme.logo)].find((candidate) => existsSync(candidate));
  if (!path) {
    console.error('No se encuentra el archivo del logo.');
    process.exit(1);
  }
  theme.logo = `data:${type};base64,${readFileSync(path).toString('base64')}`;
}
delete theme.privado;

const FONT_TYPES = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };

/** Relative to the theme, or to the design folder, which is where the gallery opens them from. */
function findFile(path) {
  return [resolve(dirname(source), path), resolve(dirname(source), '..', path)].find((candidate) => existsSync(candidate));
}

function embed(font, path) {
  const type = FONT_TYPES[extname(path)];
  if (!type) {
    console.error(`La letra ${font.familia} tiene que ser WOFF2, WOFF, TTF u OTF.`);
    process.exit(1);
  }
  const { archivo: _path, ...rest } = font;
  return { ...rest, datos: `data:${type};base64,${readFileSync(path).toString('base64')}` };
}

const declared = (theme.archivosFuentes ?? []).map((font) => {
  const path = font.archivo && findFile(font.archivo);
  if (!path) {
    console.error(`No se encuentra el archivo de la letra ${font.familia}.`);
    process.exit(1);
  }
  return embed(font, path);
});

// What the app brings is described in its own styles.
const styles = new URL('../apps/web/src/lib/tema.css', import.meta.url);
const bundled = [...readFileSync(styles, 'utf8').matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
  familia: /font-family:\s*'([^']+)'/.exec(body)?.[1],
  archivo: /url\('\.\/([^']+)'\)/.exec(body)?.[1],
  peso: /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim(),
  ancho: /font-stretch:\s*([^;]+);/.exec(body)?.[1]?.trim(),
}));
const used = new Set(Object.values(theme.fuentes).map((value) => String(value).split(',')[0].trim().replace(/^["']|["']$/g, '')));
const own = new Set(declared.map((font) => font.familia));
const fromApp = bundled
  .filter((font) => used.has(font.familia) && !own.has(font.familia))
  .map(({ familia, archivo, peso, ancho }) => embed({ familia, ...(peso ? { peso } : {}), ...(ancho ? { ancho } : {}) }, fileURLToPath(new URL(archivo, styles))));
if (declared.length + fromApp.length > 0) theme.archivosFuentes = [...declared, ...fromApp];

const problems = themeProblems(theme);
if (problems.length > 0) {
  console.error(`Ese tema no se puede usar:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  process.exit(1);
}
writeFileSync(output, JSON.stringify(theme), { mode: 0o600 });
const kilobytes = Math.round(Buffer.byteLength(JSON.stringify(theme)) / 1024);
console.log(`Listo: ${output} (${kilobytes} KB, con ${theme.archivosFuentes?.length ?? 0} archivos de letras). Arrastralo al instalador, o cargalo en la app, en Ajustes.`);
