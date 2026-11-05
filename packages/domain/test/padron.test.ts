import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { mainRole, readCsvRoll, readPadron, ROLES, rolesCan, writePadron } from '../src/index.ts';

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

  it('notices a repeated person, a table that does not exist and a wrong count', () => {
    const file = writePadron({ units: [{ id: 'm-1', name: 'Mesa 1' }], electors: [person('a', { table: 'm-9' }), person('a')] });
    const kinds = readPadron(file).problems.map((p) => p.problem);
    expect(kinds).toEqual(expect.arrayContaining(['repeated_id', 'unknown_table']));
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
