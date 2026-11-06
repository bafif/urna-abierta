import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrate } from '../src/app.ts';
import { DATABASE_HOOK_TIMEOUT, ownDatabases } from './databases.ts';

const url = process.env.TEST_DATABASE_URL;
const first = new URL('../src/migrations/0001-inicial.sql', import.meta.url);
const previous = new URL('./fixtures/schema-anterior.sql', import.meta.url);
/** The number of every migration this version has, in order. */
const all = (await readdir(new URL('../src/migrations/', import.meta.url))).filter((name) => name.endsWith('.sql')).map((name) => Number(name.slice(0, 4))).sort((a, b) => a - b);

/** Everything that makes up a schema, in an order that does not depend on how it was made. */
async function shape(pool: pg.Pool) {
  const columns = await pool.query(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' ORDER BY table_name, column_name`);
  const constraints = await pool.query(`SELECT conrelid::regclass::text AS on_table, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`);
  const indexes = await pool.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`);
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}

describe.skipIf(!url)('migrations, against a real Postgres', { timeout: 60_000 }, () => {
  // Databases of their own, made and dropped here, so that this runs next to the other server tests.
  let databases: ReturnType<typeof ownDatabases>;
  let folder: string;
  let fresh: ReturnType<typeof shape> | undefined;

  const database = () => databases.create();
  /** The shape of a database that only ever ran the migrations, made once. */
  const freshShape = () => (fresh ??= database().then(async (pool) => (await migrate(pool), shape(pool))));
  const versions = async (pool: pg.Pool) => (await pool.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map((row) => row.version);
  const migrations = async (files: Record<string, string>) => {
    const dir = await mkdtemp(join(folder, 'migraciones-'));
    for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
    return pathToFileURL(`${dir}/`);
  };

  beforeAll(async () => {
    databases = ownDatabases(url!, 'migra');
    folder = await mkdtemp(join(tmpdir(), 'urna-migraciones-'));
  });
  afterAll(async () => {
    await databases?.dropAll();
    await rm(folder, { recursive: true, force: true });
  }, DATABASE_HOOK_TIMEOUT);

  it('makes a new database, records what it ran, and the second time does nothing', async () => {
    const pool = await database();
    expect(await migrate(pool)).toEqual(all);
    expect(await versions(pool)).toEqual(all);
    expect(await migrate(pool)).toEqual([]);
    const tables = (await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`)).rows[0].n;
    expect(tables).toBeGreaterThan(15);
  });

  it('updates a database made by the current schema.sql before there were migrations, keeping its data', async () => {
    const pool = await database();
    // What the server used to do on every start: run the whole schema.
    await pool.query(await readFile(first, 'utf8'));
    await pool.query(`INSERT INTO settings (key, value) VALUES ('party', '{"name":"Agrupación Ejemplo"}')`);
    expect(await migrate(pool)).toEqual(all);
    expect(await shape(pool)).toEqual(await freshShape());
    expect((await pool.query(`SELECT value->>'name' AS name FROM settings WHERE key = 'party'`)).rows[0].name).toBe('Agrupación Ejemplo');
  });

  it('updates a database made by the previous schema.sql, from git, to the same schema as a new one', async () => {
    const pool = await database();
    await pool.query(await readFile(previous, 'utf8'));
    await pool.query(`INSERT INTO elections (id, name, kind) VALUES ('0190f3a0-0000-7000-8000-000000000001', 'Simulacro', 'estudiantil')`);
    expect(await shape(pool)).not.toEqual(await freshShape());
    expect(await migrate(pool)).toEqual(all);
    expect(await shape(pool)).toEqual(await freshShape());
    expect((await pool.query('SELECT name FROM elections')).rows).toEqual([{ name: 'Simulacro' }]);
  });

  it('brings people and marks of a database from before the random ids up to date, and erases the old erasures again', async () => {
    process.env.URNA_FIELD_KEY ??= 'clave de prueba';
    const pool = await database();
    // What the last server without migrations made, with one election under way and one purged.
    await pool.query(await readFile(first, 'utf8'));
    const open = '0190f3a0-0000-7000-8000-000000000002';
    const purged = '0190f3a0-0000-7000-8000-000000000003';
    await pool.query(`INSERT INTO elections (id, name, kind, status) VALUES ($1, 'Abierta', 'estudiantil', 'jornada'), ($2, 'Purgada', 'estudiantil', 'purgada')`, [open, purged]);
    await pool.query(`INSERT INTO polling_tables (id, election_id, name) VALUES ('mesa-a', $1, 'Mesa 1'), ('mesa-p', $2, 'Mesa 1')`, [open, purged]);
    await pool.query(
      `INSERT INTO electors (election_id, id, table_id, order_number, full_name, search, document) VALUES
         ($1, 'd-99550001', 'mesa-a', 1, 'Uno, Ana', 'uno ana 99550001', '99550001'),
         ($1, 'd-99550002', 'mesa-a', 2, 'Borrado a pedido', '', NULL),
         ($2, 'd-99550003', 'mesa-p', 1, '', '', NULL)`,
      [open, purged],
    );
    const mark = (id: string, seq: number, elector: string) =>
      pool.query(`INSERT INTO operations (id, table_id, seq, type, device, device_seq, device_time, payload) VALUES ($1, 'mesa-a', $2, 'voter.marked', 'tel', $2, now(), $3)`, [id, seq, { elector }]);
    await mark('0190f3a0-0000-7000-8000-0000000000a1', 1, 'd-99550001');
    await mark('0190f3a0-0000-7000-8000-0000000000a2', 2, 'd-99550002');

    expect(await migrate(pool)).toEqual(all);
    const people = (await pool.query('SELECT id, public_id, erased_at IS NOT NULL AS erased, election_id = $1 AS open FROM electors ORDER BY open DESC, erased', [open])).rows;
    expect(people.map((row) => row.public_id)).toEqual([expect.stringMatching(/^[\w-]{16}$/), expect.stringMatching(/^[\w-]{16}$/), expect.stringMatching(/^[\w-]{16}$/)]);
    expect(people.map((row) => [row.id.startsWith('x-'), row.erased])).toEqual([[false, false], [true, true], [true, false]]);
    // Each mark names its person by the random id, the erased one included, so it still counts once.
    const marks = (await pool.query(`SELECT payload->>'elector' AS elector FROM operations ORDER BY seq`)).rows.map((row) => row.elector);
    expect(marks).toEqual([people[0].public_id, people[1].public_id]);
    let dump = '';
    for (const name of ['electors', 'operations']) dump += (await pool.query(`SELECT coalesce(string_agg(row_to_json(t)::text, E'\\n'), '') AS rows FROM ${name} t`)).rows[0].rows;
    expect(dump).toContain('99550001');
    expect(dump).not.toContain('99550002');
    expect(dump).not.toContain('99550003');
    await expect(pool.query('TRUNCATE audit_log')).rejects.toThrow();
    expect(await migrate(pool)).toEqual([]);
  });

  it('runs each new file once, in the order of its number, and only the new ones', async () => {
    const pool = await database();
    const two = { '0002-color.sql': 'ALTER TABLE lugares ADD COLUMN color text;', '0001-lugares.sql': 'CREATE TABLE lugares (id int PRIMARY KEY);' };
    expect(await migrate(pool, await migrations(two))).toEqual([1, 2]);
    const three = await migrations({ ...two, '0003-datos.sql': `INSERT INTO lugares VALUES (1, 'rojo');` });
    expect(await migrate(pool, three)).toEqual([3]);
    expect(await migrate(pool, three)).toEqual([]);
    expect((await pool.query('SELECT color FROM lugares')).rows).toEqual([{ color: 'rojo' }]);
  });

  it('runs 0001 again when it changed while it is the last one the database ran, so that what was added to it arrives', async () => {
    const pool = await database();
    const before = { '0001-inicial.sql': 'CREATE TABLE IF NOT EXISTS uno (id int);' };
    expect(await migrate(pool, await migrations(before))).toEqual([1]);
    const added = await migrations({ '0001-inicial.sql': 'CREATE TABLE IF NOT EXISTS uno (id int);\nCREATE TABLE IF NOT EXISTS foo (id int);' });
    expect(await migrate(pool, added)).toEqual([1]);
    expect((await pool.query(`SELECT to_regclass('foo') AS found`)).rows[0].found).toBe('foo');
    expect(await migrate(pool, added)).toEqual([]);
    // A database migrated before the checksum was recorded runs it again too: it only creates what is missing.
    await pool.query('UPDATE schema_migrations SET checksum = NULL');
    expect(await migrate(pool, added)).toEqual([1]);
    expect(await versions(pool)).toEqual([1]);
  });

  it('once a later migration ran, a file that changed stops it and says which, and nothing runs', async () => {
    const pool = await database();
    const files = { '0001-a.sql': 'CREATE TABLE IF NOT EXISTS uno (id int);', '0002-b.sql': 'CREATE TABLE dos (id int);' };
    expect(await migrate(pool, await migrations(files))).toEqual([1, 2]);
    const third = { '0003-c.sql': 'CREATE TABLE tres (id int);' };
    await expect(migrate(pool, await migrations({ ...files, '0002-b.sql': 'CREATE TABLE dos (id int, otra text);', ...third }))).rejects.toThrow(/0002-b\.sql cambió/);
    await expect(migrate(pool, await migrations({ ...files, '0001-a.sql': 'CREATE TABLE IF NOT EXISTS foo (id int);', ...third }))).rejects.toThrow(/0001-a\.sql cambió/);
    expect(await versions(pool)).toEqual([1, 2]);
    expect((await pool.query(`SELECT to_regclass('foo') AS foo, to_regclass('tres') AS tres`)).rows[0]).toEqual({ foo: null, tres: null });
    // Recorded before there were checksums: taken as the file it has now, without running it again.
    await pool.query('UPDATE schema_migrations SET checksum = NULL');
    expect(await migrate(pool, await migrations({ ...files, ...third }))).toEqual([3]);
    expect((await pool.query('SELECT count(*)::int AS n FROM schema_migrations WHERE checksum IS NULL')).rows[0].n).toBe(0);
  });

  it('leaves the database as it was when a file fails halfway, and says which one', async () => {
    const pool = await database();
    const broken = await migrations({ '0001-lugares.sql': 'CREATE TABLE lugares (id int);', '0002-mal.sql': 'CREATE TABLE otra (id int); SELECT no_existe FROM lugares;' });
    await expect(migrate(pool, broken)).rejects.toThrow(/0002-mal\.sql.*quedó como estaba/);
    expect(await versions(pool)).toEqual([1]);
    expect((await pool.query(`SELECT to_regclass('otra') AS found`)).rows[0].found).toBeNull();
  });

  it('refuses a database from a newer version, and files it cannot order', async () => {
    const pool = await database();
    await migrate(pool, await migrations({ '0001-a.sql': 'SELECT 1;', '0002-b.sql': 'SELECT 1;' }));
    await expect(migrate(pool, await migrations({ '0001-a.sql': 'SELECT 1;' }))).rejects.toThrow(/más nueva.*migración 2/);
    await expect(migrate(pool, await migrations({ 'cambios.sql': 'SELECT 1;' }))).rejects.toThrow(/nombre/);
    await expect(migrate(pool, await migrations({ '0003-a.sql': 'SELECT 1;', '0003-b.sql': 'SELECT 1;' }))).rejects.toThrow(/dos migraciones con el número 3/);
  });

  it('two servers starting at once do not run the same file twice', async () => {
    const pool = await database();
    const results = await Promise.all([migrate(pool), migrate(pool), migrate(pool)]);
    expect(results.flat()).toEqual(all);
    expect(await versions(pool)).toEqual(all);
  });
});
