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

  it('notices a repeated id and a table that does not exist', () => {
    const file = writePadron({ units: [{ id: 'm-1', name: 'Mesa 1' }], electors: [person('a', { table: 'm-9' }), person('a')] });
    const kinds = readPadron(file).problems.map((p) => p.problem);
    expect(kinds).toEqual(expect.arrayContaining(['repeated_id', 'unknown_table']));
  });

  it('keeps the first of two rows with one id, so that what it shows is what gets loaded', () => {
    const file = writePadron({ electors: [person('a'), person('b'), { ...person('a'), full_name: 'Prueba, Otra' }] });
    const { padron, problems } = readPadron(file);
    expect(padron?.electors.map((elector) => [elector.id, elector.full_name])).toEqual([['a', 'Prueba, Persona a'], ['b', 'Prueba, Persona b']]);
    // The count still matches: the file has three rows, and the third one is pointed out.
    expect(problems).toEqual([{ where: 'electors:3', problem: 'repeated_id' }]);
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

  it('keeps one person per document, and says which line repeats it', () => {
    const { padron, problems } = readCsvRoll('nombre\tdni\nPrueba, Ana\t99000020\nPrueba, Ana B.\t99.000.020\n');
    expect(padron?.electors.map((elector) => elector.full_name)).toEqual(['Prueba, Ana']);
    expect(problems).toEqual([{ where: 'line 3', problem: 'repeated_id' }]);
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
      { where: 'line 4', problem: 'repeated_id' },
      { where: 'line 9', problem: 'no_name' },
      { where: 'electors:2', problem: 'no_name' },
      { where: 'file', problem: 'too_big' },
      { where: 'line 12', problem: 'no_name' },
    ]);
    expect(groups).toEqual([
      { place: 'line', problem: 'no_name', lines: [3, 9, 12] },
      { place: 'line', problem: 'repeated_id', lines: [4] },
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
