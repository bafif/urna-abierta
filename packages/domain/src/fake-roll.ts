import { foldText } from './text.ts';

export interface RollEntry {
  id: string;
  order: number;
  name: string;
  /** Only the last digits: enough to tell two people apart, not enough to identify anyone. */
  documentSuffix: string;
  search: string;
}

const FAMILY = [
  'Acuña', 'Aguirre', 'Álvarez', 'Benítez', 'Cáceres', 'Castaño', 'Domínguez', 'Fernández', 'Giménez', 'González',
  'Ibáñez', 'Juárez', 'López', 'Martínez', 'Muñoz', 'Núñez', 'Ortiz', 'Peña', 'Pérez', 'Quiroga', 'Ríos', 'Rodríguez',
  'Sánchez', 'Suárez', 'Toledo', 'Vázquez', 'Yáñez', 'Zárate',
];
const GIVEN = [
  'Ana', 'Andrés', 'Belén', 'Bruno', 'Camila', 'Dario', 'Elena', 'Facundo', 'Florencia', 'Gastón', 'Inés', 'Joaquín',
  'Julieta', 'Lucía', 'Martín', 'María José', 'Nicolás', 'Paula', 'Ramiro', 'Sofía', 'Tomás', 'Valentina',
];

/** Same seed, same roll: every run of a test sees the same invented people. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Invented roll for tests. Real rolls never reach this repository. */
export function fakeRoll(size: number, seed = 1): RollEntry[] {
  const next = generator(seed);
  const pick = (list: string[]) => list[Math.floor(next() * list.length)]!;
  const people = Array.from({ length: size }, () => ({
    family: `${pick(FAMILY)} ${next() < 0.2 ? pick(FAMILY) : ''}`.trim(),
    given: pick(GIVEN),
    suffix: String(Math.floor(next() * 1000)).padStart(3, '0'),
  }));
  people.sort((a, b) => a.family.localeCompare(b.family, 'es') || a.given.localeCompare(b.given, 'es'));
  return people.map((person, index) => {
    const name = `${person.family}, ${person.given}`;
    return {
      id: `e-${String(index + 1).padStart(6, '0')}`,
      order: index + 1,
      name,
      documentSuffix: person.suffix,
      search: foldText(`${index + 1} ${name} ${person.suffix}`),
    };
  });
}
