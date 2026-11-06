import { describe, expect, it } from 'vitest';
import { MAX_BATCH, uuidv7, type Operation } from '@urna-abierta/domain';
import { photoTimeout, pullAll, pushNow, retryDelay, sendPhoto, syncOnce, type SyncStore } from '../src/lib/sync.ts';

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

  it('after the close it still sends what was waiting, and then hears the table is closed', async () => {
    const { store, state } = memoryStore([makeOperation(1)]);
    const closed = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/sync/push')) return json({ acked: JSON.parse(String(init?.body)).operations.map((o: Operation) => o.id), rejected: [] });
      return json({ error: 'election_closed' }, 410);
    }) as typeof fetch;
    expect(await syncOnce(store, 'm-1', '/api', closed)).toBe('closed');
    expect(state.queue).toHaveLength(0);
  });
});

/** A connection that takes a request and never answers, until the phone gives up on it. */
const hanging = (async (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;

describe('the clock of the server', () => {
  it('says how far ahead the server is, against the middle of the request', async () => {
    const { store } = memoryStore([makeOperation(1)]);
    const offsets: number[] = [];
    store.serverTime = (offset) => offsets.push(offset);
    const ahead = 3 * 3_600_000;
    const request = (async (url: string, init?: RequestInit) => {
      const server_time = new Date(Date.now() + ahead).toISOString();
      if (String(url).includes('/sync/push')) return json({ acked: JSON.parse(String(init?.body)).operations.map((o: Operation) => o.id), rejected: [], server_time });
      return json({ operations: [], next: 1, more: false, server_time });
    }) as typeof fetch;
    expect(await syncOnce(store, 'm-1', '/api', request)).toBe('done');
    expect(offsets).toHaveLength(2);
    for (const offset of offsets) expect(Math.abs(offset - ahead)).toBeLessThan(1_000);
  });
});

describe('pushNow, for an urgent alert', () => {
  it('sends only that operation, not the marks queued before it', async () => {
    const marks = Array.from({ length: 120 }, (_, i) => makeOperation(i));
    const alert = { ...makeOperation(999), type: 'incident.reported', payload: { kind: 'urgent' } } as Operation;
    const { store, state } = memoryStore([...marks, alert]);
    const { received, request } = server();
    expect(await pushNow(store, 'm-1', [alert], '/api', request, 8_000)).toBe(true);
    expect(received).toEqual([[alert]]);
    expect(state.queue).toHaveLength(120);
  });

  it('gives up in the time it was given, so that the plan B shows at once', async () => {
    const alert = makeOperation(1);
    const { store, state } = memoryStore([alert]);
    const started = Date.now();
    expect(await pushNow(store, 'm-1', [alert], '/api', hanging, 200)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(state.queue).toEqual([alert]);
  });

  it('is not sent if the server refuses it or fails', async () => {
    const alert = makeOperation(1);
    const { store } = memoryStore([alert]);
    expect(await pushNow(store, 'm-1', [alert], '/api', server({ rejectIds: [alert.id] }).request)).toBe(false);
    expect(await pushNow(store, 'm-1', [alert], '/api', (async () => json({ error: 'boom' }, 500)) as typeof fetch)).toBe(false);
  });
});

describe('sendPhoto', () => {
  const bytes = new Uint8Array(1000).buffer;

  it('tells a photo the server will never take from one that has to go again', async () => {
    const answer = (status: number) => (async () => json({}, status)) as typeof fetch;
    expect(await sendPhoto('/p', bytes, answer(200))).toBe('sent');
    expect(await sendPhoto('/p', bytes, answer(413))).toBe('refused');
    expect(await sendPhoto('/p', bytes, answer(400))).toBe('refused');
    expect(await sendPhoto('/p', bytes, answer(503))).toBe('failed');
    expect(await sendPhoto('/p', bytes, (async () => { throw new TypeError('network'); }) as typeof fetch)).toBe('failed');
  });

  it('never waits forever on a stalled upload, which would hold back everything after it', async () => {
    const started = Date.now();
    expect(await sendPhoto('/p', bytes, hanging, 200)).toBe('failed');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('gives a heavier photo more time, up to a ceiling', () => {
    expect(photoTimeout(300_000)).toBe(45_000);
    expect(photoTimeout(2_000_000)).toBe(130_000);
    expect(photoTimeout(8_000_000)).toBe(180_000);
  });
});

describe('pullAll', () => {
  it('brings everything from the start, page by page, or nothing if a page fails', async () => {
    const pages = [makeOperation(1), makeOperation(2), makeOperation(3)];
    const asked: string[] = [];
    const request = (async (url: string) => {
      asked.push(String(url));
      const since = Number(new URL(String(url), 'http://x').searchParams.get('since'));
      return json({ operations: pages.slice(since, since + 2), next: Math.min(since + 2, 3), more: since + 2 < 3 });
    }) as typeof fetch;
    expect(await pullAll('m-1', '/api', request)).toEqual({ operations: pages, next: 3 });
    expect(asked).toHaveLength(2);
    let calls = 0;
    const dropping = (async (url: string) => (calls++ === 0 ? request(url) : Promise.reject(new TypeError('dropped')))) as typeof fetch;
    expect(await pullAll('m-1', '/api', dropping)).toBeNull();
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
