// Writes a roll of invented people, for drills. Every document starts with 99, which no real one does here.
//   node deploy/padron-inventado.mjs 350 > padron.csv
import { fakeRoll } from '../packages/domain/src/fake-roll.ts';

const size = Number(process.argv[2] ?? 350);
if (!Number.isInteger(size) || size < 1) {
  console.error('Uso: node deploy/padron-inventado.mjs <cantidad de personas>');
  process.exit(2);
}
const rows = fakeRoll(size, Date.now() % 1000).map((person, index) => `"${person.name}",${99000000 + index + 1}`);
console.log(`apellido y nombre,dni\n${rows.join('\n')}`);
