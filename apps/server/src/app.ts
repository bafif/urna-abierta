import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { DEFAULT_TIME_ZONE, fakeRoll } from '@urna-abierta/domain';
import { setSetting } from './actor.ts';
import { photoStoreFromEnv, type PhotoStore } from './photo-store.ts';
import { adminRoutes } from './routes-admin.ts';
import { authRoutes, createInvitation } from './routes-auth.ts';
import { syncRoutes } from './routes-sync.ts';
import { eraseIn, workRoutes } from './routes-work.ts';

const MIGRATIONS = new URL('./migrations/', import.meta.url);
/** Any number, the same for every server: it only has to keep two of them from migrating at once. */
const MIGRATION_LOCK = 7_310_201;

/**
 * Erasures from before the roll id went too still have it, often the DNI: they are erased again, the way it is done now.
 * That takes the field key, which the server always has by the time it migrates.
 */
async function eraseOldErasures(client: pg.PoolClient): Promise<void> {
  const old = await client.query(
    `SELECT x.election_id, x.id FROM electors x JOIN elections e ON e.id = x.election_id
     WHERE x.erased_at IS NULL AND x.full_name = 'Borrado a pedido' AND x.search = '' AND x.document IS NULL AND e.status <> 'purgada'`,
  );
  for (const row of old.rows) await eraseIn(client, row.election_id, row.id);
}

/**
 * What a migration needs that SQL cannot do, such as the field key. It runs right after its file, in the same
 * transaction: it is done exactly once too, and if it fails, so does the file.
 */
const STEPS: Record<string, (client: pg.PoolClient) => Promise<void>> = {
  '0004-datos-personales.sql': eraseOldErasures,
};

/**
 * Brings the database up to date. Each file `NNNN-name.sql` in migrations/ runs once, in the order of its
 * number, inside a transaction, and is recorded in schema_migrations with its SHA-256. A change to the schema
 * is a new file with the next number: a file that a published version already ran is never edited, because
 * servers that ran it would not run it again. 0001 only creates what is missing, so it also takes a database
 * made before there were migrations, and it runs again when it changed while it is the last one the database
 * ran. Any other file that changed after it ran stops the server, saying which. Returns the numbers it applied.
 */
export async function migrate(pool: pg.Pool, folder: URL = MIGRATIONS, steps = STEPS): Promise<number[]> {
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
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), checksum text)');
    // Databases migrated before the checksum was recorded.
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    const done = new Map<number, string | null>((await client.query('SELECT version, checksum FROM schema_migrations')).rows.map((row) => [row.version, row.checksum]));
    const known = new Set(migrations.map((item) => item.version));
    const unknown = [...done.keys()].filter((version) => !known.has(version)).sort((a, b) => a - b);
    if (unknown.length) {
      throw new Error(`La base viene de una versión más nueva de Urna Abierta (tiene la migración ${unknown.at(-1)}, que este servidor no conoce). Volvé a esa versión, o restaurá una copia de antes de actualizar.`);
    }
    const latest = Math.max(0, ...done.keys());
    const applied: number[] = [];
    for (const { version, name } of migrations) {
      const sql = await readFile(new URL(name, folder), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (done.has(version)) {
        const recorded = done.get(version);
        if (recorded === checksum) continue;
        const again = version === 1 && latest === 1;
        if (!again && recorded === null) {
          // Ran before checksums were recorded: what it ran is not known, so it is taken as this file.
          await client.query('UPDATE schema_migrations SET checksum = $2 WHERE version = $1', [version, checksum]);
          continue;
        }
        if (!again) {
          throw new Error(`La migración ${name} cambió después de que esta base la aplicó, y no se vuelve a correr. Devolvela a como estaba y poné el cambio en una migración nueva, con el número siguiente al último.`);
        }
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await steps[name]?.(client);
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)
            ON CONFLICT (version) DO UPDATE SET name = excluded.name, checksum = excluded.checksum, applied_at = now()`,
          [version, name, checksum],
        );
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
  // From yesterday, so that today is a voting day whatever the time zone of the phone. Today where the election is.
  const offsets = startsInDays === undefined ? [-1, 0, 1, 2] : [startsInDays];
  await pool.query(`INSERT INTO elections (id, name, kind, days, status, categories) VALUES ($1, $2, 'estudiantil', (SELECT array_agg((now() AT TIME ZONE $5)::date + o) FROM unnest($4::int[]) AS o), 'jornada', $3)`, [
    election,
    `Elección de prueba ${label}`,
    JSON.stringify([{ id: 'cat-1', name: 'Consejo Directivo', lists: [{ id: 'l1', name: 'Lista Azul' }, { id: 'l2', name: 'Lista Verde' }, { id: 'blanco', name: 'En blanco' }, { id: 'nulo', name: 'Nulos' }] }]),
    offsets,
    DEFAULT_TIME_ZONE,
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
  const links: Record<string, string> = { jefe: await createInvitation(pool, chief, null) };
  const chiefs: { invitation: string; tables: string[] }[] = [];
  let currentUnit = unit;
  const fiscales: { table: string; invitations: string[] }[] = [];
  const roll = fakeRoll(size, 1);
  for (let t = 0; t < tables; t += 1) {
    const table = randomUUID();
    if (tablesPerChief && t % tablesPerChief === 0) {
      currentUnit = randomUUID();
      await pool.query('INSERT INTO units (id, election_id, name) VALUES ($1, $2, $3)', [currentUnit, election, `Distrito ${t}`]);
      chiefs.push({ invitation: await createInvitation(pool, await person(`Jefe ${t}`, '', 'jefe', { unit: currentUnit }), null), tables: [] });
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
      two.push(await createInvitation(pool, fiscal, null));
      if (name === 'Laura') two.push(await createInvitation(pool, fiscal, null));
    }
    fiscales.push({ table, invitations: two });
  }
  links.semaforo = await createInvitation(pool, await person('Juli', '', 'semaforo'), null);
  links.estadistico = await createInvitation(pool, await person('Ana', '', 'estadistico'), null);
  links.coordinacion = await createInvitation(pool, await person('Coordinación', '+54 9 341 222-2222', 'coordinacion'), null);
  await setSetting(pool, 'party', { name: 'Agrupación Ejemplo', theme: 'aula' });
  return { election, links, tables: fiscales, chiefs };
}

/** Postgres codes for a value it cannot read or that points nowhere: a wrong request, not a broken server. */
const UNREADABLE = ['22P02', '22007', '22008', '22021', '22001', '23503'];

/** What a request may bring, unless its route says otherwise: the roll, photos and themes do. */
const BODY_LIMIT = 256 * 1024;

export function buildApp(pool: pg.Pool, { testMode = false, photos = photoStoreFromEnv() }: { testMode?: boolean; photos?: PhotoStore } = {}): FastifyInstance {
  // Caddy is the only way in, and it says which address each request came from.
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT, trustProxy: true });
  // A route with no limit of its own takes the one of the parser that reads its body: a zip or a photo sent to any
  // route, even one that needs no account, would be read up to the size of a roll. Each route keeps the small one
  // unless it says otherwise.
  app.addHook('onRoute', (route) => {
    route.bodyLimit ??= BODY_LIMIT;
  });
  // What Postgres cannot read, such as an id with the wrong shape or a day that does not exist, is a wrong request,
  // and says so: it is not a broken server.
  app.setErrorHandler((error, _request, reply) => {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && UNREADABLE.includes(code)) return reply.code(400).send({ error: 'invalid_request' });
    return reply.send(error);
  });

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
