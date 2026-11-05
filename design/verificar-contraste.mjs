// Checks that a theme can be read. Anyone creating a theme runs this, and the app can run it too.
//   node design/verificar-contraste.mjs [more theme files]
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const files = [new URL('../apps/web/src/lib/temas.js', import.meta.url).pathname, ...process.argv.slice(2)];
const context = { window: {} };
for (const file of files) vm.runInNewContext(readFileSync(file, 'utf8'), context);

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// What is read for a long time must reach 7:1, thinking of older eyes. Marks and lines only need 3:1.
const RULES = [
  ['texto', 'fondo', 7], ['texto', 'superficie', 7], ['texto', 'superficie2', 7],
  ['suave', 'fondo', 4.5], ['suave', 'superficie', 4.5],
  ['sobrePrimario', 'primario', 4.5], ['sobrePeligro', 'peligro', 4.5], ['peligroTexto', 'peligroFondo', 4.5],
  ['bien', 'bienFondo', 4.5], ['marca', 'fondo', 3], ['primario', 'fondo', 3], ['acento', 'fondo', 3],
];

let failures = 0;
for (const theme of context.window.TEMAS) {
  for (const mode of ['claro', 'oscuro']) {
    const colors = theme[mode];
    // A primary button may sit on its own footer band instead of the page background.
    const rules = RULES.filter((rule) => !(rule[0] === 'primario' && colors.fondoPie));
    if (colors.fondoPie) rules.push(['primario sobre su pie', colors.primario, colors.fondoPie, 3]);
    if (theme.recetas.cabecera === 'banda') {
      for (const [name, [band, on]] of Object.entries(colors.bandas ?? {})) rules.push([`banda ${name}`, band, on, 4.5]);
    }
    let lowest = Infinity;
    for (const rule of rules) {
      const [a, b, need] = rule.length === 4 ? [rule[1], rule[2], rule[3]] : [colors[rule[0]], colors[rule[1]], rule[2]];
      const value = ratio(a, b);
      lowest = Math.min(lowest, value / need);
      if (value < need) {
        failures += 1;
        console.log(`FALLA ${theme.nombre} ${mode}: ${rule[0]} sobre ${rule.length === 4 ? 'su banda' : rule[1]} da ${value.toFixed(2)} y pide ${need}`);
      }
    }
    const main = ratio(colors.texto, colors.fondo).toFixed(1);
    console.log(`${theme.nombre.padEnd(9)} ${mode.padEnd(7)} texto ${main}:1  margen ${lowest.toFixed(2)}`);
  }
}
console.log(failures ? `${failures} combinaciones no alcanzan` : 'Todas las combinaciones alcanzan');
process.exit(failures ? 1 : 0);
