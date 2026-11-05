import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { fakeRoll, MarkState, MAX_BATCH, parseOperation, type Operation } from '@urna-abierta/domain';

const MAX_PULL = 200;
const SUMMARY_CACHE_MS = 5_000;
const TABLE_ID = /^[\w-]{1,64}$/;

export async function migrate(pool: pg.Pool): Promise<void> {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

/**
 * Stores a batch in one transaction. Locking the row of the table gives every operation of
 * that table a number in commit order. With one global sequence, a reader could pass a number
 * whose transaction had not committed yet and never see that row.
 */
async function storeBatch(pool: pg.Pool, table: string, operations: Operation[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO polling_tables (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [table]);
    const locked = await client.query<{ last_seq: string }>(
      'SELECT last_seq FROM polling_tables WHERE id = $1 FOR UPDATE',
      [table],
    );
    const last = Number(locked.rows[0]!.last_seq);
    const inserted = await client.query(
      `INSERT INTO operations (id, table_id, seq, type, device, device_seq, device_time, payload)
       SELECT id, $1, $2 + ordinality, type, device, device_seq, device_time, payload
       FROM unnest($3::uuid[], $4::text[], $5::text[], $6::bigint[], $7::timestamptz[], $8::jsonb[])
         WITH ORDINALITY AS t (id, type, device, device_seq, device_time, payload, ordinality)
       ON CONFLICT (id) DO NOTHING`,
      [
        table,
        last,
        operations.map((o) => o.id),
        operations.map((o) => o.type),
        operations.map((o) => o.device),
        operations.map((o) => o.device_seq),
        operations.map((o) => o.device_time),
        operations.map((o) => JSON.stringify(o.payload)),
      ],
    );
    if (inserted.rowCount) {
      await client.query('UPDATE polling_tables SET last_seq = $2 WHERE id = $1', [table, last + operations.length]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function buildApp(pool: pg.Pool): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024 });
  const summaries = new Map<string, { at: number; voted: number; last_seq: number }>();

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  app.get<{ Params: { table: string }; Querystring: { size?: string } }>(
    '/api/tables/:table/bundle',
    async (request, reply) => {
      const { table } = request.params;
      if (!TABLE_ID.test(table)) return reply.code(400).send({ error: 'invalid_table' });
      const size = Math.min(Number(request.query.size) || 350, 20_000);
      return { table, source: 'fake', electors: fakeRoll(size, 1) };
    },
  );

  app.post<{ Body: { table?: unknown; operations?: unknown } }>('/api/sync/push', async (request, reply) => {
    const { table, operations } = request.body ?? {};
    if (typeof table !== 'string' || !TABLE_ID.test(table) || !Array.isArray(operations)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    if (operations.length > MAX_BATCH) return reply.code(413).send({ error: 'batch_too_large', max: MAX_BATCH });
    const valid: Operation[] = [];
    const rejected: { id: unknown; reason: string }[] = [];
    for (const raw of operations) {
      const parsed = parseOperation(raw);
      if (!parsed) rejected.push({ id: (raw as { id?: unknown })?.id, reason: 'invalid' });
      else if (parsed.table !== table) rejected.push({ id: parsed.id, reason: 'wrong_table' });
      else valid.push(parsed);
    }
    if (valid.length > 0) await storeBatch(pool, table, valid);
    return { acked: valid.map((o) => o.id), rejected, server_time: new Date().toISOString() };
  });

  app.get<{ Querystring: { table?: string; since?: string } }>('/api/sync/pull', async (request, reply) => {
    const { table, since } = request.query;
    const cursor = Number(since ?? 0);
    if (!table || !TABLE_ID.test(table) || !Number.isSafeInteger(cursor) || cursor < 0) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const result = await pool.query(
      `SELECT id, table_id AS table, seq, type, device, device_seq, device_time, payload
       FROM operations WHERE table_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [table, cursor, MAX_PULL + 1],
    );
    const rows = result.rows.slice(0, MAX_PULL);
    return {
      operations: rows.map((row) => ({
        id: row.id,
        schema: 1,
        table: row.table,
        type: row.type,
        device: row.device,
        device_seq: Number(row.device_seq),
        device_time: new Date(row.device_time).toISOString(),
        payload: row.payload,
      })),
      next: rows.length > 0 ? Number(rows[rows.length - 1].seq) : cursor,
      more: result.rows.length > MAX_PULL,
    };
  });

  /** What a district chief polls. Counted once every few seconds, however many are watching. */
  app.get<{ Params: { table: string } }>('/api/tables/:table/summary', async (request, reply) => {
    const { table } = request.params;
    if (!TABLE_ID.test(table)) return reply.code(400).send({ error: 'invalid_table' });
    const cached = summaries.get(table);
    if (cached && Date.now() - cached.at < SUMMARY_CACHE_MS) return cached;
    const result = await pool.query(
      `SELECT id, type, payload FROM operations
       WHERE table_id = $1 AND type IN ('voter.marked', 'voter.unmarked')`,
      [table],
    );
    const state = new MarkState();
    for (const row of result.rows) {
      state.apply({ id: row.id, type: row.type, payload: row.payload } as Operation);
    }
    const seq = await pool.query<{ last_seq: string }>('SELECT last_seq FROM polling_tables WHERE id = $1', [table]);
    const summary = { at: Date.now(), voted: state.voters().length, last_seq: Number(seq.rows[0]?.last_seq ?? 0) };
    summaries.set(table, summary);
    return summary;
  });

  return app;
}
