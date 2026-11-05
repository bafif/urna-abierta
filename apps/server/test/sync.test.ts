import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { uuidv7, type Operation } from '@urna-abierta/domain';
import { buildApp, migrate } from '../src/app.ts';

const url = process.env.TEST_DATABASE_URL;

function operation(table: string, seq: number, elector = `e-${seq}`): Operation {
  return {
    id: uuidv7(),
    schema: 1,
    table,
    device: 'd-1',
    device_seq: seq,
    device_time: '2027-04-06T12:00:00.000Z',
    type: 'voter.marked',
    payload: { elector },
  };
}

describe.skipIf(!url)('sync against a real Postgres', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  const push = (table: string, operations: unknown[]) =>
    app.inject({ method: 'POST', url: '/api/sync/push', payload: { table, operations } });

  async function pullAll(table: string): Promise<Operation[]> {
    const all: Operation[] = [];
    let since = 0;
    for (;;) {
      const response = await app.inject({ url: `/api/sync/pull?table=${table}&since=${since}` });
      const body = response.json();
      all.push(...body.operations);
      since = body.next;
      if (!body.more) return all;
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    await migrate(pool);
    app = buildApp(pool);
    await app.ready();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE operations, electors, polling_tables');
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('stores an operation only once when the phone sends it again', async () => {
    const batch = [operation('m-1', 1), operation('m-1', 2)];
    for (let i = 0; i < 3; i += 1) {
      const response = await push('m-1', batch);
      expect(response.statusCode).toBe(200);
      expect(response.json().acked).toHaveLength(2);
    }
    expect(await pullAll('m-1')).toHaveLength(2);
  });

  it('a repeated operation inside the same batch is stored once', async () => {
    const one = operation('m-1', 1);
    expect((await push('m-1', [one, one])).statusCode).toBe(200);
    expect(await pullAll('m-1')).toHaveLength(1);
  });

  it('refuses a malformed operation without blocking the valid ones', async () => {
    const good = operation('m-1', 1);
    const response = await push('m-1', [{ ...operation('m-1', 2), id: 'not-a-uuid' }, good]);
    expect(response.statusCode).toBe(200);
    expect(response.json().acked).toEqual([good.id]);
    expect(response.json().rejected).toHaveLength(1);
    expect(await pullAll('m-1')).toHaveLength(1);
  });

  it('refuses an operation that belongs to another table', async () => {
    const response = await push('m-1', [operation('m-2', 1)]);
    expect(response.json().rejected[0].reason).toBe('wrong_table');
  });

  it('refuses a batch that is too large', async () => {
    const big = Array.from({ length: 51 }, (_, i) => operation('m-1', i));
    expect((await push('m-1', big)).statusCode).toBe(413);
  });

  it('a reader never skips an operation while several phones write at once', async () => {
    const phones = 12;
    const batches = 8;
    const size = 10;
    let done = false;
    const seen = new Set<string>();
    let since = 0;
    const reader = (async () => {
      while (!done) {
        const body = (await app.inject({ url: `/api/sync/pull?table=m-1&since=${since}` })).json();
        for (const item of body.operations) seen.add(item.id);
        since = body.next;
      }
    })();
    const expected = new Set<string>();
    await Promise.all(
      Array.from({ length: phones }, async (_, phone) => {
        for (let b = 0; b < batches; b += 1) {
          const batch = Array.from({ length: size }, (_, i) => operation('m-1', phone * 1000 + b * 100 + i));
          for (const item of batch) expected.add(item.id);
          expect((await push('m-1', batch)).statusCode).toBe(200);
        }
      }),
    );
    done = true;
    await reader;
    for (;;) {
      const body = (await app.inject({ url: `/api/sync/pull?table=m-1&since=${since}` })).json();
      for (const item of body.operations) seen.add(item.id);
      since = body.next;
      if (body.operations.length === 0) break;
    }
    expect(seen.size).toBe(expected.size);
    expect([...expected].every((id) => seen.has(id))).toBe(true);
  });

  it('keeps each table apart and pages long histories', async () => {
    await push('m-1', Array.from({ length: 50 }, (_, i) => operation('m-1', i)));
    for (let page = 0; page < 5; page += 1) {
      await push('m-2', Array.from({ length: 50 }, (_, i) => operation('m-2', page * 100 + i)));
    }
    expect(await pullAll('m-1')).toHaveLength(50);
    expect(await pullAll('m-2')).toHaveLength(250);
  });

  it('counts who voted, keeping a mark made at the same time as an undo', async () => {
    const mine = operation('m-1', 1, 'e-1');
    const theirs = operation('m-1', 2, 'e-1');
    const other = operation('m-1', 3, 'e-2');
    const undo: Operation = {
      ...operation('m-1', 4),
      type: 'voter.unmarked',
      payload: { elector: 'e-1', cancels: [mine.id] },
    };
    const undoOther: Operation = {
      ...operation('m-1', 5),
      type: 'voter.unmarked',
      payload: { elector: 'e-2', cancels: [other.id] },
    };
    await push('m-1', [mine, theirs, other, undo, undoOther]);
    const summary = (await app.inject({ url: '/api/tables/m-1/summary' })).json();
    expect(summary.voted).toBe(1);
  });

  it('answers 400 to an invalid request', async () => {
    expect((await app.inject({ url: '/api/sync/pull?table=a%20b&since=0' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/sync/pull?table=m-1&since=-1' })).statusCode).toBe(400);
    expect((await push('bad table', [])).statusCode).toBe(400);
  });
});
