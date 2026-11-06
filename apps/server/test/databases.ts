import pg from 'pg';

/** Long enough for several drops: each one makes Postgres write a checkpoint, which takes seconds on a slow disk. */
export const DATABASE_HOOK_TIMEOUT = 120_000;
/** What a run older than this left behind, after it failed, is dropped by the next one. */
const LEFTOVER_MS = 60 * 60 * 1000;

/**
 * Databases of a test file's own, next to the one in TEST_DATABASE_URL, so that the server test files can run side by
 * side. `dropAll` drops them all at once, and only after their connections are really closed: a pool says it ended
 * before Postgres lets go of them, and a drop that cuts a connection makes its client fail outside any test.
 */
export function ownDatabases(url: string, label: string) {
  const admin = new pg.Pool({ connectionString: url, max: 4 });
  const made: { name: string; pool: pg.Pool; clients: Set<pg.PoolClient> }[] = [];
  let swept: Promise<void> | undefined;

  const connections = async (name: string) =>
    (await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1', [name])).rows[0].n as number;

  async function drop(name: string): Promise<void> {
    for (let wait = 0; wait < 100 && (await connections(name)) > 0; wait += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    // FORCE only matters for what is still there after ten seconds: by then its clients ignore being cut.
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }

  /** What failed runs left behind: an hour old, and with nobody connected. */
  async function sweep(): Promise<void> {
    const { rows } = await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE $1`, [`urna\\_${label}\\_%`]);
    const old = rows
      .map((row) => row.datname as string)
      .filter((name) => [...name.matchAll(/(?<=_)\d{13}(?=_|$)/g)].some((stamp) => Date.now() - Number(stamp[0]) > LEFTOVER_MS));
    for (const name of old) if ((await connections(name)) === 0) await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
  }

  return {
    async create(max = 3): Promise<pg.Pool> {
      swept ??= sweep();
      await swept;
      const name = `urna_${label}_${Date.now()}_${process.pid}_${made.length}`;
      await admin.query(`CREATE DATABASE ${name}`);
      const own = new URL(url);
      own.pathname = `/${name}`;
      const pool = new pg.Pool({ connectionString: own.toString(), max });
      const clients = new Set<pg.PoolClient>();
      pool.on('connect', (client) => clients.add(client));
      made.push({ name, pool, clients });
      return pool;
    },
    async dropAll(): Promise<void> {
      await Promise.all(
        made.splice(0).map(async ({ name, pool, clients }) => {
          // From here on, a connection that Postgres cuts is expected.
          pool.on('error', () => undefined);
          for (const client of clients) client.on('error', () => undefined);
          await pool.end();
          await drop(name);
        }),
      );
      await admin.end();
    },
  };
}
