import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { fileNumberOf, groupProblems, mainRole, MAX_UNZIPPED_BYTES, readCsvRoll, readPadron, ROLES, rolesCan, writePadron } from '../src/index.ts';
import { declareSize } from './zip.ts';

const person = (id: string, extra = {}) => ({ id, full_name: `Prueba, Persona ${id}`, ...extra });

describe('.padron files', () => {
  it('reads back what it writes', () => {
    const file = writePadron({ title: 'Prueba', units: [{ id: 'm-1', name: 'Mesa 1', level: 'table', parent: null }], electors: [person('e-1', { table: 'm-1', order: 1 }), person('e-2', { review: { status: 'pending' } })] });
    const { padron, problems } = readPadron(file);
    expect(problems).toEqual([]);
    expect(padron?.electors).toHaveLength(2);
    expect(padron?.electors[1]?.review?.status).toBe('pending');
  });

  it('refuses what is not a roll, and says why without showing data', () => {
    expect(readPadron(strToU8('nada')).problems[0]?.problem).toBe('not_a_zip');
    expect(readPadron(zipSync({ 'otro.txt': strToU8('x') })).problems[0]?.problem).toBe('missing_manifest');
    const future = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'padron-abierto', format_version: '1.0.0', files: { electors: { path: 'e', count: 0 } } })) });
    expect(readPadron(future).problems[0]?.problem).toBe('unsupported_version');
  });

  it('reports a bad row without dropping it silently', () => {
    const manifest = { format: 'padron-abierto', format_version: '0.1.0', files: { electors: { path: 'e.jsonl', count: 2 } } };
    const file = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'e.jsonl': strToU8(`${JSON.stringify(person('a'))}\n{"id":"b"}\n`) });
    const { padron, problems } = readPadron(file);
    expect(padron?.electors).toHaveLength(1);
    expect(problems).toEqual([{ where: 'electors:2', problem: 'invalid:full_name' }]);
    expect(JSON.stringify(problems)).not.toContain('Prueba');
  });

  it('notices the same person twice and a table that does not exist', () => {
    const file = writePadron({ units: [{ id: 'm-1', name: 'Mesa 1' }], electors: [person('a', { table: 'm-9' }), person('a')] });
    expect(readPadron(file).problems).toEqual([{ where: 'electors:1', problem: 'unknown_table' }, { where: 'electors:2', problem: 'same_person' }]);
  });

  it('loads the same person once when the name only changes case, marks or order; any other spelling is one more person', () => {
    const file = writePadron({ electors: [person('a', { full_name: 'Prueba, Ana' }), person('b'), person('a', { full_name: 'PRUEBA ANA' }), person('a', { full_name: 'Prueba, Ana B.' })] });
    const { padron, problems } = readPadron(file);
    expect(padron?.electors.map((elector) => [elector.id, elector.full_name, elector.review?.status])).toEqual([
      ['a', 'Prueba, Ana', 'pending'],
      ['b', 'Prueba, Persona b', undefined],
      ['a~2', 'Prueba, Ana B.', 'pending'],
    ]);
    expect(groupProblems(problems)).toEqual([
      { place: 'electors', problem: 'same_document_other_name', lines: [1, 4] },
      { place: 'electors', problem: 'same_person', lines: [3] },
    ]);
  });

  it('never takes two close names for one person: Juan and Juana with one document are two people', () => {
    const pairs = [['Prueba, Juan', 'Prueba, Juana'], ['Gómez, Mariano', 'Gómez, Mariana'], ['Fernández Ruiz, Ana Laura', 'Fernández Ruiz, Ana Paula']];
    for (const [one, other] of pairs) {
      const { padron } = readPadron(writePadron({ electors: [person('a', { full_name: one }), person('a', { full_name: other })] }));
      expect(padron?.electors.map((elector) => elector.review?.status)).toEqual(['pending', 'pending']);
    }
    // A name without letters or digits matches nobody.
    expect(readPadron(writePadron({ electors: [person('a', { full_name: '-' }), person('a', { full_name: '?' })] })).padron?.electors).toHaveLength(2);
  });

  it('reads many rows with one id in linear time', () => {
    const electors = Array.from({ length: 4000 }, (_, i) => person('a', { full_name: `Prueba, Persona ${i}` }));
    const started = performance.now();
    const { padron } = readPadron(writePadron({ electors }));
    expect(padron?.electors).toHaveLength(4000);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('keeps another name with the same id as one more person, both for review, with the same ids every time', () => {
    const file = writePadron({
      electors: [
        person('a', { full_name: 'Prueba, Ana', review: { status: 'ok', note: 'x' } }),
        person('b'),
        person('a', { full_name: 'Ejemplo, Luis' }),
        person('a', { full_name: 'Ejemplo Luis' }),
        person('a', { full_name: 'Muestra, Sol' }),
        // An id like the ones given to the others is never taken from the line that has it.
        person('a~3', { full_name: 'Prueba, Eva' }),
      ],
    });
    const first = readPadron(file);
    expect(first.padron?.electors.map((elector) => [elector.id, elector.full_name, elector.review?.status])).toEqual([
      ['a', 'Prueba, Ana', 'pending'],
      ['b', 'Prueba, Persona b', undefined],
      ['a~2', 'Ejemplo, Luis', 'pending'],
      ['a~4', 'Muestra, Sol', 'pending'],
      ['a~3', 'Prueba, Eva', undefined],
    ]);
    expect(first.padron?.electors[0]?.review).toEqual({ status: 'pending', note: 'x' });
    expect(groupProblems(first.problems)).toEqual([
      { place: 'electors', problem: 'same_document_other_name', lines: [1, 3, 5] },
      { place: 'electors', problem: 'same_person', lines: [4] },
    ]);
    expect(readPadron(file)).toEqual(first);
    // What it loads has no repeats left.
    expect(readPadron(writePadron({ electors: first.padron!.electors })).problems).toEqual([]);
  });

  it('cuts a long id so that it still fits with its number', () => {
    const long = 'x'.repeat(64);
    const { padron } = readPadron(writePadron({ electors: [person(long, { full_name: 'Prueba, Ana' }), person(long, { full_name: 'Ejemplo, Luis' })] }));
    expect(padron?.electors.map((elector) => elector.id)).toEqual([long, `${'x'.repeat(62)}~2`]);
    expect(readPadron(writePadron({ electors: padron!.electors })).problems).toEqual([]);
    // Never through the middle of a character.
    // A character outside the basic plane takes two units, like U+1D400 here.
    const wide = `${'x'.repeat(61)}\u{1D400}z`;
    const cut = readPadron(writePadron({ electors: [person(wide, { full_name: 'Prueba, Ana' }), person(wide, { full_name: 'Ejemplo, Luis' })] }));
    expect(cut.padron?.electors[1]?.id).toBe(`${'x'.repeat(61)}~2`);
  });

  it('says which field is too long, as the browser does with a spreadsheet', () => {
    const file = writePadron({ electors: [person('a', { address: 'x'.repeat(201) }), person('b')] });
    const { padron, problems } = readPadron(file);
    expect(padron?.electors).toHaveLength(1);
    expect(problems).toEqual([{ where: 'electors:1', problem: 'too_long:address' }]);
  });

  it('refuses before unpacking a file that would take too much, and a lying size cannot make it take more', () => {
    const file = writePadron({ electors: [person('a'), person('b')] });
    expect(readPadron(declareSize(file, 'electors.jsonl', MAX_UNZIPPED_BYTES + 1)).problems).toEqual([{ where: 'file', problem: 'too_big' }]);
    expect(readPadron(declareSize(file, 'manifest.json', 2 * 1024 * 1024)).problems).toEqual([{ where: 'file', problem: 'too_big' }]);
    // Ten megabytes that say they are ten bytes: what comes out is ten bytes at most, and it is not read as people.
    const bomb = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'padron-abierto', format_version: '0.1.0', files: { electors: { path: 'e.jsonl', count: 1 } } })), 'e.jsonl': new Uint8Array(10 * 1024 * 1024).fill(32) });
    const lying = readPadron(declareSize(bomb, 'e.jsonl', 10));
    expect(lying.padron?.electors ?? []).toEqual([]);
    expect(lying.problems.length).toBeGreaterThan(0);
  });

  it('ignores fields from a newer minor version', () => {
    const file = writePadron({ electors: [person('a', { futuro: 1 })] });
    expect(readPadron(file).problems).toEqual([]);
  });
});

describe('simple spreadsheets', () => {
  it('finds the columns by their name, with any common separator', () => {
    const { padron } = readCsvRoll('Apellido y nombre;DNI;Mesa;Domicilio\n"Núñez, Ana";30.123.456;3;Calle Falsa 123\nPeña, Luis;;4;\n');
    expect(padron?.electors[0]).toMatchObject({ id: 'd-30123456', full_name: 'Núñez, Ana', table: '3', address: 'Calle Falsa 123' });
    expect(padron?.electors[1]?.identifiers).toEqual([]);
    expect(padron?.electors[0]?.identifiers?.[0]).toEqual({ type: 'DNI', value: '30123456' });
  });

  it('joins separate family and given names', () => {
    const { padron } = readCsvRoll('apellido,nombres,legajo\nPrueba,Ana,A-1/2\n');
    expect(padron?.electors[0]?.full_name).toBe('Prueba, Ana');
  });

  it('says so when there is no name column', () => {
    expect(readCsvRoll('dni,mesa\n1,2\n').problems[0]?.problem).toBe('no_name_column');
  });

  it('finds the header below a title, and counts lines as the file has them', () => {
    const { padron, problems } = readCsvRoll('Padrón de prueba\n\nOrden;Apellido y nombre;DNI\n1;Prueba, Ana;99.000.010\n2;;99.000.011\n\n3;Prueba, Luis;\n');
    expect(padron?.electors.map((elector) => [elector.id, elector.full_name, elector.order])).toEqual([
      ['d-99000010', 'Prueba, Ana', 1],
      ['f-3', 'Prueba, Luis', 3],
    ]);
    expect(problems).toEqual([{ where: 'line 5', problem: 'no_name' }]);
  });

  it('keeps a person enrolled twice once, at the first row, and says which rows repeat them', () => {
    const { padron, problems } = readCsvRoll('nombre\tdni\tlegajo\tmesa\nPrueba, Ana\t99000020\tA-1/1\t2\nPRUEBA ANA\t99.000.020\tA-7/7\t5\nAna Prueba\t99000020\t\t7\n');
    expect(padron?.electors.map((elector) => [elector.id, elector.full_name, elector.table, elector.review?.status])).toEqual([['d-99000020', 'Prueba, Ana', '2', 'ok']]);
    expect(problems).toEqual([{ where: 'line 3', problem: 'same_person' }, { where: 'line 4', problem: 'same_person' }]);
  });

  it('keeps another name with the same document as one more person, both for review, with the same ids every time', () => {
    const csv = [
      'nombre;dni;legajo',
      'Prueba, Ana;99000030;A-1/1',
      'Ejemplo, Luis;99000030;A-2/2',
      'Muestra, Sol;99000030;',
      'Ejemplo Luis;99.000.030;A-2/9',
      'Prueba, Eva;99000040;A-3/3',
      ';;',
      // The legajo of the next row is the id of a row further down, so it gets its position.
      'Prueba, Juan;99000040;A-4/4',
      'Otro, Leo;;A-4/4',
      'Ejemplo, Sol;;A-4/4',
      'Prueba, Lía;990000400;A-5/5',
    ].join('\n');
    const first = readCsvRoll(csv);
    expect(first.padron?.electors.map((elector) => [elector.id, elector.full_name, elector.review?.status])).toEqual([
      ['d-99000030', 'Prueba, Ana', 'pending'],
      ['l-A-2/2', 'Ejemplo, Luis', 'pending'],
      ['f-3', 'Muestra, Sol', 'pending'],
      ['d-99000040', 'Prueba, Eva', 'pending'],
      ['f-6', 'Prueba, Juan', 'pending'],
      ['l-A-4/4', 'Otro, Leo', 'pending'],
      ['f-8', 'Ejemplo, Sol', 'pending'],
      ['l-A-5/5', 'Prueba, Lía', 'pending'],
    ]);
    expect(first.padron?.electors[1]?.identifiers).toEqual([{ type: 'DNI', value: '99000030' }, { type: 'legajo', value: 'A-2/2' }]);
    expect(groupProblems(first.problems)).toEqual([
      { place: 'line', problem: 'same_document_other_name', lines: [2, 3, 4, 6, 8, 9, 10] },
      { place: 'line', problem: 'same_person', lines: [5] },
      { place: 'line', problem: 'odd_document', lines: [11] },
    ]);
    expect(readCsvRoll(csv)).toEqual(first);
    expect(readPadron(writePadron({ electors: first.padron!.electors })).problems).toEqual([]);
  });

  it('says an empty file is empty', () => {
    expect(readCsvRoll('﻿\n \n').problems).toEqual([{ where: 'file', problem: 'empty' }]);
  });

  it('skips lines that are only separators, as Excel writes the empty rows of a sheet', () => {
    const { padron, problems } = readCsvRoll('nombre;dni;mesa\n"Prueba, Ana";99000001;1\n;;\n"Prueba, Luis";;2\n;\n ; ; \n');
    expect(problems).toEqual([]);
    expect(padron?.electors.map((elector) => [elector.id, elector.full_name])).toEqual([['d-99000001', 'Prueba, Ana'], ['f-2', 'Prueba, Luis']]);
  });

  it('without a DNI the id is the legajo, so a corrected roll keeps each person', () => {
    const before = readCsvRoll('Apellido y nombre;Legajo\nPrueba, Ana;A-1001/1\nPrueba, Luis;A-1002/2\nPrueba, Sol;\n');
    const after = readCsvRoll('Apellido y nombre;Legajo\nPrueba, Eva;A-1000/3\nPrueba, Ana;a-1001/1\nPrueba, Luis; A–1002/2 \nPrueba, Sol;\n');
    const ids = (read: typeof before) => Object.fromEntries(read.padron!.electors.map((elector) => [elector.full_name, elector.id]));
    expect(ids(before)).toEqual({ 'Prueba, Ana': 'l-A-1001/1', 'Prueba, Luis': 'l-A-1002/2', 'Prueba, Sol': 'f-3' });
    expect(ids(after)).toMatchObject({ 'Prueba, Ana': 'l-A-1001/1', 'Prueba, Luis': 'l-A-1002/2', 'Prueba, Eva': 'l-A-1000/3' });
    expect(after.padron?.electors[2]?.identifiers).toEqual([{ type: 'legajo', value: 'A-1002/2' }]);
  });

  it('writes a legajo the way the scanner does', () => {
    expect(fileNumberOf(' a-1234/5. ')).toBe('A-1234/5');
    expect(fileNumberOf('(A_1234/5)')).toBe('A-1234/5');
    expect(fileNumberOf('A:1234/5')).toBe('A-1234/5');
    expect(fileNumberOf('A — 1234/5')).toBe('A-1234/5');
    expect(fileNumberOf('s/l')).toBeUndefined();
    expect(fileNumberOf('')).toBeUndefined();
  });

  it('keeps a document of another length for review, without making it the id', () => {
    const { padron, problems } = readCsvRoll('nombre;dni;legajo\nPrueba, Ana;9900001;\nPrueba, Luis;20-99000011-3;A-1003/1\nPrueba, Eva;9900001200;\n');
    expect(padron?.electors.map((elector) => [elector.id, elector.review?.status])).toEqual([['d-9900001', 'ok'], ['l-A-1003/1', 'pending'], ['f-3', 'pending']]);
    expect(padron?.electors[1]?.identifiers).toEqual([{ type: 'DNI', value: '20990000113' }, { type: 'legajo', value: 'A-1003/1' }]);
    expect(problems).toEqual([{ where: 'line 3', problem: 'odd_document' }, { where: 'line 4', problem: 'odd_document' }]);
  });

  it('leaves out a row the server would refuse, and says which row and which field', () => {
    const { padron, problems } = readCsvRoll(`nombre;domicilio;mesa\nPrueba, Ana;${'x'.repeat(201)};1\nPrueba, Luis;Calle 1;${'9'.repeat(65)}\nPrueba, Sol;;2\n`);
    expect(padron?.electors.map((elector) => elector.full_name)).toEqual(['Prueba, Sol']);
    expect(problems).toEqual([{ where: 'line 2', problem: 'too_long:address' }, { where: 'line 3', problem: 'too_long:table' }]);
    expect(readPadron(writePadron({ electors: padron!.electors })).problems).toEqual([]);
  });

  it('finds the columns however the header writes them', () => {
    for (const order of ['N°', 'Nº', 'n.º', 'Nro.', 'NÚMERO DE ORDEN', 'Nº  de orden', 'Orden']) {
      const { padron } = readCsvRoll(`${order};NOMBRE;Nº de documento;Nro. de Legajo\n7;Prueba, Ana;99000001;A-1/1\n`);
      expect(padron?.electors[0]).toMatchObject({ order: 7, identifiers: [{ type: 'DNI', value: '99000001' }, { type: 'legajo', value: 'A-1/1' }] });
    }
  });
});

describe('the list of problems', () => {
  it('puts problems of one kind together, with their rows in order', () => {
    const groups = groupProblems([
      { where: 'line 3', problem: 'no_name' },
      { where: 'line 4', problem: 'same_person' },
      { where: 'line 9', problem: 'no_name' },
      { where: 'electors:2', problem: 'no_name' },
      { where: 'file', problem: 'too_big' },
      { where: 'line 12', problem: 'no_name' },
    ]);
    expect(groups).toEqual([
      { place: 'line', problem: 'no_name', lines: [3, 9, 12] },
      { place: 'line', problem: 'same_person', lines: [4] },
      { place: 'electors', problem: 'no_name', lines: [2] },
      { place: 'file', problem: 'too_big', lines: [] },
    ]);
  });
});

describe('permissions', () => {
  it('a poll watcher only works on a table', () => {
    expect(ROLES.fiscal).toEqual(['table.work']);
    expect(rolesCan(['fiscal'], 'semaphore.read')).toBe(false);
  });

  it('the technical administrator does not see political data through the role', () => {
    expect(rolesCan(['sistema'], 'semaphore.read')).toBe(false);
    expect(rolesCan(['sistema'], 'semaphore.sensitive')).toBe(false);
    expect(rolesCan(['sistema'], 'security.manage')).toBe(true);
  });

  it('statistics see numbers only', () => {
    expect(ROLES.estadistico).toEqual(['stats.read']);
  });

  it('sensitive categories need their own role', () => {
    expect(rolesCan(['semaforo', 'coordinacion'], 'semaphore.sensitive')).toBe(false);
    expect(rolesCan(['semaforo', 'semaforo_sensible'], 'semaphore.sensitive')).toBe(true);
  });

  it('picks what someone with several roles sees first', () => {
    expect(mainRole(['fiscal', 'jefe'])).toBe('jefe');
    expect(mainRole([])).toBeNull();
  });
});
