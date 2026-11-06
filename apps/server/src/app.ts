import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { fakeRoll } from '@urna-abierta/domain';
import { setSetting } from './actor.ts';
import { photoStoreFromEnv, type PhotoStore } from './photo-store.ts';
import { adminRoutes } from './routes-admin.ts';
import { authRoutes, createInvitation } from './routes-auth.ts';
import { syncRoutes } from './routes-sync.ts';
import { workRoutes } from './routes-work.ts';

const MIGRATIONS = new URL('./migrations/', import.meta.url);
/** Any number, the same for every server: it only has to keep two of them from migrating at once. */
const MIGRATION_LOCK = 7_310_201;

/**
 * Brings the database up to date. Each file `NNNN-name.sql` in migrations/ runs once, in the order of its
 * number, inside a transaction, and is recorded in schema_migrations. A change to the schema is a new file
 * with the next number: a file that a published version already ran is never edited, because servers that
 * ran it would not run it again. 0001 only creates what is missing, so it also takes a database made before
 * there were migrations. Returns the numbers it applied.
 */
export async function migrate(pool: pg.Pool, folder: URL = MIGRATIONS): Promise<number[]> {
  const migrations = (await readdir(folder))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const match = /^(\d{4})-[\w-]+\.sql$/.exec(name);
      if (!match) throw new Error(`La migración ${name} no tiene un nombre como 0002-que-cambia.sql.`);
      return { version: Number(match[1]), name };
    })
    .sort((a, b) => a.version - b.version);
  const repeated = migrations.find((item, index) => index > 0 && item.version === migrations[index - 1]!.version);
  if (repeated) throw new Error(`Hay dos migraciones con el número ${repeated.version}.`);

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set<number>((await client.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version));
    const known = new Set(migrations.map((item) => item.version));
    const unknown = [...done].filter((version) => !known.has(version)).sort((a, b) => a - b);
    if (unknown.length) {
      throw new Error(`La base viene de una versión más nueva de Urna Abierta (tiene la migración ${unknown.at(-1)}, que este servidor no conoce). Volvé a esa versión, o restaurá una copia de antes de actualizar.`);
    }
    const applied: number[] = [];
    for (const { version, name } of migrations) {
      if (done.has(version)) continue;
      const sql = await readFile(new URL(name, folder), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`No se pudo aplicar la migración ${name}, y la base quedó como estaba: ${(error as Error).message}`);
      }
      applied.push(version);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

/** An election with invented people and one person per role, for tests and for trying the app. */
export async function seedDemo(pool: pg.Pool, { size = 350, tables = 1, label = 'Demo', startsInDays, tablesPerChief, fresh = false }: { size?: number; tables?: number; label?: string; startsInDays?: number; tablesPerChief?: number; fresh?: boolean } = {}) {
  if (fresh) await pool.query('TRUNCATE settings, users, elections, invitations, devices, role_assignments CASCADE');
  const election = randomUUID();
  // From yesterday, so that today is a voting day whatever the time zone of the phone.
  const offsets = startsInDays === undefined ? [-1, 0, 1, 2] : [startsInDays];
  await pool.query(`INSERT INTO elections (id, name, kind, days, status, categories) VALUES ($1, $2, 'estudiantil', (SELECT array_agg(current_date + o) FROM unnest($4::int[]) AS o), 'jornada', $3)`, [
    election,
    `Elección de prueba ${label}`,
    JSON.stringify([{ id: 'cat-1', name: 'Consejo Directivo', lists: [{ id: 'l1', name: 'Lista Azul' }, { id: 'l2', name: 'Lista Verde' }, { id: 'blanco', name: 'En blanco' }, { id: 'nulo', name: 'Nulos' }] }]),
    offsets,
  ]);
  const unit = randomUUID();
  await pool.query('INSERT INTO units (id, election_id, name) VALUES ($1, $2, $3)', [unit, election, 'Distrito de prueba']);
  const person = async (name: string, phone: string, role: string, assignment: { table?: string; unit?: string } = {}) => {
    const id = randomUUID();
    await pool.query('INSERT INTO users (id, name, phone) VALUES ($1, $2, $3)', [id, name, phone]);
    await pool.query('INSERT INTO role_assignments (id, user_id, role, table_id, unit_id) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), id, role, assignment.table ?? null, assignment.unit ?? null]);
    return id;
  };
  const chief = await person('Rubén', '+54 9 341 000-0000', 'jefe', { unit });
  const links: Record<string, string> = { jefe: await createInvitation(pool, chief) };
  const chiefs: { invitation: string; tables: string[] }[] = [];
  let currentUnit = unit;
  const fiscales: { table: string; invitations: string[] }[] = [];
  const roll = fakeRoll(size, 1);
  for (let t = 0; t < tables; t += 1) {
    const table = randomUUID();
    if (tablesPerChief && t % tablesPerChief === 0) {
      currentUnit = randomUUID();
      await pool.query('INSERT INTO units (id, election_id, name) VALUES ($1, $2, $3)', [currentUnit, election, `Distrito ${t}`]);
      chiefs.push({ invitation: await createInvitation(pool, await person(`Jefe ${t}`, '', 'jefe', { unit: currentUnit })), tables: [] });
    }
    chiefs.at(-1)?.tables.push(table);
    await pool.query('INSERT INTO polling_tables (id, election_id, unit_id, name, place, position) VALUES ($1, $2, $3, $4, $5, $6)', [table, election, currentUnit, `Mesa ${t + 12}`, 'Escuela Normal 1', t]);
    await pool.query(
      `INSERT INTO electors (election_id, id, table_id, order_number, full_name, search, document)
       SELECT $1, $2 || '-' || id, $2, ord, name, search || ' 99' || lpad(ord::text, 6, '0'), '99' || lpad(ord::text, 6, '0') FROM unnest($3::text[], $4::int[], $5::text[], $6::text[]) AS t (id, ord, name, search)`,
      [election, table, roll.map((r) => r.id), roll.map((r) => r.order), roll.map((r) => r.name), roll.map((r) => r.search)],
    );
    const two = [];
    for (const name of t === 0 ? ['Marta', 'Laura'] : [`Fiscal ${t}`]) {
      const fiscal = await person(name, '+54 9 341 111-1111', 'fiscal', { table });
      two.push(await createInvitation(pool, fiscal));
      if (name === 'Laura') two.push(await createInvitation(pool, fiscal));
    }
    fiscales.push({ table, invitations: two });
  }
  links.semaforo = await createInvitation(pool, await person('Juli', '', 'semaforo'));
  links.estadistico = await createInvitation(pool, await person('Ana', '', 'estadistico'));
  links.coordinacion = await createInvitation(pool, await person('Coordinación', '+54 9 341 222-2222', 'coordinacion'));
  await setSetting(pool, 'party', { name: 'Agrupación Ejemplo', theme: 'aula' });
  return { election, links, tables: fiscales, chiefs };
}

export function buildApp(pool: pg.Pool, { testMode = false, photos = photoStoreFromEnv() }: { testMode?: boolean; photos?: PhotoStore } = {}): FastifyInstance {
  // Caddy is the only way in, and it says which address each request came from.
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, trustProxy: true });

  // Where the photos go, and whether that answers: «urna estado» reads it. Never the bucket or its keys.
  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true, photos: photos.status() };
  });

  authRoutes(app, pool);
  syncRoutes(app, pool, photos);
  adminRoutes(app, pool);
  workRoutes(app, pool);

  if (testMode) {
    app.post<{ Body: { size?: number; tables?: number; label?: string; startsInDays?: number; tablesPerChief?: number; fresh?: boolean } }>('/api/test/seed', async (request) => seedDemo(pool, request.body ?? {}));
  }
  return app;
}
