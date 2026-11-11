import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { foldText } from '@urna-abierta/domain';
import { audit, auditView, authenticated, can, canReachTable, erasedId, getSetting, requires, rollKey, seal, tablesInScope, unseal, type Actor } from './actor.ts';
import { clock } from './clock.ts';
import { correctElector } from './routes-admin.ts';
import { forgetStatuses } from './routes-sync.ts';

const SUMMARY_CACHE_MS = 10_000;
const SMALLEST_GROUP = 5;
/** What a person reviews when it arrives after the close. A late alert already reaches the chief, marked as late. */
const LATE_TYPES = ['envelopes.counted', 'tally.submitted', 'tally.photo'];
/** What only looked at something, besides every «…viewed». Everything else changed something. */
const SEEN_ACTIONS = ['roll.downloaded', 'roll.review_opened', 'person.exported', 'person.searched', 'results.downloaded', 'semaphore.searched', 'semaphore.sensitive_viewed', 'backup.downloaded'];
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Far more than any traffic light needs, and what bounds reordering them. */
const MAX_CATEGORIES = 100;

/** When and how a consent was given or taken back: a day that exists and is not to come, and a few words. */
function consentOf(body: { date?: unknown; means?: unknown } | undefined): { date: string; means: string } | null {
  const { date, means } = body ?? {};
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  // A day ahead at most, for whoever is already in tomorrow somewhere else.
  if (new Date(`${date}T00:00:00Z`).getTime() > clock.now().getTime() + 36 * 3_600_000) return null;
  if (typeof means !== 'string' || !means.trim() || means.length > 200 || /[\u0000-\u001f\u007f]/.test(means)) return null;
  return { date, means: means.trim() };
}

type Results = Record<string, number>;

/**
 * What each table counts for in each category, keyed `table:category`: the version the chief chose, or the only one
 * there is. With two versions and no choice, or a correction after it, it is 'undecided': nothing picks one by itself.
 */
async function tallyOutcomes(pool: pg.Pool, scope: string[]): Promise<Map<string, { results: Results } | 'undecided'>> {
  const [tallies, decided] = await Promise.all([
    pool.query(`SELECT table_id, payload, received_at FROM operations WHERE table_id = ANY($1) AND type = 'tally.submitted' AND NOT quarantined ORDER BY seq`, [scope]),
    pool.query(`SELECT d.table_id, d.category, d.decided_at, o.payload->'results' AS results FROM tally_decisions d JOIN operations o ON o.id = d.operation_id WHERE d.table_id = ANY($1)`, [scope]),
  ]);
  const versions = new Map<string, { received_at: Date; payload: { category: string; results: Results } }[]>();
  for (const row of tallies.rows) {
    const key = `${row.table_id}:${row.payload.category}`;
    versions.set(key, [...(versions.get(key) ?? []), row]);
  }
  const decisionOf = new Map(decided.rows.map((row) => [`${row.table_id}:${row.category}`, row]));
  const outcome = new Map<string, { results: Results } | 'undecided'>();
  for (const [key, found] of versions) {
    const decision = decisionOf.get(key);
    if (decision && !correctedSince(decision, found)) outcome.set(key, { results: decision.results });
    else if (new Set(found.map((version) => JSON.stringify(version.payload.results))).size === 1) outcome.set(key, { results: found[0]!.payload.results });
    else outcome.set(key, 'undecided');
  }
  return outcome;
}

/** Who voted, counted in one query: a mark stands unless an undo names it. */
async function votesPerTable(pool: pg.Pool, tables: string[]): Promise<Map<string, number>> {
  const rows = await pool.query(
    `WITH cancelled AS (
       SELECT jsonb_array_elements_text(payload->'cancels')::uuid AS id FROM operations
       WHERE table_id = ANY($1) AND type = 'voter.unmarked' AND NOT quarantined
     )
     SELECT table_id, count(DISTINCT payload->>'elector')::int AS voted FROM operations
     WHERE table_id = ANY($1) AND type = 'voter.marked' AND NOT quarantined AND id NOT IN (SELECT id FROM cancelled)
     GROUP BY table_id`,
    [tables],
  );
  return new Map(rows.rows.map((row) => [row.table_id, row.voted]));
}

/** The rows a phone's push locks, all of an election and always in the same order, so that two of these never wait on each other. */
export async function lockTables(client: pg.PoolClient, election: string): Promise<void> {
  await client.query('SELECT id FROM polling_tables WHERE election_id = $1 ORDER BY id FOR UPDATE', [election]);
}

/**
 * Erases a person: name, contact, roll id and reference go. The new reference keeps what the audit log said about
 * them, a sensitive mark included, from leading back to their table and order. The random id phones know them by
 * stays, so that a mark sent meanwhile still counts once. Null when there is no such person, 'already' when they
 * were erased before. Inside a transaction the caller opened: the route's, or a migration's.
 */
export async function eraseIn(client: pg.PoolClient, election: string, id: string): Promise<{ ref: string } | 'already' | null> {
  // A mark a phone sends meanwhile is either stored before, under the random id, or after, and named by it on the way in.
  await lockTables(client, election);
  const found = await client.query('SELECT ref, search, corrected_at IS NOT NULL AS corrected, erased_at IS NOT NULL AS erased FROM electors WHERE election_id = $1 AND id = $2', [election, id]);
  const row = found.rows[0];
  if (!row || row.erased) return row ? 'already' : null;
  const renamed = erasedId(id);
  await client.query('DELETE FROM semaphore_marks WHERE election_id = $1 AND elector_id = $2', [election, id]);
  await client.query(
    `UPDATE electors SET id = $3, ref = gen_random_uuid(), erased_at = now(), full_name = 'Borrado a pedido', search = '', document = NULL, file_number = NULL, address = NULL,
       extra = '{}', needs_review = false, review = NULL, consent = NULL, source_key = COALESCE(source_key, $4)
     WHERE election_id = $1 AND id = $2`,
    // What the file said about them stays, keyed: the same file loaded again knows them even if their id was a position.
    [election, id, renamed, row.corrected || !row.search ? null : rollKey(row.search)],
  );
  // Marks name people by their random id. One stored under the roll id, from a phone that named someone of another table, goes too.
  await client.query(
    `UPDATE operations SET payload = jsonb_set(payload, '{elector}', to_jsonb($3::text))
     WHERE table_id IN (SELECT id FROM polling_tables WHERE election_id = $1) AND payload->>'elector' = $2`,
    [election, id, renamed],
  );
  // The old reference: what the log already said about them, and nothing that points at the row.
  return { ref: row.ref };
}

export async function eraseElector(pool: pg.Pool, election: string, id: string): Promise<{ ref: string } | 'already' | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const erased = await eraseIn(client, election, id);
    await client.query(erased !== null && erased !== 'already' ? 'COMMIT' : 'ROLLBACK');
    return erased;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function workRoutes(app: FastifyInstance, pool: pg.Pool) {
  const watch = requires(pool, 'district.watch');
  const cache = new Map<string, { at: number; value: unknown }>();

  app.get('/api/district/elections', { preHandler: watch }, async () => {
    const rows = await pool.query(`SELECT id, name, status, days, categories, hours, time_zone FROM elections WHERE status NOT IN ('purgada') ORDER BY created_at DESC`);
    // The categories say when a table has tallied everything.
    return { elections: rows.rows.map((row) => ({ ...row, days: row.days.map((day: Date) => day.toISOString().slice(0, 10)), categories: row.categories.map((category: { id: string; name: string }) => ({ id: category.id, name: category.name })) })) };
  });

  /** Not a dashboard: what needs someone now comes first, and the rest fits in one line. */
  app.get<{ Params: { id: string } }>('/api/district/:id', { preHandler: watch }, async (request) => {
    const scope = await tablesInScope(pool, request.actor, request.params.id);
    await auditView(pool, request.actor, 'district.viewed', request.params.id);
    const key = `${request.actor.userId}:${request.params.id}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < SUMMARY_CACHE_MS) return cached.value;
    const [tables, sizes, votes, incidents, counts] = await Promise.all([
      pool.query(
        `SELECT t.id, t.name, t.place, t.last_seq,
                t.last_contact AS last_sync,
                (SELECT json_build_object('name', u.name, 'phone', u.phone) FROM role_assignments a JOIN users u ON u.id = a.user_id
                 WHERE a.table_id = t.id AND a.role = 'fiscal' ORDER BY (a.days IS NULL OR ($2::timestamptz AT TIME ZONE e.time_zone)::date = ANY(a.days)) DESC LIMIT 1) AS fiscal
         FROM polling_tables t JOIN elections e ON e.id = t.election_id WHERE t.id = ANY($1) ORDER BY t.position`,
        [scope, clock.now()],
      ),
      pool.query('SELECT table_id, count(*)::int AS total FROM electors WHERE table_id = ANY($1) GROUP BY table_id', [scope]),
      votesPerTable(pool, scope),
      pool.query(
        `SELECT o.id, o.table_id, o.device_time, o.payload FROM operations o
         LEFT JOIN incident_states s ON s.operation_id = o.id
         WHERE o.table_id = ANY($1) AND o.type = 'incident.reported' AND s.operation_id IS NULL
         ORDER BY o.device_time DESC`,
        [scope],
      ),
      pool.query(`SELECT table_id, type, payload, received_at FROM operations WHERE table_id = ANY($1) AND type IN ('envelopes.counted', 'tally.submitted', 'tally.photo') AND NOT quarantined ORDER BY seq`, [scope]),
    ]);
    // The lists of each category, as the election has them now: votes for anything else add up to nothing in the results.
    const election = await pool.query('SELECT categories FROM elections WHERE id = $1', [request.params.id]);
    const listsOf = new Map<string, Set<string>>(((election.rows[0]?.categories ?? []) as { id: string; lists?: { id: string }[] }[]).map((category) => [category.id, new Set((category.lists ?? []).map((list) => list.id))]));
    const decided = await pool.query(
      `SELECT d.table_id, d.category, d.decided_at, o.payload->'results' AS results FROM tally_decisions d JOIN operations o ON o.id = d.operation_id WHERE d.table_id = ANY($1)`,
      [scope],
    );
    const decisionOf = new Map(decided.rows.map((row) => [`${row.table_id}:${row.category}`, row]));
    const settled = (table: string, category: string) => {
      const decision = decisionOf.get(`${table}:${category}`);
      return Boolean(decision) && !correctedSince(decision, counts.rows.filter((row) => row.table_id === table && row.type === 'tally.submitted' && row.payload.category === category));
    };
    const needsReview = (table: string, total: number) => {
      const own = counts.rows.filter((row) => row.table_id === table);
      // What each category counts for now: the version the chief chose, or else the latest one.
      const standing = new Map<string, Record<string, number>>();
      for (const { type, payload } of own) if (type === 'tally.submitted') standing.set(payload.category, payload.results);
      for (const category of standing.keys()) if (settled(table, category)) standing.set(category, decisionOf.get(`${table}:${category}`).results);
      const envelopes = own.filter((row) => row.type === 'envelopes.counted').at(-1)?.payload;
      const versions = new Map<string, Set<string>>();
      for (const { type, payload } of own) {
        if (type !== 'tally.submitted') continue;
        versions.set(payload.category, (versions.get(payload.category) ?? new Set()).add(JSON.stringify(payload.results)));
      }
      return {
        // A table that counted its envelopes has closed for the day: its silence says nothing.
        countedDays: own.filter((row) => row.type === 'envelopes.counted').map((row) => row.payload.day),
        // When each day was closed there, by the first count of its envelopes: an hour later, a missing tally is worth a call.
        countedAt: Object.fromEntries(own.filter((row) => row.type === 'envelopes.counted').reverse().map((row) => [row.payload.day, row.received_at])),
        tallied: [...versions.keys()],
        photo: own.some((row) => row.type === 'tally.photo'),
        envelopesDiffer: Boolean(envelopes && envelopes.envelopes !== envelopes.marked),
        talliesDiffer: [...versions].some(([category, distinct]) => distinct.size > 1 && !settled(table, category)),
        // More votes than people in its roll is a mistake somewhere: nothing is refused, but someone has to look.
        tallyOverRoll: total > 0 && [...standing.values()].some((results) => Object.values(results).reduce((sum, votes) => sum + Number(votes), 0) > total),
        // A phone that kept categories or lists the election no longer has: what it sent for them is not counted anywhere.
        tallyUnknown: [...standing].some(([category, results]) => !listsOf.has(category) || Object.keys(results).some((list) => !listsOf.get(category)!.has(list))),
      };
    };
    const sizeOf = new Map(sizes.rows.map((row) => [row.table_id, row.total]));
    const value = {
      tables: tables.rows.map((t) => ({
        id: t.id, name: t.name, place: t.place, total: sizeOf.get(t.id) ?? 0, voted: votes.get(t.id) ?? 0, lastSync: t.last_sync, fiscal: t.fiscal, ...needsReview(t.id, sizeOf.get(t.id) ?? 0),
        incidents: incidents.rows.filter((i) => i.table_id === t.id).map((i) => ({ id: i.id, at: i.device_time, kind: i.payload.kind })),
      })),
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  });

  /** Everything about one table, for the person looking after it. */
  app.get<{ Params: { table: string } }>('/api/tables/:table/detail', { preHandler: watch }, async (request, reply) => {
    const { table } = request.params;
    if (!(await canReachTable(pool, request.actor, table))) return reply.code(403).send({ error: 'forbidden' });
    const info = await pool.query(
      `SELECT t.id, t.name, t.place, e.categories, (SELECT count(*)::int FROM electors x WHERE x.table_id = t.id) AS total,
              (SELECT json_build_object('name', u.name, 'phone', u.phone) FROM role_assignments a JOIN users u ON u.id = a.user_id WHERE a.table_id = t.id AND a.role = 'fiscal' ORDER BY (a.days IS NULL OR ($2::timestamptz AT TIME ZONE e.time_zone)::date = ANY(a.days)) DESC LIMIT 1) AS fiscal
       FROM polling_tables t JOIN elections e ON e.id = t.election_id WHERE t.id = $1`,
      [table, clock.now()],
    );
    if (!info.rows[0]) return reply.code(404).send({ error: 'not_found' });
    await auditView(pool, request.actor, 'table.viewed', table);
    // An alert that came after the close shows too, said so, like in the district: otherwise nobody could ever resolve it.
    const operations = await pool.query(
      `SELECT id, type, payload, device_time, author, quarantined, received_at FROM operations
       WHERE table_id = $1 AND type IN ('incident.reported', 'envelopes.counted', 'tally.submitted', 'tally.photo') AND (NOT quarantined OR type = 'incident.reported') ORDER BY seq`,
      [table],
    );
    const decisions = await pool.query(
      `SELECT d.category, d.operation_id, d.decided_at, o.payload->'results' AS results FROM tally_decisions d JOIN operations o ON o.id = d.operation_id WHERE d.table_id = $1`,
      [table],
    );
    const states = await pool.query('SELECT operation_id FROM incident_states WHERE operation_id = ANY($1)', [operations.rows.filter((o) => o.type === 'incident.reported').map((o) => o.id)]);
    const resolved = new Set(states.rows.map((row) => row.operation_id));
    const tallies = new Map<string, { id: string; results: Record<string, number>; at: string }[]>();
    for (const op of operations.rows.filter((o) => o.type === 'tally.submitted')) {
      const list = tallies.get(op.payload.category) ?? [];
      list.push({ id: op.id, results: op.payload.results, at: op.device_time });
      tallies.set(op.payload.category, list);
    }
    // A choice that a later correction contradicts no longer holds: the chief chooses again.
    const chosen = new Map(
      decisions.rows
        .filter((row) => !correctedSince(row, operations.rows.filter((o) => o.type === 'tally.submitted' && o.payload.category === row.category)))
        .map((row) => [row.category, row.operation_id]),
    );
    return {
      ...info.rows[0],
      voted: (await votesPerTable(pool, [table])).get(table) ?? 0,
      incidents: operations.rows.filter((o) => o.type === 'incident.reported' && !resolved.has(o.id)).map((o) => ({ id: o.id, at: o.device_time, kind: o.payload.kind, late: o.quarantined })),
      envelopes: operations.rows.filter((o) => o.type === 'envelopes.counted').map((o) => ({ day: o.payload.day, envelopes: o.payload.envelopes, marked: o.payload.marked, matches: o.payload.envelopes === o.payload.marked })),
      photos: operations.rows.filter((o) => o.type === 'tally.photo').map((o) => o.payload.sha256),
      tallies: [...tallies.entries()].map(([category, versions]) => {
        const distinct = new Set(versions.map((version) => JSON.stringify(version.results)));
        return { category, versions, disagree: distinct.size > 1 && !chosen.has(category), chosen: chosen.get(category) ?? (distinct.size === 1 ? versions[versions.length - 1]!.id : null) };
      }),
    };
  });

  app.post<{ Params: { id: string } }>('/api/incidents/:id/resolve', { preHandler: requires(pool, 'incident.manage') }, async (request, reply) => {
    const found = await pool.query(`SELECT table_id FROM operations WHERE id = $1 AND type = 'incident.reported'`, [request.params.id]);
    const table = found.rows[0]?.table_id;
    if (!table) return reply.code(404).send({ error: 'not_found' });
    if (!(await canReachTable(pool, request.actor, table))) return reply.code(403).send({ error: 'forbidden' });
    await pool.query(`INSERT INTO incident_states (operation_id, status, resolved_by) VALUES ($1, 'resuelto', $2) ON CONFLICT DO NOTHING`, [request.params.id, request.actor.userId]);
    await audit(pool, request.actor, 'incident.resolved', request.params.id);
    cache.clear();
    return { ok: true };
  });

  /** When two counts differ, a person decides. Nothing merges them or picks one by itself. */
  app.post<{ Params: { table: string }; Body: { category?: unknown; operation?: unknown } }>('/api/tables/:table/tally/decide', { preHandler: requires(pool, 'tally.correct') }, async (request, reply) => {
    const { category, operation } = request.body ?? {};
    const { table } = request.params;
    if (typeof category !== 'string' || typeof operation !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    if (!(await canReachTable(pool, request.actor, table))) return reply.code(403).send({ error: 'forbidden' });
    const valid = await pool.query(`SELECT 1 FROM operations WHERE id = $1 AND table_id = $2 AND type = 'tally.submitted' AND payload->>'category' = $3`, [operation, table, category]);
    if (!valid.rowCount) return reply.code(404).send({ error: 'not_found' });
    await pool.query('INSERT INTO tally_decisions (table_id, category, operation_id, decided_by) VALUES ($1, $2, $3, $4) ON CONFLICT (table_id, category) DO UPDATE SET operation_id = $3, decided_by = $4, decided_at = now()', [table, category, operation, request.actor.userId]);
    await audit(pool, request.actor, 'tally.decided', table, { category, operation });
    return { ok: true };
  });

  // ---------- The schedule ----------

  /** Each table with its poll watchers, their times and its chief: the whole party for coordination, a district for its chief. */
  app.get<{ Params: { id: string } }>('/api/elections/:id/schedule', { preHandler: watch }, async (request, reply) => {
    const election = (await pool.query('SELECT name, days, hours, time_zone FROM elections WHERE id = $1', [request.params.id])).rows[0];
    if (!election) return reply.code(404).send({ error: 'not_found' });
    const scope = await tablesInScope(pool, request.actor, request.params.id);
    const tables = await pool.query(
      `SELECT t.id, t.name, t.place, n.name AS unit,
              (SELECT u.name FROM role_assignments a JOIN users u ON u.id = a.user_id WHERE a.role = 'jefe' AND u.removed_at IS NULL AND (a.unit_id = t.unit_id OR (a.unit_id IS NULL AND a.election_id = t.election_id)) ORDER BY a.unit_id NULLS LAST LIMIT 1) AS chief,
              COALESCE((SELECT json_agg(json_build_object('name', u.name, 'phone', u.phone, 'days', a.days, 'schedule', a.schedule) ORDER BY a.created_at)
                FROM role_assignments a JOIN users u ON u.id = a.user_id WHERE a.table_id = t.id AND a.role = 'fiscal' AND u.removed_at IS NULL), '[]') AS fiscales
       FROM polling_tables t LEFT JOIN units n ON n.id = t.unit_id WHERE t.id = ANY($1) ORDER BY t.position`,
      [scope],
    );
    await auditView(pool, request.actor, 'schedule.viewed', request.params.id);
    return {
      name: election.name, days: election.days.map((day: Date) => day.toISOString().slice(0, 10)), hours: election.hours, timeZone: election.time_zone,
      tables: tables.rows.map((table) => ({ ...table, fiscales: table.fiscales.map((fiscal: { days: string[] | null }) => ({ ...fiscal, days: fiscal.days?.map((day) => String(day).slice(0, 10)) ?? null })) })),
    };
  });

  // ---------- Results ----------

  /** Coordination and statistics see the whole party; a chief, their district. */
  async function resultsScope(actor: Actor, election: string): Promise<string[] | null> {
    if (can(actor, 'stats.read') || can(actor, 'election.manage')) return (await pool.query('SELECT id FROM polling_tables WHERE election_id = $1', [election])).rows.map((row) => row.id);
    return can(actor, 'district.watch') ? tablesInScope(pool, actor, election) : null;
  }

  /**
   * The chosen version of each table, summed per list, and what was left out and why. With ?tables=1, each table's
   * own numbers too, for the spreadsheet: that download is logged.
   */
  app.get<{ Params: { id: string }; Querystring: { tables?: string } }>('/api/elections/:id/results', { preHandler: authenticated(pool) }, async (request, reply) => {
    const { id } = request.params;
    const scope = await resultsScope(request.actor, id);
    if (!scope) return reply.code(403).send({ error: 'forbidden' });
    const election = (await pool.query('SELECT name, status, categories FROM elections WHERE id = $1', [id])).rows[0];
    if (!election) return reply.code(404).send({ error: 'not_found' });
    const outcome = await tallyOutcomes(pool, scope);
    const categories = (election.categories as { id: string; name: string; lists: { id: string; name: string }[] }[]).map((category) => {
      const votes = new Map<string, number>();
      let counted = 0;
      let undecided = 0;
      for (const table of scope) {
        const found = outcome.get(`${table}:${category.id}`);
        if (found === 'undecided') undecided++;
        else if (found) {
          counted++;
          for (const [list, count] of Object.entries(found.results)) votes.set(list, (votes.get(list) ?? 0) + count);
        }
      }
      return { id: category.id, name: category.name, counted, undecided, missing: scope.length - counted - undecided, lists: category.lists.map((list) => ({ id: list.id, name: list.name, votes: votes.get(list.id) ?? 0 })) };
    });
    if (request.query.tables !== '1') {
      await auditView(pool, request.actor, 'results.viewed', id);
      return { name: election.name, status: election.status, tables: scope.length, categories };
    }
    const tables = await pool.query('SELECT id, name FROM polling_tables WHERE id = ANY($1) ORDER BY position', [scope]);
    await audit(pool, request.actor, 'results.downloaded', id, { tables: scope.length });
    return {
      name: election.name, status: election.status, tables: scope.length, categories,
      perTable: tables.rows.map((table) => ({
        name: table.name,
        categories: Object.fromEntries(categories.map((category) => {
          const found = outcome.get(`${table.id}:${category.id}`);
          return [category.id, found === 'undecided' ? 'undecided' : found ? found.results : null];
        })),
      })),
    };
  });

  // ---------- What arrives after the close ----------

  /** It counts for nothing until a person looks at it: coordination, or the chief of that table's district. */
  app.get<{ Params: { id: string } }>('/api/elections/:id/late', { preHandler: watch }, async (request) => {
    const { id } = request.params;
    const scope = await tablesInScope(pool, request.actor, id);
    const election = (await pool.query('SELECT closed_at, categories FROM elections WHERE id = $1', [id])).rows[0];
    const late = await pool.query(
      `SELECT o.id, o.table_id, t.name AS table_name, o.type, o.payload, o.received_at, u.name AS author
       FROM operations o JOIN polling_tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = o.author
       WHERE o.table_id = ANY($1) AND o.quarantined AND o.type = ANY($2) AND NOT EXISTS (SELECT 1 FROM late_reviews r WHERE r.operation_id = o.id)
       ORDER BY o.received_at, o.seq`,
      [scope, LATE_TYPES],
    );
    // What those tables already had, to compare with.
    const counted = await pool.query(
      `SELECT table_id, type, payload FROM operations WHERE table_id = ANY($1) AND type IN ('envelopes.counted', 'tally.submitted') AND NOT quarantined ORDER BY seq`,
      [[...new Set(late.rows.map((row) => row.table_id))]],
    );
    return {
      closedAt: election?.closed_at ?? null,
      categories: election?.categories ?? [],
      items: late.rows.map((row) => {
        const own = counted.rows.filter((other) => other.table_id === row.table_id);
        const earlier = row.type === 'tally.submitted' ? own.filter((other) => other.type === 'tally.submitted' && other.payload.category === row.payload.category) : [];
        return {
          id: row.id, table: { id: row.table_id, name: row.table_name }, type: row.type, payload: row.payload, at: row.received_at, author: row.author,
          envelopes: own.filter((other) => other.type === 'envelopes.counted').at(-1)?.payload.envelopes ?? null,
          earlier: earlier.length > 0,
          clash: earlier.some((other) => JSON.stringify(other.payload.results) !== JSON.stringify(row.payload.results)),
        };
      }),
    };
  });

  /** Always a person's decision, and it is logged. Added, it counts like anything that arrived in time. */
  app.post<{ Params: { operation: string }; Body: { decision?: unknown } }>('/api/late/:operation', { preHandler: watch }, async (request, reply) => {
    const { operation } = request.params;
    const { decision } = request.body ?? {};
    if (!OPERATION_ID.test(operation) || (decision !== 'sumado' && decision !== 'descartado')) return reply.code(400).send({ error: 'invalid_request' });
    const table = (await pool.query('SELECT table_id FROM operations WHERE id = $1 AND quarantined AND type = ANY($2)', [operation, LATE_TYPES])).rows[0]?.table_id;
    if (!table) return reply.code(404).send({ error: 'not_found' });
    if (!(await canReachTable(pool, request.actor, table))) return reply.code(403).send({ error: 'forbidden' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reviewed = await client.query('INSERT INTO late_reviews (operation_id, decision, decided_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [operation, decision, request.actor.userId]);
      if (!reviewed.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'already_decided' });
      }
      if (decision === 'sumado') await client.query('UPDATE operations SET quarantined = false WHERE id = $1', [operation]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await audit(pool, request.actor, decision === 'sumado' ? 'late.added' : 'late.discarded', table, { operation });
    cache.clear();
    return { decision };
  });

  // ---------- Statistics: numbers only, and no group small enough to point at someone ----------
  app.get<{ Params: { id: string } }>('/api/elections/:id/stats', { preHandler: requires(pool, 'stats.read') }, async (request) => {
    const scope = (await pool.query('SELECT id, name FROM polling_tables WHERE election_id = $1 ORDER BY position', [request.params.id])).rows;
    const ids = scope.map((row) => row.id);
    const totals = await pool.query('SELECT table_id, count(*)::int AS total FROM electors WHERE election_id = $1 AND table_id IS NOT NULL GROUP BY table_id', [request.params.id]);
    const votes = await votesPerTable(pool, ids);
    const totalOf = new Map(totals.rows.map((row) => [row.table_id, row.total]));
    const people = totals.rows.reduce((sum, row) => sum + row.total, 0);
    const voted = [...votes.values()].reduce((sum, value) => sum + value, 0);
    const hours = await pool.query(
      `SELECT to_char(date_trunc('hour', device_time AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS hour, count(*)::int AS marks FROM operations
       WHERE table_id = ANY($1) AND type = 'voter.marked' AND NOT quarantined GROUP BY 1 ORDER BY 1`,
      [ids],
    );
    await audit(pool, request.actor, 'stats.viewed', request.params.id);
    return {
      people,
      voted,
      share: people ? Math.round((voted / people) * 100) : 0,
      tables: scope
        .filter((row) => (totalOf.get(row.id) ?? 0) >= SMALLEST_GROUP)
        .map((row) => ({ name: row.name, share: Math.round(((votes.get(row.id) ?? 0) / totalOf.get(row.id)) * 100) })),
      hours: hours.rows.filter((row) => row.marks >= SMALLEST_GROUP),
    };
  });

  // ---------- Traffic light ----------
  const readLight = requires(pool, 'semaphore.read');
  const writeLight = requires(pool, 'semaphore.write');

  /** Whoever cannot see sensitive categories learns how many there are, so that nobody makes another one like it without knowing. */
  app.get('/api/semaphore/categories', { preHandler: readLight }, async (request) => {
    const rows = await pool.query('SELECT id, name, color, sensitive FROM semaphore_categories ORDER BY position, name');
    const seen = rows.rows.filter((row) => !row.sensitive || can(request.actor, 'semaphore.sensitive'));
    return { categories: seen, hidden: rows.rows.length - seen.length };
  });

  /** Who has a category: the plain marks, and the sealed ones that name it once opened. */
  async function marksOf(category: string): Promise<{ plain: number; sealed: { election_id: string; elector_id: string }[] }> {
    const plain = (await pool.query('SELECT count(*)::int AS n FROM semaphore_marks WHERE category_id = $1', [category])).rows[0].n;
    const sealed = (await pool.query('SELECT election_id, elector_id, sealed FROM semaphore_marks WHERE sealed IS NOT NULL')).rows.filter((row) => unseal(row.sealed) === category);
    return { plain, sealed };
  }

  // Whoever does the traffic light sets it up too: the categories are part of that work, not of running elections.
  const manageLight = requires(pool, 'semaphore.write');
  /** A sensitive category is only for whoever may see them: nobody else learns its name, nor touches it. */
  async function categoryFor(actor: Actor, id: string): Promise<{ sensitive: boolean } | 'forbidden' | null> {
    if (!OPERATION_ID.test(id)) return null;
    const found = (await pool.query('SELECT sensitive FROM semaphore_categories WHERE id = $1', [id])).rows[0];
    if (!found) return null;
    return found.sensitive && !can(actor, 'semaphore.sensitive') ? 'forbidden' : found;
  }

  app.get<{ Params: { id: string } }>('/api/semaphore/categories/:id', { preHandler: manageLight }, async (request, reply) => {
    const found = await categoryFor(request.actor, request.params.id);
    if (found === null) return reply.code(404).send({ error: 'not_found' });
    if (found === 'forbidden') return reply.code(403).send({ error: 'forbidden' });
    const marks = await marksOf(request.params.id);
    return { people: marks.plain + marks.sealed.length };
  });

  /**
   * Its name, its colour, and whether it is sensitive, at any time. Marked sensitive, the marks it already has are
   * sealed right then; only whoever may see sensitive categories takes that back, and both are logged.
   */
  app.put<{ Params: { id: string }; Body: { name?: unknown; color?: unknown; sensitive?: unknown } }>('/api/semaphore/categories/:id', { preHandler: manageLight }, async (request, reply) => {
    const { name, color, sensitive } = request.body ?? {};
    const found = await categoryFor(request.actor, request.params.id);
    if (found === null) return reply.code(404).send({ error: 'not_found' });
    if (found === 'forbidden') return reply.code(403).send({ error: 'forbidden' });
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 60)) return reply.code(400).send({ error: 'invalid_name' });
    if (color !== undefined && (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))) return reply.code(400).send({ error: 'invalid_color' });
    if (sensitive !== undefined && typeof sensitive !== 'boolean') return reply.code(400).send({ error: 'invalid_request' });
    if (sensitive === false && found.sensitive && !can(request.actor, 'semaphore.sensitive')) return reply.code(403).send({ error: 'needs_sensitive_permission' });
    const id = request.params.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE semaphore_categories SET name = COALESCE($2, name), color = COALESCE($3, color), sensitive = COALESCE($4, sensitive) WHERE id = $1', [id, typeof name === 'string' ? name.trim() : null, color ?? null, sensitive ?? null]);
      if (sensitive === true && !found.sensitive) {
        const plain = await client.query('SELECT election_id, elector_id FROM semaphore_marks WHERE category_id = $1', [id]);
        for (const row of plain.rows) await client.query('UPDATE semaphore_marks SET category_id = NULL, sealed = $3 WHERE election_id = $1 AND elector_id = $2', [row.election_id, row.elector_id, seal(id)]);
      }
      if (sensitive === false && found.sensitive) {
        for (const row of (await marksOf(id)).sealed) await client.query('UPDATE semaphore_marks SET category_id = $3, sealed = NULL WHERE election_id = $1 AND elector_id = $2', [row.election_id, row.elector_id, id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await audit(pool, request.actor, 'semaphore.category_changed', id, sensitive !== undefined && sensitive !== found.sensitive ? { sensitive } : {});
    return { ok: true };
  });

  /** The order of the list, as the person leaves it. Categories they cannot see keep their place. */
  app.put<{ Body: { ids?: unknown } }>('/api/semaphore/order', { preHandler: manageLight }, async (request, reply) => {
    const { ids } = request.body ?? {};
    if (!Array.isArray(ids) || ids.length > MAX_CATEGORIES || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !OPERATION_ID.test(id))) return reply.code(400).send({ error: 'invalid_request' });
    const positions = (await pool.query('SELECT id, position FROM semaphore_categories WHERE id = ANY($1) ORDER BY position', [ids])).rows.map((row) => row.position);
    for (const [index, id] of ids.entries()) await pool.query('UPDATE semaphore_categories SET position = $2 WHERE id = $1', [id, positions[index] ?? index]);
    return { ok: true };
  });

  /** Only once nobody has it: a mark must not disappear because its category did. */
  app.delete<{ Params: { id: string } }>('/api/semaphore/categories/:id', { preHandler: manageLight }, async (request, reply) => {
    const found = await categoryFor(request.actor, request.params.id);
    if (found === null) return reply.code(404).send({ error: 'not_found' });
    if (found === 'forbidden') return reply.code(403).send({ error: 'forbidden' });
    const marks = await marksOf(request.params.id);
    if (marks.plain + marks.sealed.length > 0) return reply.code(409).send({ error: 'in_use', people: marks.plain + marks.sealed.length });
    await pool.query('DELETE FROM semaphore_categories WHERE id = $1', [request.params.id]);
    await audit(pool, request.actor, 'semaphore.category_deleted', request.params.id);
    return { ok: true };
  });

  /** It starts empty: each party defines its own categories. */
  app.post<{ Body: { name?: unknown; color?: unknown; sensitive?: unknown } }>('/api/semaphore/categories', { preHandler: manageLight }, async (request, reply) => {
    const { name, color, sensitive } = request.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 60) return reply.code(400).send({ error: 'invalid_name' });
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return reply.code(400).send({ error: 'invalid_color' });
    if ((await pool.query('SELECT count(*)::int AS n FROM semaphore_categories')).rows[0].n >= MAX_CATEGORIES) return reply.code(409).send({ error: 'too_many_categories', max: MAX_CATEGORIES });
    const id = randomUUID();
    await pool.query('INSERT INTO semaphore_categories (id, name, color, sensitive, position) VALUES ($1, $2, $3, $4, (SELECT count(*) FROM semaphore_categories))', [id, name.trim(), color, sensitive === true]);
    await audit(pool, request.actor, 'semaphore.category_created', id);
    return { id };
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>('/api/elections/:id/people', { preHandler: readLight }, async (request) => {
    const query = foldText(request.query.q ?? '').trim();
    if (query.length < 2) return { people: [] };
    // A document is found only whole: part of one would let anyone with the traffic light read it a digit at a time,
    // since nothing records a search that finds no one. The name is taken as written, with no wildcards.
    const words = query.split(/\s+/);
    const documents = [...new Set(words.filter((word) => /\d/.test(word)).map((word) => word.replace(/[^0-9a-z]/g, '')))];
    if (documents.length > 1) return { people: [] };
    const name = words.filter((word) => !/\d/.test(word)).join(' ').replace(/[\\%_]/g, (character) => `\\${character}`);
    const rows = await pool.query(
      `SELECT x.public_id, x.ref, x.full_name, x.order_number, t.name AS table_name, m.category_id, m.sealed
       FROM electors x LEFT JOIN polling_tables t ON t.id = x.table_id
       LEFT JOIN semaphore_marks m ON m.election_id = x.election_id AND m.elector_id = x.id
       WHERE x.election_id = $1 AND x.search LIKE '%' || $2 || '%' ESCAPE '\\'
         AND ($3::text IS NULL OR lower(regexp_replace(coalesce(x.document, ''), '[^0-9A-Za-z]', '', 'g')) = $3)
       ORDER BY x.search LIMIT 25`,
      [request.params.id, name, documents[0] ?? null],
    );
    // Each name comes with what the party thinks of that person's vote: who saw whom is recorded, by reference.
    if (rows.rows.length > 0) await audit(pool, request.actor, 'semaphore.searched', request.params.id, { people: rows.rows.map((row) => row.ref) });
    const sensitive = can(request.actor, 'semaphore.sensitive');
    const sealed = rows.rows.filter((row) => row.sealed).map((row) => row.ref);
    if (sealed.length > 0 && sensitive) await audit(pool, request.actor, 'semaphore.sensitive_viewed', request.params.id, { people: sealed });
    // The id the phones know each person by: the roll id stays on the server, since it can be the whole document.
    return {
      people: rows.rows.map((row) => ({
        id: row.public_id, name: row.full_name, order: row.order_number, table: row.table_name,
        // A sensitive mark goes first for whoever may see it. Anyone else sees the plain one under it, if there is one.
        category: row.sealed && sensitive ? unseal(row.sealed) : row.category_id,
      })),
    };
  });

  app.put<{ Params: { id: string; elector: string }; Body: { category?: unknown } }>('/api/elections/:id/people/:elector/semaphore', { preHandler: writeLight }, async (request, reply) => {
    const { id, elector } = request.params;
    const { category } = request.body ?? {};
    // What is asked for is checked first, so that a wrong category says nothing about the person.
    if (category !== null && typeof category !== 'string') return reply.code(400).send({ error: 'invalid_category' });
    const found = category === null ? null : await pool.query('SELECT sensitive FROM semaphore_categories WHERE id = $1', [category]);
    if (found && !found.rows[0]) return reply.code(404).send({ error: 'no_such_category' });
    const sensitive: boolean = found?.rows[0].sensitive ?? false;
    // `elector` is the id the search gave, never the roll id. Whoever was erased is no longer there to note.
    const person = await pool.query('SELECT id, ref FROM electors WHERE election_id = $1 AND public_id = $2 AND erased_at IS NULL', [id, elector]);
    if (!person.rows[0]) return reply.code(404).send({ error: 'not_found' });
    const { id: rollId, ref } = person.rows[0] as { id: string; ref: string };
    // Whoever cannot see a sensitive mark changes only the plain one, which sits under it: they never replace or clear
    // what they cannot see, and the answer is the same whether the person has one or not, so it does not tell them.
    if (!can(request.actor, 'semaphore.sensitive')) {
      if (sensitive) {
        await audit(pool, request.actor, 'semaphore.refused', ref);
        return reply.code(403).send({ error: 'sensitive_mark' });
      }
      if (category === null) {
        await pool.query('UPDATE semaphore_marks SET category_id = NULL WHERE election_id = $1 AND elector_id = $2', [id, rollId]);
        await pool.query('DELETE FROM semaphore_marks WHERE election_id = $1 AND elector_id = $2 AND sealed IS NULL', [id, rollId]);
        await audit(pool, request.actor, 'semaphore.cleared', ref);
        return { ok: true };
      }
      await pool.query(
        `INSERT INTO semaphore_marks (election_id, elector_id, category_id, noted_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (election_id, elector_id) DO UPDATE SET category_id = $3, noted_by = $4, noted_at = now()`,
        [id, rollId, category, request.actor.userId],
      );
      await audit(pool, request.actor, 'semaphore.noted', ref, { sensitive: false });
      return { ok: true };
    }
    // Whoever sees it all changes the whole mark.
    if (category === null) {
      await pool.query('DELETE FROM semaphore_marks WHERE election_id = $1 AND elector_id = $2', [id, rollId]);
      await audit(pool, request.actor, 'semaphore.cleared', ref);
      return { ok: true };
    }
    await pool.query(
      `INSERT INTO semaphore_marks (election_id, elector_id, category_id, sealed, noted_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (election_id, elector_id) DO UPDATE SET category_id = $3, sealed = $4, noted_by = $5, noted_at = now()`,
      [id, rollId, sensitive ? null : category, sensitive ? seal(category as string) : null, request.actor.userId],
    );
    await audit(pool, request.actor, 'semaphore.noted', ref, { sensitive });
    return { ok: true };
  });

  // ---------- A person's rights: arts. 14 to 16 of the personal data law ----------
  const managePersons = requires(pool, 'persons.manage');

  app.get<{ Querystring: { q?: string } }>('/api/persons', { preHandler: managePersons }, async (request) => {
    const query = foldText(request.query.q ?? '').trim();
    if (query.length < 3) return { people: [] };
    const rows = await pool.query(
      `SELECT x.election_id, e.name AS election, x.id, x.ref, x.full_name, x.document, x.file_number, x.address, x.consent, t.name AS table_name, m.elector_id IS NOT NULL AS has_mark
       FROM electors x JOIN elections e ON e.id = x.election_id LEFT JOIN polling_tables t ON t.id = x.table_id
       LEFT JOIN semaphore_marks m ON m.election_id = x.election_id AND m.elector_id = x.id
       WHERE x.search LIKE '%' || $1 || '%' ORDER BY x.search LIMIT 25`,
      [query],
    );
    await audit(pool, request.actor, 'person.searched', undefined, { people: rows.rows.map((row) => row.ref) });
    return { people: rows.rows.map(({ ref: _ref, ...row }) => row) };
  });

  app.get<{ Params: { election: string; id: string } }>('/api/persons/:election/:id/export', { preHandler: managePersons }, async (request, reply) => {
    const { election, id } = request.params;
    const person = await pool.query('SELECT * FROM electors WHERE election_id = $1 AND id = $2', [election, id]);
    if (!person.rows[0]) return reply.code(404).send({ error: 'not_found' });
    const mark = await pool.query('SELECT category_id, sealed, noted_at FROM semaphore_marks WHERE election_id = $1 AND elector_id = $2', [election, id]);
    // Like the count: a mark that a later undo cancelled does not say the person voted. Marks name people by their random id.
    const voted = await pool.query(
      `SELECT o.device_time FROM operations o WHERE o.table_id = $1 AND o.type = 'voter.marked' AND NOT o.quarantined AND o.payload->>'elector' = $2
         AND NOT EXISTS (SELECT 1 FROM operations u WHERE u.table_id = $1 AND u.type = 'voter.unmarked' AND NOT u.quarantined AND u.payload->'cancels' ? o.id::text)
       ORDER BY o.device_time`,
      [person.rows[0].table_id, person.rows[0].public_id],
    );
    const { ref } = person.rows[0];
    await audit(pool, request.actor, 'person.exported', ref);
    // Art. 14: who saw or changed their data, as the log keeps it by their reference. This export is the last line.
    const log = await pool.query(
      `SELECT l.at, l.action, u.name AS who FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
       WHERE l.target = $1 OR l.detail->'people' ? $1 ORDER BY l.id`,
      [String(ref)],
    );
    const row = mark.rows[0];
    // A sensitive category is opened only for whoever has its own permission, and that is recorded as such.
    const hidden = Boolean(row?.sealed) && !can(request.actor, 'semaphore.sensitive');
    if (row?.sealed && !hidden) await audit(pool, request.actor, 'semaphore.sensitive_viewed', ref, { people: [ref] });
    const nameOf = async (category: string | null): Promise<string | null> =>
      category ? ((await pool.query('SELECT name FROM semaphore_categories WHERE id = $1', [category])).rows[0]?.name ?? null) : null;
    const name = row ? await nameOf(row.sealed ? (hidden ? null : unseal(row.sealed)) : row.category_id) : null;
    // Under a sensitive mark there can be a plain one, from someone who could not see it: it is held about the person too.
    const under = row?.sealed ? await nameOf(row.category_id) : null;
    const found = person.rows[0];
    const place = await pool.query(
      'SELECT e.name, e.days, t.name AS table_name, t.place FROM elections e LEFT JOIN polling_tables t ON t.id = $2 WHERE e.id = $1',
      [election, found.table_id],
    );
    const where = place.rows[0];
    // The page is about one roll: it says in which others the same document is, so that nobody takes it for everything.
    const others = found.document
      ? await pool.query(
          `SELECT DISTINCT e.name FROM electors x JOIN elections e ON e.id = x.election_id WHERE x.document = $1 AND x.election_id <> $2 AND x.erased_at IS NULL AND e.status <> 'purgada' ORDER BY e.name`,
          [found.document, election],
        )
      : { rows: [] };
    // Only what is held about the person, with names a person understands: the screen turns it into a page to hand over.
    return {
      party: (await getSetting<{ name: string }>(pool, 'party', { name: '' })).name,
      election: { name: where.name, days: where.days.map((day: Date) => day.toISOString().slice(0, 10)) },
      person: { name: found.full_name, document: found.document, fileNumber: found.file_number, address: found.address, order: found.order_number, extra: found.extra, toReview: found.needs_review },
      table: where.table_name ? { name: where.table_name, place: where.place } : null,
      consent: found.consent,
      semaphore: row ? { category: name, sensitive: Boolean(row.sealed), hidden, notedAt: row.noted_at, ...(under ? { under } : {}) } : null,
      markedVoted: voted.rows.map((r) => r.device_time),
      log: log.rows.map((r) => ({ at: r.at, action: r.action, who: r.who })),
      others: others.rows.map((r) => r.name as string),
    };
  });

  /** Art. 16: whoever finds a mistake in their data has the right to have it corrected, until the election is purged. */
  app.put<{ Params: { election: string; id: string }; Body: { full_name?: unknown; document?: unknown } }>('/api/persons/:election/:id', { preHandler: managePersons }, async (request, reply) => {
    const status = await pool.query('SELECT status FROM elections WHERE id = $1', [request.params.election]);
    if (status.rows[0]?.status === 'purgada') return reply.code(409).send({ error: 'election_purged' });
    const result = await correctElector(pool, request.actor, request.params.election, request.params.id, request.body);
    if (result === 'invalid_name') return reply.code(400).send({ error: 'invalid_name' });
    if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.put<{ Params: { election: string; id: string }; Body: { date?: unknown; means?: unknown } }>('/api/persons/:election/:id/consent', { preHandler: managePersons }, async (request, reply) => {
    const consent = consentOf(request.body);
    if (!consent) return reply.code(400).send({ error: 'invalid_request' });
    const saved = await pool.query('UPDATE electors SET consent = $3 WHERE election_id = $1 AND id = $2 AND erased_at IS NULL RETURNING ref', [request.params.election, request.params.id, JSON.stringify(consent)]);
    if (!saved.rows[0]) return reply.code(404).send({ error: 'not_found' });
    await audit(pool, request.actor, 'person.consent', saved.rows[0].ref);
    return { ok: true };
  });

  /** Art. 6 and 27: they took their consent back. When and how is kept, and their mark in the traffic light goes now. */
  app.post<{ Params: { election: string; id: string }; Body: { date?: unknown; means?: unknown } }>('/api/persons/:election/:id/consent/withdraw', { preHandler: managePersons }, async (request, reply) => {
    const consent = consentOf(request.body);
    if (!consent) return reply.code(400).send({ error: 'invalid_request' });
    const { date, means } = consent;
    const saved = await pool.query(
      `UPDATE electors SET consent = consent || jsonb_build_object('withdrawn', jsonb_build_object('date', $3::text, 'means', $4::text))
       WHERE election_id = $1 AND id = $2 AND erased_at IS NULL AND consent IS NOT NULL RETURNING ref`,
      [request.params.election, request.params.id, date, means],
    );
    if (!saved.rows[0]) return reply.code(404).send({ error: 'not_found' });
    await pool.query('DELETE FROM semaphore_marks WHERE election_id = $1 AND elector_id = $2', [request.params.election, request.params.id]);
    await audit(pool, request.actor, 'person.consent_withdrawn', saved.rows[0].ref);
    return { ok: true };
  });

  /** A consent loaded by mistake goes, and the log says who removed it. */
  app.delete<{ Params: { election: string; id: string } }>('/api/persons/:election/:id/consent', { preHandler: managePersons }, async (request, reply) => {
    const saved = await pool.query('UPDATE electors SET consent = NULL WHERE election_id = $1 AND id = $2 AND erased_at IS NULL AND consent IS NOT NULL RETURNING ref', [request.params.election, request.params.id]);
    if (!saved.rows[0]) return reply.code(404).send({ error: 'not_found' });
    await audit(pool, request.actor, 'person.consent_removed', saved.rows[0].ref);
    return { ok: true };
  });

  /**
   * The name, the contact and the roll id go; the row stays anonymous, so that a table's totals still add up.
   * Who voted keeps counting, under the new id.
   */
  app.delete<{ Params: { election: string; id: string } }>('/api/persons/:election/:id', { preHandler: managePersons }, async (request, reply) => {
    const erased = await eraseElector(pool, request.params.election, request.params.id);
    if (erased === null) return reply.code(404).send({ error: 'not_found' });
    if (erased !== 'already') await audit(pool, request.actor, 'person.erased', erased.ref);
    return { ok: true };
  });

  /** After the election: no names remain. Only totals per table are kept. */
  app.post<{ Params: { id: string } }>('/api/elections/:id/purge', { preHandler: requires(pool, 'election.manage') }, async (request, reply) => {
    const { id } = request.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The same lock a phone's push takes: what it sends meanwhile is stored before, and goes with the rest, or after, and is dropped.
      await lockTables(client, id);
      const status = await client.query('SELECT status FROM elections WHERE id = $1 FOR UPDATE', [id]);
      if (status.rows[0]?.status !== 'cerrada') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'close_it_first' });
      }
      await client.query('DELETE FROM semaphore_marks WHERE election_id = $1', [id]);
      // The roll ids go too, since they are often the DNI, and so do the references, the random ids and the order in the table:
      // the audit log names people by reference, a phone by random id, and a table and an order, with the roll at hand, name them again.
      await client.query(
        `UPDATE electors SET id = 'x-' || replace(gen_random_uuid()::text, '-', ''), ref = gen_random_uuid(), public_id = new_public_id(), order_number = NULL,
           full_name = '', search = '', document = NULL, file_number = NULL, address = NULL, extra = '{}', needs_review = false, review = NULL, consent = NULL, source_key = NULL
         WHERE election_id = $1`,
        [id],
      );
      await client.query(`DELETE FROM operations WHERE table_id IN (SELECT id FROM polling_tables WHERE election_id = $1) AND type IN ('voter.marked', 'voter.unmarked')`, [id]);
      // What arrived after the close and nobody added: it was never counted. A late alert stays, as the chief saw it.
      await client.query('DELETE FROM operations WHERE table_id IN (SELECT id FROM polling_tables WHERE election_id = $1) AND quarantined AND type = ANY($2)', [id, LATE_TYPES]);
      await client.query(`UPDATE elections SET status = 'purgada', purged_at = now() WHERE id = $1`, [id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    forgetStatuses();
    await audit(pool, request.actor, 'election.purged', id);
    return { status: 'purgada' };
  });

  /**
   * Who saw or changed what, newest first, with what each entry was about. Filtered by who, by whether it only looked,
   * and by the people of the roll with a surname, which is what a request needs. A chief sees what was about their
   * district. Old values are never kept here: the log cannot be erased, and a name would outlive the purge.
   */
  app.get<{ Querystring: { before?: string; who?: string; kind?: string; q?: string } }>('/api/audit', { preHandler: authenticated(pool) }, async (request, reply) => {
    const all = can(request.actor, 'audit.read');
    if (!all && !can(request.actor, 'district.watch')) return reply.code(403).send({ error: 'forbidden' });
    await auditView(pool, request.actor, 'audit.viewed');
    const params: unknown[] = [SEEN_ACTIONS];
    const where: string[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const { who, kind, q } = request.query;
    if (typeof who === 'string' && OPERATION_ID.test(who)) where.push(`l.user_id = ${param(who)}`);
    if (kind === 'seen' || kind === 'changed') where.push(`${kind === 'seen' ? '' : 'NOT '}(l.action LIKE '%.viewed' OR l.action = ANY($1))`);
    // A chief sees what was about their own tables, and finds only the people of those.
    let scope: string[] | null = null;
    if (!all) {
      const units = request.actor.assignments.filter((a) => a.role === 'jefe').map((a) => a.unit_id);
      scope = (await pool.query('SELECT id FROM polling_tables WHERE $1 OR unit_id = ANY($2)', [units.includes(null), units])).rows.map((row) => row.id);
    }
    let people: string[] = [];
    if (typeof q === 'string' && q.trim().length >= 3 && q.length <= 120) {
      const typed = foldText(q).replace(/[\\%_]/g, (character) => `\\${character}`);
      const found = await pool.query(
        `SELECT ref::text AS ref, full_name FROM electors WHERE search LIKE '%' || $1 || '%' ESCAPE '\\' AND erased_at IS NULL AND ($2::text[] IS NULL OR table_id = ANY($2))
         ORDER BY search LIMIT 50`,
        [typed, scope],
      );
      if (found.rows.length === 0) return { entries: [], counts: { seen: 0, changed: 0 }, people: [] };
      people = found.rows.map((row) => row.full_name);
      const refs = param(found.rows.map((row) => row.ref));
      where.push(`(l.target = ANY(${refs}) OR l.detail->'people' ?| ${refs})`);
    }
    if (scope) {
      const tables = param(scope);
      where.push(`(l.target = ANY(${tables}) OR x.table_id = ANY(${tables}))`);
    }
    const from = `FROM audit_log l
       LEFT JOIN users u ON u.id = l.user_id
       LEFT JOIN elections e ON e.id::text = l.target
       LEFT JOIN polling_tables t ON t.id = l.target
       LEFT JOIN electors x ON x.ref::text = l.target
       LEFT JOIN polling_tables xt ON xt.id = x.table_id
       LEFT JOIN users tu ON tu.id::text = l.target
       LEFT JOIN units un ON un.id = l.target`;
    const filter = where.length ? `AND ${where.join(' AND ')}` : '';
    const counts = people.length
      ? (await pool.query(`SELECT count(*) FILTER (WHERE l.action LIKE '%.viewed' OR l.action = ANY($1))::int AS seen, count(*) FILTER (WHERE NOT (l.action LIKE '%.viewed' OR l.action = ANY($1)))::int AS changed ${from} WHERE true ${filter}`, params)).rows[0]
      : undefined;
    const page = Number(request.query.before);
    const before = param(Number.isSafeInteger(page) && page > 0 ? page : Number.MAX_SAFE_INTEGER);
    const rows = await pool.query(
      `SELECT l.id, l.at, l.action, u.name AS who, COALESCE(e.name, t.name, NULLIF(x.full_name, ''), tu.name, un.name, CASE WHEN l.action IN ('election.deleted', 'unit.deleted') THEN l.detail->>'name' END) AS about, xt.name AS about_table,
              CASE WHEN jsonb_typeof(l.detail->'people') = 'array' THEN jsonb_array_length(l.detail->'people') END AS people,
              (l.action LIKE '%.viewed' OR l.action = ANY($1)) AS seen
       ${from} WHERE l.id < ${before} ${filter} ORDER BY l.id DESC LIMIT 100`,
      params,
    );
    return { entries: rows.rows, ...(counts ? { counts, people } : {}) };
  });
}

/**
 * Whether a tally that arrived after the chief chose says something else than what was chosen. A correction is one
 * more version, and a person decides again: nothing replaces the chosen one by itself.
 */
function correctedSince(decision: { decided_at: Date; results: unknown }, versions: { received_at: Date; payload: { results: unknown } }[]): boolean {
  const chosen = JSON.stringify(decision.results);
  return versions.some((version) => version.received_at > decision.decided_at && JSON.stringify(version.payload.results) !== chosen);
}
