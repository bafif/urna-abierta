import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { foldText, MAX_BATCH, parseOperation, SECURITY_PROFILES, type Operation } from '@urna-abierta/domain';
import { audit, authenticated, can, canReachTable, erasedId, getSetting, securityProfile, type Actor } from './actor.ts';
import { PhotoStoreUnavailable, type PhotoStore } from './photo-store.ts';

const MAX_PULL = 200;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const TABLE_ID = /^[\w-]{1,64}$/;

/** At most one write every half a minute: hearing from a phone is frequent and tells little. */
const HEARD_EVERY_MS = 30_000;
const heard = new Map<string, number>();
async function heardFrom(pool: pg.Pool, table: string): Promise<void> {
  if (Date.now() - (heard.get(table) ?? 0) < HEARD_EVERY_MS) return;
  heard.set(table, Date.now());
  await pool.query('UPDATE polling_tables SET last_contact = now() WHERE id = $1', [table]);
}

/**
 * Stores a batch in one transaction. Locking the row of the table gives every operation of
 * that table a number in commit order. With one global sequence, a reader could pass a number
 * whose transaction had not committed yet and never see that row.
 */
async function storeBatch(pool: pg.Pool, table: string, operations: Operation[], author: string, quarantined: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<{ last_seq: string }>('SELECT last_seq FROM polling_tables WHERE id = $1 FOR UPDATE', [table]);
    const last = Number(locked.rows[0]!.last_seq);
    const inserted = await client.query(
      `INSERT INTO operations (id, table_id, seq, type, device, device_seq, device_time, payload, author, quarantined)
       SELECT id, $1, $2 + ordinality, type, device, device_seq, device_time, payload, $9, $10
       FROM unnest($3::uuid[], $4::text[], $5::text[], $6::bigint[], $7::timestamptz[], $8::jsonb[])
         WITH ORDINALITY AS t (id, type, device, device_seq, device_time, payload, ordinality)
       ON CONFLICT (id) DO NOTHING`,
      [table, last, operations.map((o) => o.id), operations.map((o) => o.type), operations.map((o) => o.device), operations.map((o) => o.device_seq), operations.map((o) => o.device_time), operations.map((o) => JSON.stringify(o.payload)), author, quarantined],
    );
    // It writes this row anyway, so it also says the phone was heard from.
    await client.query('UPDATE polling_tables SET last_seq = $2, last_contact = now() WHERE id = $1', [table, last + (inserted.rowCount ? operations.length : 0)]);
    heard.set(table, Date.now());
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** A phone that has not heard someone was erased still names them by their old id: the mark counts, under the new one. */
async function renameErased(pool: pg.Pool, table: string, operations: Operation[]): Promise<Operation[]> {
  const named = [...new Set(operations.flatMap((o) => ('elector' in o.payload ? [o.payload.elector] : [])))];
  if (named.length === 0) return operations;
  const oldOf = new Map(named.map((id) => [erasedId(id), id]));
  const found = await pool.query(
    'SELECT x.id FROM electors x JOIN polling_tables t ON t.election_id = x.election_id WHERE t.id = $1 AND x.id = ANY($2)',
    [table, [...oldOf.keys()]],
  );
  if (found.rowCount === 0) return operations;
  const newOf = new Map(found.rows.map((row) => [oldOf.get(row.id)!, row.id as string]));
  return operations.map((o) => ('elector' in o.payload && newOf.has(o.payload.elector) ? ({ ...o, payload: { ...o.payload, elector: newOf.get(o.payload.elector)! } } as Operation) : o));
}

/** A status only changes through one route of this same process, which clears this at that moment. */
const statuses = new Map<string, string>();
export const forgetStatuses = () => statuses.clear();
async function statusOf(pool: pg.Pool, table: string): Promise<string | null> {
  const known = statuses.get(table);
  if (known) return known;
  // All the tables of that election at once: they tend to ask together, when the signal comes back.
  const found = await pool.query(
    `SELECT t.id, e.status FROM polling_tables t JOIN elections e ON e.id = t.election_id
     WHERE t.election_id = (SELECT election_id FROM polling_tables WHERE id = $1)`,
    [table],
  );
  for (const row of found.rows) statuses.set(row.id, row.status);
  return statuses.get(table) ?? null;
}

/**
 * Once the election closes, the roll and what was marked at a table are only for whoever runs the election.
 * What a phone still has to send is taken anyway, kept apart for review.
 */
async function closedFor(pool: pg.Pool, actor: Actor, table: string): Promise<boolean> {
  if (can(actor, 'election.manage')) return false;
  return ['cerrada', 'purgada'].includes((await statusOf(pool, table)) ?? '');
}

export function syncRoutes(app: FastifyInstance, pool: pg.Pool, photos: PhotoStore) {
  const signedIn = authenticated(pool);

  /** Only what the poll watcher needs: no addresses, and as few document digits as the election asks for. */
  app.get<{ Params: { table: string } }>('/api/tables/:table/bundle', { preHandler: signedIn }, async (request, reply) => {
    const { table } = request.params;
    if (!TABLE_ID.test(table)) return reply.code(400).send({ error: 'invalid_table' });
    if (!(await canReachTable(pool, request.actor, table))) return reply.code(403).send({ error: 'forbidden' });
    if (await closedFor(pool, request.actor, table)) return reply.code(410).send({ error: 'election_closed' });
    const { profile } = await securityProfile(pool);
    const digits = SECURITY_PROFILES[profile].documentDigits;
    // Only if the party allows it in a low risk election, and never a sensitive category.
    const withLight = SECURITY_PROFILES[profile].fiscalSeesSemaphore && (await getSetting(pool, 'fiscal_semaphore', false));
    const rows = await pool.query(
      `SELECT x.id, x.order_number, x.full_name, x.document, c.name AS light_name, c.color AS light_color
       FROM electors x
       LEFT JOIN semaphore_marks m ON $2 AND m.election_id = x.election_id AND m.elector_id = x.id
       LEFT JOIN semaphore_categories c ON c.id = m.category_id AND NOT c.sensitive
       WHERE x.table_id = $1 ORDER BY x.order_number NULLS LAST, x.full_name`,
      [table, withLight],
    );
    const electors = rows.rows.map((row, index) => {
      const order = row.order_number ?? index + 1;
      const documentSuffix = String(row.document ?? '').slice(-digits);
      return {
        id: row.id, order, name: row.full_name, documentSuffix, search: foldText(`${order} ${row.full_name} ${documentSuffix}`),
        ...(row.light_name ? { light: { name: row.light_name, color: row.light_color } } : {}),
      };
    });
    await audit(pool, request.actor, 'roll.downloaded', table, { people: electors.length });
    return { table, electors };
  });

  app.post<{ Body: { table?: unknown; operations?: unknown } }>('/api/sync/push', { preHandler: signedIn }, async (request, reply) => {
    const { table, operations } = request.body ?? {};
    if (typeof table !== 'string' || !TABLE_ID.test(table) || !Array.isArray(operations)) return reply.code(400).send({ error: 'invalid_request' });
    if (operations.length > MAX_BATCH) return reply.code(413).send({ error: 'batch_too_large', max: MAX_BATCH });
    if (!(await canReachTable(pool, request.actor, table))) return reply.code(403).send({ error: 'forbidden' });
    const status = await statusOf(pool, table);
    if (!status) return reply.code(404).send({ error: 'no_such_table' });
    const valid: Operation[] = [];
    const rejected: { id: unknown; reason: string }[] = [];
    for (const raw of operations) {
      const parsed = parseOperation(raw);
      if (!parsed) rejected.push({ id: (raw as { id?: unknown })?.id, reason: 'invalid' });
      else if (parsed.table !== table) rejected.push({ id: parsed.id, reason: 'wrong_table' });
      else valid.push(parsed);
    }
    // What arrives after the close may be legitimate, from a phone without signal: it is kept apart for review.
    const late = ['cerrada', 'purgada'].includes(status);
    // After the purge no one is named anymore: who voted is taken, so the phone stops sending it, and dropped.
    const kept = status === 'purgada' ? valid.filter((o) => !('elector' in o.payload)) : await renameErased(pool, table, valid);
    if (kept.length > 0) await storeBatch(pool, table, kept, request.actor.userId, late);
    else await heardFrom(pool, table);
    return { acked: valid.map((o) => o.id), rejected, server_time: new Date().toISOString() };
  });

  app.get<{ Querystring: { table?: string; since?: string } }>('/api/sync/pull', { preHandler: signedIn }, async (request, reply) => {
    const { table, since } = request.query;
    const cursor = Number(since ?? 0);
    if (!table || !TABLE_ID.test(table) || !Number.isSafeInteger(cursor) || cursor < 0) return reply.code(400).send({ error: 'invalid_request' });
    if (!(await canReachTable(pool, request.actor, table))) return reply.code(403).send({ error: 'forbidden' });
    if (await closedFor(pool, request.actor, table)) return reply.code(410).send({ error: 'election_closed' });
    const result = await pool.query(
      `SELECT id, table_id AS table, seq, type, device, device_seq, device_time, payload
       FROM operations WHERE table_id = $1 AND seq > $2 AND NOT quarantined ORDER BY seq LIMIT $3`,
      [table, cursor, MAX_PULL + 1],
    );
    const rows = result.rows.slice(0, MAX_PULL);
    await heardFrom(pool, table);
    return {
      operations: rows.map((row) => ({ id: row.id, schema: 1, table: row.table, type: row.type, device: row.device, device_seq: Number(row.device_seq), device_time: new Date(row.device_time).toISOString(), payload: row.payload })),
      next: rows.length > 0 ? Number(rows[rows.length - 1].seq) : cursor,
      more: result.rows.length > MAX_PULL,
    };
  });

  /** The photo of the tally sheet, identified by its own hash, so that repeating the upload changes nothing. */
  app.addContentTypeParser(/^image\//, { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES }, (_request, body, done) => done(null, body));
  app.put<{ Params: { table: string; sha: string }; Body: Buffer }>('/api/tables/:table/photos/:sha', { preHandler: signedIn, bodyLimit: MAX_PHOTO_BYTES }, async (request, reply) => {
    const { table, sha } = request.params;
    if (!TABLE_ID.test(table) || !/^[0-9a-f]{64}$/.test(sha)) return reply.code(400).send({ error: 'invalid_request' });
    if (!(await canReachTable(pool, request.actor, table))) return reply.code(403).send({ error: 'forbidden' });
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'not_an_image' });
    if (createHash('sha256').update(request.body).digest('hex') !== sha) return reply.code(400).send({ error: 'hash_mismatch' });
    try {
      await photos.put(sha, request.body);
    } catch (error) {
      // Never somewhere else instead: the phone keeps it and sends it again.
      if (error instanceof PhotoStoreUnavailable) return reply.code(503).send({ error: 'photo_storage_unavailable' });
      throw error;
    }
    await pool.query('INSERT INTO photos (sha256, table_id, bytes) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [sha, table, request.body.length]);
    return { ok: true };
  });

  app.get<{ Params: { table: string; sha: string } }>('/api/tables/:table/photos/:sha', { preHandler: signedIn }, async (request, reply) => {
    const { table, sha } = request.params;
    if (!/^[0-9a-f]{64}$/.test(sha)) return reply.code(400).send({ error: 'invalid_request' });
    if (!(await canReachTable(pool, request.actor, table))) return reply.code(403).send({ error: 'forbidden' });
    // A tally sheet has no names: the chief can still look at it, the poll watcher's work is over.
    if (!can(request.actor, 'district.watch') && (await closedFor(pool, request.actor, table))) return reply.code(410).send({ error: 'election_closed' });
    const known = await pool.query('SELECT 1 FROM photos WHERE sha256 = $1 AND table_id = $2', [sha, table]);
    if (!known.rowCount) return reply.code(404).send({ error: 'not_found' });
    let bytes: Buffer | null;
    try {
      bytes = await photos.get(sha);
    } catch (error) {
      if (error instanceof PhotoStoreUnavailable) return reply.code(503).send({ error: 'photo_storage_unavailable' });
      throw error;
    }
    if (!bytes) return reply.code(404).send({ error: 'not_found' });
    return reply.type('image/jpeg').send(bytes);
  });
}
