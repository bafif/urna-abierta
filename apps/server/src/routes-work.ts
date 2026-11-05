import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { foldText } from '@urna-abierta/domain';
import { audit, can, canReachTable, requires, seal, unseal, type Actor } from './actor.ts';

const SUMMARY_CACHE_MS = 10_000;
const SMALLEST_GROUP = 5;

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

export function workRoutes(app: FastifyInstance, pool: pg.Pool) {
  const watch = requires(pool, 'district.watch');
  const cache = new Map<string, { at: number; value: unknown }>();

  async function tablesInScope(request: { actor: Actor }, election: string): Promise<string[]> {
    const { actor } = request;
    if (can(actor, 'election.manage')) {
      return (await pool.query('SELECT id FROM polling_tables WHERE election_id = $1', [election])).rows.map((r) => r.id);
    }
    const units = actor.assignments.filter((a) => a.role === 'jefe').map((a) => a.unit_id);
    const everything = units.includes(null);
    return (await pool.query('SELECT id FROM polling_tables WHERE election_id = $1 AND ($2 OR unit_id = ANY($3))', [election, everything, units])).rows.map((r) => r.id);
  }

  app.get('/api/district/elections', { preHandler: watch }, async () => {
    const rows = await pool.query(`SELECT id, name, status, days FROM elections WHERE status NOT IN ('purgada') ORDER BY created_at DESC`);
    return { elections: rows.rows.map((row) => ({ ...row, days: row.days.map((day: Date) => day.toISOString().slice(0, 10)) })) };
  });

  /** Not a dashboard: what needs someone now comes first, and the rest fits in one line. */
  app.get<{ Params: { id: string } }>('/api/district/:id', { preHandler: watch }, async (request) => {
    const scope = await tablesInScope(request, request.params.id);
    const key = `${request.actor.userId}:${request.params.id}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < SUMMARY_CACHE_MS) return cached.value;
    const [tables, sizes, votes, incidents, counts] = await Promise.all([
      pool.query(
        `SELECT t.id, t.name, t.place, t.last_seq,
                t.last_contact AS last_sync,
                (SELECT json_build_object('name', u.name, 'phone', u.phone) FROM role_assignments a JOIN users u ON u.id = a.user_id
                 WHERE a.table_id = t.id AND a.role = 'fiscal' ORDER BY (a.days IS NULL OR current_date = ANY(a.days)) DESC LIMIT 1) AS fiscal
         FROM polling_tables t WHERE t.id = ANY($1) ORDER BY t.position`,
        [scope],
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
      pool.query(`SELECT table_id, type, payload FROM operations WHERE table_id = ANY($1) AND type IN ('envelopes.counted', 'tally.submitted') AND NOT quarantined ORDER BY seq`, [scope]),
    ]);
    const decided = await pool.query('SELECT table_id, category FROM tally_decisions WHERE table_id = ANY($1)', [scope]);
    const settled = new Set(decided.rows.map((row) => `${row.table_id}:${row.category}`));
    const needsReview = (table: string) => {
      const own = counts.rows.filter((row) => row.table_id === table);
      const envelopes = own.filter((row) => row.type === 'envelopes.counted').at(-1)?.payload;
      const versions = new Map<string, Set<string>>();
      for (const { type, payload } of own) {
        if (type !== 'tally.submitted') continue;
        versions.set(payload.category, (versions.get(payload.category) ?? new Set()).add(JSON.stringify(payload.results)));
      }
      return {
        // A table that counted its envelopes has closed for the day: its silence says nothing.
        countedDays: own.filter((row) => row.type === 'envelopes.counted').map((row) => row.payload.day),
        envelopesDiffer: Boolean(envelopes && envelopes.envelopes !== envelopes.marked),
        talliesDiffer: [...versions].some(([category, distinct]) => distinct.size > 1 && !settled.has(`${table}:${category}`)),
      };
    };
    const sizeOf = new Map(sizes.rows.map((row) => [row.table_id, row.total]));
    const value = {
      tables: tables.rows.map((t) => ({
        id: t.id, name: t.name, place: t.place, total: sizeOf.get(t.id) ?? 0, voted: votes.get(t.id) ?? 0, lastSync: t.last_sync, fiscal: t.fiscal, ...needsReview(t.id),
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
              (SELECT json_build_object('name', u.name, 'phone', u.phone) FROM role_assignments a JOIN users u ON u.id = a.user_id WHERE a.table_id = t.id AND a.role = 'fiscal' ORDER BY (a.days IS NULL OR current_date = ANY(a.days)) DESC LIMIT 1) AS fiscal
       FROM polling_tables t JOIN elections e ON e.id = t.election_id WHERE t.id = $1`,
      [table],
    );
    if (!info.rows[0]) return reply.code(404).send({ error: 'not_found' });
    const operations = await pool.query(`SELECT id, type, payload, device_time, author FROM operations WHERE table_id = $1 AND type IN ('incident.reported', 'envelopes.counted', 'tally.submitted', 'tally.photo') AND NOT quarantined ORDER BY seq`, [table]);
    const decisions = await pool.query('SELECT category, operation_id FROM tally_decisions WHERE table_id = $1', [table]);
    const states = await pool.query('SELECT operation_id FROM incident_states WHERE operation_id = ANY($1)', [operations.rows.filter((o) => o.type === 'incident.reported').map((o) => o.id)]);
    const resolved = new Set(states.rows.map((row) => row.operation_id));
    const tallies = new Map<string, { id: string; results: Record<string, number>; at: string }[]>();
    for (const op of operations.rows.filter((o) => o.type === 'tally.submitted')) {
      const list = tallies.get(op.payload.category) ?? [];
      list.push({ id: op.id, results: op.payload.results, at: op.device_time });
      tallies.set(op.payload.category, list);
    }
    const chosen = new Map(decisions.rows.map((row) => [row.category, row.operation_id]));
    return {
      ...info.rows[0],
      voted: (await votesPerTable(pool, [table])).get(table) ?? 0,
      incidents: operations.rows.filter((o) => o.type === 'incident.reported' && !resolved.has(o.id)).map((o) => ({ id: o.id, at: o.device_time, kind: o.payload.kind })),
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
      `SELECT (date_trunc('hour', device_time))::text AS hour, count(*)::int AS marks FROM operations
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

  app.get('/api/semaphore/categories', { preHandler: readLight }, async (request) => {
    const rows = await pool.query('SELECT id, name, color, sensitive FROM semaphore_categories ORDER BY position, name');
    return { categories: rows.rows.filter((row) => !row.sensitive || can(request.actor, 'semaphore.sensitive')) };
  });

  /** It starts empty: each party defines its own categories. */
  app.post<{ Body: { name?: unknown; color?: unknown; sensitive?: unknown } }>('/api/semaphore/categories', { preHandler: requires(pool, 'election.manage') }, async (request, reply) => {
    const { name, color, sensitive } = request.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 60) return reply.code(400).send({ error: 'invalid_name' });
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return reply.code(400).send({ error: 'invalid_color' });
    const id = randomUUID();
    await pool.query('INSERT INTO semaphore_categories (id, name, color, sensitive, position) VALUES ($1, $2, $3, $4, (SELECT count(*) FROM semaphore_categories))', [id, name.trim(), color, sensitive === true]);
    await audit(pool, request.actor, 'semaphore.category_created', id);
    return { id };
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>('/api/elections/:id/people', { preHandler: readLight }, async (request) => {
    const query = foldText(request.query.q ?? '').trim();
    if (query.length < 2) return { people: [] };
    const rows = await pool.query(
      `SELECT x.id, x.full_name, x.order_number, t.name AS table_name, m.category_id, m.sealed
       FROM electors x LEFT JOIN polling_tables t ON t.id = x.table_id
       LEFT JOIN semaphore_marks m ON m.election_id = x.election_id AND m.elector_id = x.id
       WHERE x.election_id = $1 AND x.search LIKE '%' || $2 || '%' ORDER BY x.search LIMIT 25`,
      [request.params.id, query],
    );
    const sensitive = can(request.actor, 'semaphore.sensitive');
    if (rows.rows.some((row) => row.sealed) && sensitive) await audit(pool, request.actor, 'semaphore.sensitive_viewed', request.params.id, { rows: rows.rows.length });
    return {
      people: rows.rows.map((row) => ({
        id: row.id, name: row.full_name, order: row.order_number, table: row.table_name,
        category: row.sealed ? (sensitive ? unseal(row.sealed) : null) : row.category_id,
      })),
    };
  });

  app.put<{ Params: { id: string; elector: string }; Body: { category?: unknown } }>('/api/elections/:id/people/:elector/semaphore', { preHandler: writeLight }, async (request, reply) => {
    const { id, elector } = request.params;
    const { category } = request.body ?? {};
    if (category === null) {
      await pool.query('DELETE FROM semaphore_marks WHERE election_id = $1 AND elector_id = $2', [id, elector]);
      await audit(pool, request.actor, 'semaphore.cleared', elector);
      return { ok: true };
    }
    if (typeof category !== 'string') return reply.code(400).send({ error: 'invalid_category' });
    const found = await pool.query('SELECT sensitive FROM semaphore_categories WHERE id = $1', [category]);
    if (!found.rows[0]) return reply.code(404).send({ error: 'no_such_category' });
    const sensitive = found.rows[0].sensitive;
    if (sensitive && !can(request.actor, 'semaphore.sensitive')) return reply.code(403).send({ error: 'forbidden' });
    await pool.query(
      `INSERT INTO semaphore_marks (election_id, elector_id, category_id, sealed, noted_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (election_id, elector_id) DO UPDATE SET category_id = $3, sealed = $4, noted_by = $5, noted_at = now()`,
      [id, elector, sensitive ? null : category, sensitive ? seal(category) : null, request.actor.userId],
    );
    await audit(pool, request.actor, 'semaphore.noted', elector, { sensitive });
    return { ok: true };
  });

  // ---------- A person's rights: arts. 14 to 16 of the personal data law ----------
  const managePersons = requires(pool, 'persons.manage');

  app.get<{ Querystring: { q?: string } }>('/api/persons', { preHandler: managePersons }, async (request) => {
    const query = foldText(request.query.q ?? '').trim();
    if (query.length < 3) return { people: [] };
    const rows = await pool.query(
      `SELECT x.election_id, e.name AS election, x.id, x.full_name, x.document, x.file_number, x.address, x.consent, t.name AS table_name, m.elector_id IS NOT NULL AS has_mark
       FROM electors x JOIN elections e ON e.id = x.election_id LEFT JOIN polling_tables t ON t.id = x.table_id
       LEFT JOIN semaphore_marks m ON m.election_id = x.election_id AND m.elector_id = x.id
       WHERE x.search LIKE '%' || $1 || '%' ORDER BY x.search LIMIT 25`,
      [query],
    );
    await audit(pool, request.actor, 'person.searched');
    return { people: rows.rows };
  });

  app.get<{ Params: { election: string; id: string } }>('/api/persons/:election/:id/export', { preHandler: managePersons }, async (request, reply) => {
    const { election, id } = request.params;
    const person = await pool.query('SELECT * FROM electors WHERE election_id = $1 AND id = $2', [election, id]);
    if (!person.rows[0]) return reply.code(404).send({ error: 'not_found' });
    const mark = await pool.query('SELECT category_id, sealed, noted_at FROM semaphore_marks WHERE election_id = $1 AND elector_id = $2', [election, id]);
    const voted = await pool.query(`SELECT device_time FROM operations WHERE table_id = $1 AND type = 'voter.marked' AND payload->>'elector' = $2`, [person.rows[0].table_id, id]);
    await audit(pool, request.actor, 'person.exported', id);
    const row = mark.rows[0];
    const category = row && (row.sealed ? unseal(row.sealed) : row.category_id);
    const name = category && (await pool.query('SELECT name FROM semaphore_categories WHERE id = $1', [category])).rows[0]?.name;
    const { search: _search, ...data } = person.rows[0];
    return { person: data, semaphore: name ?? null, markedVoted: voted.rows.map((r) => r.device_time) };
  });

  app.put<{ Params: { election: string; id: string }; Body: { date?: unknown; means?: unknown } }>('/api/persons/:election/:id/consent', { preHandler: managePersons }, async (request, reply) => {
    const { date, means } = request.body ?? {};
    if (typeof date !== 'string' || typeof means !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    await pool.query('UPDATE electors SET consent = $3 WHERE election_id = $1 AND id = $2', [request.params.election, request.params.id, JSON.stringify({ date, means })]);
    await audit(pool, request.actor, 'person.consent', request.params.id);
    return { ok: true };
  });

  /** The name and contact go; the row stays anonymous, so that a table's totals still add up. */
  app.delete<{ Params: { election: string; id: string } }>('/api/persons/:election/:id', { preHandler: managePersons }, async (request) => {
    const { election, id } = request.params;
    await pool.query('DELETE FROM semaphore_marks WHERE election_id = $1 AND elector_id = $2', [election, id]);
    await pool.query(`UPDATE electors SET full_name = 'Borrado a pedido', search = '', document = NULL, file_number = NULL, address = NULL, extra = '{}', review = NULL, consent = NULL WHERE election_id = $1 AND id = $2`, [election, id]);
    await audit(pool, request.actor, 'person.erased', id);
    return { ok: true };
  });

  /** After the election: no names remain. Only totals per table are kept. */
  app.post<{ Params: { id: string } }>('/api/elections/:id/purge', { preHandler: requires(pool, 'election.manage') }, async (request, reply) => {
    const { id } = request.params;
    const status = await pool.query('SELECT status FROM elections WHERE id = $1', [id]);
    if (status.rows[0]?.status !== 'cerrada') return reply.code(409).send({ error: 'close_it_first' });
    await pool.query('DELETE FROM semaphore_marks WHERE election_id = $1', [id]);
    await pool.query(`UPDATE electors SET full_name = '', search = '', document = NULL, file_number = NULL, address = NULL, extra = '{}', review = NULL, consent = NULL WHERE election_id = $1`, [id]);
    await pool.query(`DELETE FROM operations WHERE table_id IN (SELECT id FROM polling_tables WHERE election_id = $1) AND type IN ('voter.marked', 'voter.unmarked')`, [id]);
    await pool.query(`UPDATE elections SET status = 'purgada' WHERE id = $1`, [id]);
    await audit(pool, request.actor, 'election.purged', id);
    return { status: 'purgada' };
  });

  app.get<{ Querystring: { before?: string } }>('/api/audit', { preHandler: requires(pool, 'audit.read') }, async (request) => {
    const before = Number(request.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = await pool.query(
      `SELECT l.id, l.at, l.action, l.target, u.name AS who FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
       WHERE l.id < $1 ORDER BY l.id DESC LIMIT 100`,
      [before],
    );
    return { entries: rows.rows };
  });
}
