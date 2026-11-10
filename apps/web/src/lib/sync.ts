import { MAX_BATCH, type Operation } from '@urna-abierta/domain';

export interface SyncStore {
  pending(limit: number): Promise<Operation[]>;
  acknowledge(ids: string[]): Promise<void>;
  /** The server refuses these for good: they leave the queue but are kept for review. */
  quarantine(ids: string[]): Promise<void>;
  addRemote(operations: Operation[]): Promise<void>;
  cursor(): Promise<number>;
  setCursor(value: number): Promise<void>;
  /** How far ahead the server's clock is from the phone's, in milliseconds, each time it says what time it is. */
  serverTime?(offset: number): void;
  /** The election had closed when this arrived: it counts for nothing until coordination looks at it. */
  arrivedLate?(): void;
}

/** 'closed': the election closed, and the server no longer gives this table to this person. What was waiting went out anyway. */
export type SyncResult = 'done' | 'failed' | 'closed';

const REQUEST_TIMEOUT_MS = 10_000;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;

interface PushAnswer {
  acked: string[];
  rejected: { id: string }[];
  server_time?: string;
  late?: boolean;
}

/** Wait grows with each failure, and is random so that phones do not all come back together. */
export function retryDelay(failures: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** failures);
  return ceiling / 2 + random() * (ceiling / 2);
}

/** The server's time against the middle of the request: the answer was written somewhere in between. */
function noteClock(store: SyncStore, serverTime: string | undefined, sentAt: number): void {
  const at = Date.parse(serverTime ?? '');
  if (Number.isFinite(at)) store.serverTime?.(at - (sentAt + Date.now()) / 2);
}

/** 'gone': the table is no longer there for this person, because the election closed or was deleted. */
async function push(store: SyncStore, table: string, operations: Operation[], apiBase: string, request: typeof fetch, timeoutMs: number): Promise<PushAnswer | 'gone' | null> {
  const sentAt = Date.now();
  const response = await request(`${apiBase}/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ table, operations }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 410) return 'gone';
  if (!response.ok) return null;
  const body = (await response.json()) as PushAnswer;
  noteClock(store, body.server_time, sentAt);
  await store.acknowledge(body.acked);
  await store.quarantine(body.rejected.map((item) => item.id));
  if (body.late) store.arrivedLate?.();
  return body;
}

export async function syncOnce(
  store: SyncStore,
  table: string,
  apiBase: string,
  request: typeof fetch = fetch,
): Promise<SyncResult> {
  try {
    for (;;) {
      const batch = await store.pending(MAX_BATCH);
      if (batch.length === 0) break;
      const body = await push(store, table, batch, apiBase, request, REQUEST_TIMEOUT_MS);
      if (body === 'gone') return 'closed';
      if (!body || body.acked.length + body.rejected.length === 0) return 'failed';
    }
    for (;;) {
      const since = await store.cursor();
      const sentAt = Date.now();
      const response = await request(`${apiBase}/sync/pull?table=${encodeURIComponent(table)}&since=${since}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 410) return 'closed';
      if (!response.ok) return 'failed';
      const body = (await response.json()) as { operations: Operation[]; next: number; more: boolean; server_time?: string };
      noteClock(store, body.server_time, sentAt);
      await store.addRemote(body.operations);
      await store.setCursor(body.next);
      if (!body.more) break;
    }
    return 'done';
  } catch {
    return 'failed';
  }
}

/**
 * Sends these operations alone and right away, without waiting for what is queued before them: an urgent alert
 * cannot wait behind hundreds of marks with little signal. Says whether all of them got there in time.
 */
export async function pushNow(
  store: SyncStore,
  table: string,
  operations: Operation[],
  apiBase: string,
  request: typeof fetch = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const body = await push(store, table, operations, apiBase, request, timeoutMs);
    return Boolean(body && body !== 'gone' && operations.every((operation) => body.acked.includes(operation.id)));
  } catch {
    return false;
  }
}

/** A heavier photo may take longer with little signal, but never forever: nothing else would go out after it. */
export const photoTimeout = (bytes: number) => Math.min(180_000, 30_000 + bytes / 20);

/** What became of a photo: it got there, the server will never take it (too big, not a picture), or it goes again later. */
export async function sendPhoto(url: string, bytes: ArrayBuffer, request: typeof fetch = fetch, timeoutMs = photoTimeout(bytes.byteLength)): Promise<'sent' | 'refused' | 'failed'> {
  try {
    const response = await request(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: bytes, signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) return 'sent';
    return [400, 413, 415].includes(response.status) ? 'refused' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Everything the server has of a table, from the start, or null if it could not get all of it. */
export async function pullAll(table: string, apiBase: string, request: typeof fetch = fetch): Promise<{ operations: Operation[]; next: number } | null> {
  const operations: Operation[] = [];
  let since = 0;
  try {
    for (;;) {
      const response = await request(`${apiBase}/sync/pull?table=${encodeURIComponent(table)}&since=${since}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { operations: Operation[]; next: number; more: boolean };
      operations.push(...body.operations);
      since = body.next;
      if (!body.more) return { operations, next: since };
    }
  } catch {
    return null;
  }
}
