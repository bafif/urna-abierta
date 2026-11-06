import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { writePadron } from '@urna-abierta/domain';
import { buildApp, migrate, seedDemo } from '../src/app.ts';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('loading a roll, against a real Postgres', () => {
  // A database of its own, so that it can run next to the other server tests, which empty theirs.
  const name = `urna_padron_${process.pid}_${Date.now()}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let token: string;

  const upload = (election: string, body: Uint8Array, type: string, preview = false) =>
    app.inject({ method: 'POST', url: `/api/elections/${election}/roll${preview ? '?preview=1' : ''}`, payload: Buffer.from(body), headers: { authorization: `Bearer ${token}`, 'content-type': type } });
  const newElection = async () =>
    (await app.inject({ method: 'POST', url: '/api/elections', payload: { name: 'Prueba', kind: 'estudiantil', days: ['2027-04-06'] }, headers: { authorization: `Bearer ${token}` } })).json().id as string;
  const names = async (election: string) =>
    (await pool.query('SELECT id, full_name FROM electors WHERE election_id = $1 ORDER BY id', [election])).rows.map((row) => [row.id, row.full_name]);

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    const own = new URL(url!);
    own.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: own.toString(), max: 4 });
    await migrate(pool);
    process.env.URNA_FIELD_KEY = 'clave de prueba';
    app = buildApp(pool);
    await app.ready();
    const demo = await seedDemo(pool, { size: 5, tables: 1 });
    token = (await app.inject({ method: 'POST', url: '/api/auth/redeem', payload: { token: demo.links.coordinacion } })).json().token;
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it('a .padron that repeats an id previews and loads the first row, and the load does not fail', async () => {
    const election = await newElection();
    const file = writePadron({
      electors: [
        { id: 'd-99000001', full_name: 'Prueba, Ana' },
        { id: 'd-99000002', full_name: 'Prueba, Luis' },
        { id: 'd-99000001', full_name: 'Prueba, Otra' },
      ],
    });
    const preview = await upload(election, file, 'application/zip', true);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ people: 2, added: 2, problems: [{ where: 'electors:3', problem: 'repeated_id' }] });
    const load = await upload(election, file, 'application/zip');
    expect(load.statusCode).toBe(200);
    expect(await names(election)).toEqual([['d-99000001', 'Prueba, Ana'], ['d-99000002', 'Prueba, Luis']]);
  });

  it('a CSV saved in Windows-1252 keeps its accents, and one in UTF-8 too', async () => {
    const election = await newElection();
    const windows = Buffer.from('Apellido y nombre;DNI\nPrueba Núñez, María José;99000003\n', 'latin1');
    expect((await upload(election, windows, 'text/csv')).statusCode).toBe(200);
    expect(await names(election)).toEqual([['d-99000003', 'Prueba Núñez, María José']]);
    const utf8 = new TextEncoder().encode('Apellido y nombre;DNI\nPrueba Núñez, María José;99000003\nPrueba Peña, Ñandú;99000004\n');
    expect((await upload(election, utf8, 'text/csv')).statusCode).toBe(200);
    expect(await names(election)).toEqual([['d-99000003', 'Prueba Núñez, María José'], ['d-99000004', 'Prueba Peña, Ñandú']]);
  });
});
