// Checks that a theme can be read. Anyone creating a theme runs this, and the app can run it too.
//   node design/verificar-contraste.mjs [more theme files]
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { contrastReport, themeProblemText } from '../packages/domain/src/theme-check.ts';

const files = [new URL('../apps/web/src/lib/temas.js', import.meta.url).pathname, ...process.argv.slice(2)];
const context = { window: {} };
for (const file of files) vm.runInNewContext(readFileSync(file, 'utf8'), context);

let failures = 0;
for (const theme of context.window.TEMAS) {
  for (const mode of ['claro', 'oscuro']) {
    const { problems, main, lowest } = contrastReport(theme, mode);
    for (const problem of problems) {
      failures += 1;
      console.log(`FALLA ${theme.nombre} ${themeProblemText(problem, 'es')}`);
    }
    console.log(`${theme.nombre.padEnd(9)} ${mode.padEnd(7)} texto ${main.toFixed(1)}:1  margen ${lowest.toFixed(2)}`);
  }
}
console.log(failures ? `${failures} combinaciones no alcanzan` : 'Todas las combinaciones alcanzan');
process.exit(failures ? 1 : 0);
