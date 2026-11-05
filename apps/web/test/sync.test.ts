import { describe, expect, it } from 'vitest';
import { MAX_BATCH, uuidv7, type Operation } from '@urna-abierta/domain';
import { retryDelay, syncOnce, type SyncStore } from '../src/lib/sync.ts';

function makeOperation(seq: number): Operation {
  return {
    id: uuidv7(),
    schema: 1,
    table: 'm-1',
    device: 'd-1',
    device_seq: seq,
    device_time: '2027-04-06T12:00:00.000Z',
    type: 'voter.marked',
    payload: { elector: `e-${seq}` },
  };
}

function memoryStore(operations: Operation[]) {
  const state = { queue: [...operations], quarantined: [] as string[], remote: [] as Operation[], cursor: 0 };
  const store: SyncStore = {
    pending: async (limit) => state.queue.slice(0, limit),
    acknowledge: async (ids) => {
      state.queue = state.queue.filter((operation) => !ids.includes(operation.id));
    },
    quarantine: async (ids) => {
      state.quarantined.push(...ids);
      state.queue = state.queue.filter((operation) => !ids.includes(operation.id));
    },
    addRemote: async (incoming) => {
      state.remote.push(...incoming);
    },
    cursor: async () => state.cursor,
    setCursor: async (value) => {
      state.cursor = value;
    },
  };
  return { store, state };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function server(options: { rejectIds?: string[] } = {}) {
  const received: Operation[][] = [];
  const request = (async (url: string, init?: RequestInit) => {
    if (String(url).includes('/sync/push')) {
      const operations = JSON.parse(String(init?.body)).operations as Operation[];
      received.push(operations);
      const rejected = operations.filter((o) => options.rejectIds?.includes(o.id)).map((o) => ({ id: o.id, reason: 'invalid' }));
      return json({ acked: operations.filter((o) => !options.rejectIds?.includes(o.id)).map((o) => o.id), rejected });
    }
    return json({ operations: [], next: 7, more: false });
  }) as typeof fetch;
  return { received, request };
}

describe('syncOnce', () => {
  it('sends everything in small batches and advances the cursor', async () => {
    const { store, state } = memoryStore(Array.from({ length: 120 }, (_, i) => makeOperation(i)));
    const { received, request } = server();
    expect(await syncOnce(store, 'm-1', '/api', request)).toBe('done');
    expect(state.queue).toHaveLength(0);
    expect(received.every((batch) => batch.length <= MAX_BATCH)).toBe(true);
    expect(received.flat()).toHaveLength(120);
    expect(state.cursor).toBe(7);
  });

  it('keeps every operation in the queue when there is no connection', async () => {
    const { store, state } = memoryStore([makeOperation(1), makeOperation(2)]);
    const offline = (async () => {
      throw new TypeError('network');
    }) as typeof fetch;
    expect(await syncOnce(store, 'm-1', '/api', offline)).toBe('failed');
    expect(state.queue).toHaveLength(2);
  });

  it('keeps the queue when the server fails, and stops instead of looping', async () => {
    const { store, state } = memoryStore([makeOperation(1)]);
    let calls = 0;
    const failing = (async () => {
      calls += 1;
      return json({ error: 'boom' }, 500);
    }) as typeof fetch;
    expect(await syncOnce(store, 'm-1', '/api', failing)).toBe('failed');
    expect(state.queue).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it('does not lose the rest of the queue when the connection drops midway', async () => {
    const { store, state } = memoryStore(Array.from({ length: 80 }, (_, i) => makeOperation(i)));
    let pushes = 0;
    const flaky = (async (url: string, init?: RequestInit) => {
      if (pushes++ === 0) {
        const operations = JSON.parse(String(init?.body)).operations as Operation[];
        return json({ acked: operations.map((o) => o.id), rejected: [] });
      }
      throw new TypeError(`dropped ${url}`);
    }) as typeof fetch;
    expect(await syncOnce(store, 'm-1', '/api', flaky)).toBe('failed');
    expect(state.queue).toHaveLength(30);
  });

  it('sets aside what the server refuses so it does not block the others', async () => {
    const bad = makeOperation(1);
    const good = makeOperation(2);
    const { store, state } = memoryStore([bad, good]);
    const { request } = server({ rejectIds: [bad.id] });
    expect(await syncOnce(store, 'm-1', '/api', request)).toBe('done');
    expect(state.queue).toHaveLength(0);
    expect(state.quarantined).toEqual([bad.id]);
  });

  it('stops if the server answers without acknowledging anything', async () => {
    const { store, state } = memoryStore([makeOperation(1)]);
    const silent = (async () => json({ acked: [], rejected: [] })) as typeof fetch;
    expect(await syncOnce(store, 'm-1', '/api', silent)).toBe('failed');
    expect(state.queue).toHaveLength(1);
  });
});

describe('retryDelay', () => {
  it('grows with failures, has a ceiling and is spread at random', () => {
    expect(retryDelay(0, () => 0)).toBe(2_500);
    expect(retryDelay(0, () => 1)).toBe(5_000);
    expect(retryDelay(3, () => 1)).toBe(40_000);
    expect(retryDelay(50, () => 1)).toBe(300_000);
  });
});
