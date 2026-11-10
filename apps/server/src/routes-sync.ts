import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { foldText, MAX_BATCH, MAX_PHOTO_BYTES, parseOperation, SECURITY_PROFILES, type Operation, type RollEntry } from '@urna-abierta/domain';
import { audit, auditView, authenticated, can, canReachTable, erasedId, getSetting, securityProfile, type Actor } from './actor.ts';
import { clock } from './clock.ts';
import { PhotoStoreUnavailable, type PhotoStore } from './photo-store.ts';

const MAX_PULL = 200;
const TABLE_ID = /^[\w-]{1,64}$/;

/** At most one write every half a minute: hearing from a phone is frequent and tells little. */
const HEARD_EVERY_MS = 30_000;
const heard = new Map<string, number>();
async function heardFrom(pool: pg.Pool, table: string): Promise<void> {
  if (Date.now() - (heard.get(table) ?? 0) < HEARD_EVERY_MS) return;
  heard.set(table, Date.now());
  await pool.query('UPDATE polling_tables SET last_contact = now() WHERE id = $1', [table]);
}

type VoterOperation = Extract<Operation, { type: 'voter.marked' | 'voter.unmarked' }>;
const isVoter = (operation: Operation): operation is VoterOperation => operation.type === 'voter.marked' || operation.type === 'voter.unmarked';

/**
 * Stores a batch in one transaction. Locking the row of the table gives every operation of
 * that table a number in commit order. With one global sequence, a reader could pass a number
 * whose transaction had not committed yet and never see that row. Erasing a person and purging
 * the election take the same lock, so who is named is decided here, after it: never with an id
 * that an erasure or a purge committed meanwhile took away.
 */
async function storeBatch(pool: pg.Pool, table: string, received: Operation[], author: string): Promise<{ late: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<{ last_seq: string }>('SELECT last_seq FROM polling_tables WHERE id = $1 FOR UPDATE', [table]);
    const last = Number(locked.rows[0]!.last_seq);
    // Read after the lock, in a statement of its own: one that had to wait for it would still see the status from before.
    const { status } = (await client.query<{ status: string }>('SELECT e.status FROM polling_tables t JOIN elections e ON e.id = t.election_id WHERE t.id = $1', [table])).rows[0]!;
    // What arrives after the close may be legitimate, from a phone without signal: it is kept apart for review.
    const quarantined = ['cerrada', 'purgada'].includes(status);
    // After the purge nobody's vote is kept, not even from a phone that was offline for days. The phone still hears it arrived, so it stops sending it.
    const kept = status === 'purgada' ? received.filter((operation) => !isVoter(operation)) : await usePublicIds(client, table, received);
    const inserted = kept.length === 0 ? { rowCount: 0 } : await client.query(
      `INSERT INTO operations (id, table_id, seq, type, device, device_seq, device_time, payload, author, quarantined)
       SELECT id, $1, $2 + ordinality, type, device, device_seq, device_time, payload, $9, $10
       FROM unnest($3::uuid[], $4::text[], $5::text[], $6::bigint[], $7::timestamptz[], $8::jsonb[])
         WITH ORDINALITY AS t (id, type, device, device_seq, device_time, payload, ordinality)
       ON CONFLICT (id) DO NOTHING`,
      [table, last, kept.map((o) => o.id), kept.map((o) => o.type), kept.map((o) => o.device), kept.map((o) => o.device_seq), kept.map((o) => o.device_time), kept.map((o) => JSON.stringify(o.payload)), author, quarantined],
    );
    // It writes this row anyway, so it also says the phone was heard from.
    await client.query('UPDATE polling_tables SET last_seq = $2, last_contact = now() WHERE id = $1', [table, last + (inserted.rowCount ? kept.length : 0)]);
    heard.set(table, Date.now());
    await client.query('COMMIT');
    return { late: quarantined };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Phones know people by a random id. One prepared before those ids still names them by the id of the roll until it
 * refreshes, and that id, often the DNI, never gets stored: it is swapped here for the random one, also when the
 * person was erased meanwhile and the roll id went with it. Erasures take the same lock as a batch, so this runs
 * after it. Only people of this same table: naming someone of another table must not tell whether they are on the roll.
 */
async function usePublicIds(client: pg.PoolClient, table: string, operations: Operation[]): Promise<Operation[]> {
  const named = [...new Set(operations.filter(isVoter).map((operation) => operation.payload.elector))];
  if (named.length === 0) return operations;
  const erased = new Map(named.map((id) => [erasedId(id), id]));
  const found = await client.query(
    'SELECT id, public_id FROM electors WHERE table_id = $1 AND (id = ANY($2) OR id = ANY($3))',
    [table, named, [...erased.keys()]],
  );
  const publicId = new Map<string, string>(found.rows.map((row) => [erased.get(row.id) ?? row.id, row.public_id]));
  return operations.map((operation) =>
    isVoter(operation) && publicId.has(operation.payload.elector) ? ({ ...operation, payload: { ...operation.payload, elector: publicId.get(operation.payload.elector)! } } as Operation) : operation,
  );
}

/** A status only changes through two routes of this same process, the step forward and the purge, which clear this at that moment. */
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

/** The roll of a table as phones get it. The id that comes from the roll stays on the server: it can be the whole document. */
export async function tableRoll(pool: pg.Pool, table: string): Promise<RollEntry[]> {
  const { profile } = await securityProfile(pool);
  const digits = SECURITY_PROFILES[profile].documentDigits;
  // Only if the party allows it in a low risk election, and never a sensitive category.
  const withLight = SECURITY_PROFILES[profile].fiscalSeesSemaphore && (await getSetting(pool, 'fiscal_semaphore', false));
  const rows = await pool.query(
    `SELECT x.public_id, x.order_number, x.full_name, x.document, c.name AS light_name, c.color AS light_color
     FROM electors x
     LEFT JOIN semaphore_marks m ON $2 AND m.election_id = x.election_id AND m.elector_id = x.id
     LEFT JOIN semaphore_categories c ON c.id = m.category_id AND NOT c.sensitive
     WHERE x.table_id = $1 ORDER BY x.order_number NULLS LAST, x.full_name`,
    [table, withLight],
  );
  return rows.rows.map((row, index) => {
    const order = row.order_number ?? index + 1;
    const documentSuffix = String(row.document ?? '').slice(-digits);
    return {
      id: row.public_id, order, name: row.full_name, documentSuffix, search: foldText(`${order} ${row.full_name} ${documentSuffix}`),
      ...(row.light_name ? { light: { name: row.light_name, color: row.light_color } } : {}),
    };
  });
}

/** Changes whenever what a phone holds of its table would: someone added, moved, renamed, a light, the digits shown. */
export const rollRevision = (electors: RollEntry[]) => createHash('sha256').update(JSON.stringify(electors)).digest('base64url').slice(0, 22);

/**
 * Once the election closes, the roll and what was marked at a table are only for whoever runs the election.
 * What a phone still has to send is taken anyway, kept apart for review.
 */
async function closedFor(pool: pg.Pool, actor: Actor, table: string): Promise<boolean> {
  if (can(actor, 'election.manage')) return false;
  return ['cerrada', 'purgada'].includes((await statusOf(pool, table)) ?? '');
}

/**
 * A table this person had in an election that got deleted: the phone hears it like a close, asks who it is again and
 * lets go of that table. Anyone else is told only that it is not theirs.
 */
async function refuse(pool: pg.Pool, actor: Actor, table: string, reply: FastifyReply) {
  const deleted = await pool.query('SELECT 1 FROM deleted_tables WHERE user_id = $1 AND table_id = $2', [actor.userId, table]);
  return deleted.rowCount ? reply.code(410).send({ error: 'election_deleted' }) : reply.code(403).send({ error: 'forbidden' });
}

export function syncRoutes(app: FastifyInstance, pool: pg.Pool, photos: PhotoStore) {
  const signedIn = authenticated(pool);

  /** Only what the poll watcher needs: no addresses, a random id for each person, and as few document digits as the election asks for. */
  app.get<{ Params: { table: string } }>('/api/tables/:table/bundle', { preHandler: signedIn }, async (request, reply) => {
    const { table } = request.params;
    if (!TABLE_ID.test(table)) return reply.code(400).send({ error: 'invalid_table' });
    if (!(await canReachTable(pool, request.actor, table))) return refuse(pool, request.actor, table, reply);
    if (await closedFor(pool, request.actor, table)) return reply.code(410).send({ error: 'election_closed' });
    const electors = await tableRoll(pool, table);
    await audit(pool, request.actor, 'roll.downloaded', table, { people: electors.length });
    return { table, electors, revision: rollRevision(electors) };
  });

  app.post<{ Body: { table?: unknown; operations?: unknown } }>('/api/sync/push', { preHandler: signedIn }, async (request, reply) => {
    const { table, operations } = request.body ?? {};
    if (typeof table !== 'string' || !TABLE_ID.test(table) || !Array.isArray(operations)) return reply.code(400).send({ error: 'invalid_request' });
    if (operations.length > MAX_BATCH) return reply.code(413).send({ error: 'batch_too_large', max: MAX_BATCH });
    if (!(await canReachTable(pool, request.actor, table))) return refuse(pool, request.actor, table, reply);
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
    const stored = valid.length > 0 ? await storeBatch(pool, table, valid, request.actor.userId) : (await heardFrom(pool, table), { late: false });
    // The phone must not say that everything arrived fine when it arrived after the close: someone still has to look at it.
    return { acked: valid.map((o) => o.id), rejected, server_time: clock.now().toISOString(), ...(stored.late ? { late: true } : {}) };
  });

  app.get<{ Querystring: { table?: string; since?: string } }>('/api/sync/pull', { preHandler: signedIn }, async (request, reply) => {
    const { table, since } = request.query;
    const cursor = Number(since ?? 0);
    if (!table || !TABLE_ID.test(table) || !Number.isSafeInteger(cursor) || cursor < 0) return reply.code(400).send({ error: 'invalid_request' });
    if (!(await canReachTable(pool, request.actor, table))) return refuse(pool, request.actor, table, reply);
    if (await closedFor(pool, request.actor, table)) return reply.code(410).send({ error: 'election_closed' });
    // What a table marked names people: a poll watcher reads their own all day, anyone else is recorded.
    if (!request.actor.assignments.some((a) => a.role === 'fiscal' && a.table_id === table)) await auditView(pool, request.actor, 'table.pulled', table);
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
      server_time: clock.now().toISOString(),
    };
  });

  /** The photo of the tally sheet, identified by its own hash, so that repeating the upload changes nothing. */
  app.addContentTypeParser(/^image\//, { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES }, (_request, body, done) => done(null, body));
  app.put<{ Params: { table: string; sha: string }; Body: Buffer }>('/api/tables/:table/photos/:sha', { onRequest: signedIn, bodyLimit: MAX_PHOTO_BYTES }, async (request, reply) => {
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
