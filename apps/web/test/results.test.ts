import { describe, expect, it } from 'vitest';
import { resultsCsv, shareOf, type ResultsByTable } from '../src/lib/results.ts';

const words = { table: 'Mesa', category: 'Categoría', list: 'Lista', votes: 'Votos', undecided: 'Sin elegir', missing: 'Sin escrutinio' };
const sheet: ResultsByTable = {
  name: 'Centro', status: 'escrutinio', tables: 3,
  categories: [{ id: 'c', name: 'Consejo', counted: 1, undecided: 1, missing: 1, lists: [{ id: 'a', name: 'Lista "Azul"', votes: 10 }, { id: 'blanco', name: 'En blanco', votes: 2 }] }],
  perTable: [
    { name: 'Mesa 1', categories: { c: { a: 10, blanco: 2 } } },
    { name: '=1+1', categories: { c: 'undecided' } },
    { name: 'Mesa 3', categories: { c: null } },
  ],
};

describe('the results spreadsheet', () => {
  it('has a row per table and list, and says why a table adds nothing', () => {
    expect(resultsCsv(sheet, words).split('\r\n')).toEqual([
      '\uFEFFMesa,Categoría,Lista,Votos',
      'Mesa 1,Consejo,"Lista ""Azul""",10',
      'Mesa 1,Consejo,En blanco,2',
      "'=1+1,Consejo,Sin elegir,",
      'Mesa 3,Consejo,Sin escrutinio,',
      '',
    ]);
  });

  it('shares are of all the votes, blank included', () => {
    expect(shareOf(10, sheet.categories[0]!)).toBe(83);
    expect(shareOf(0, { ...sheet.categories[0]!, lists: [] })).toBe(0);
  });
});
