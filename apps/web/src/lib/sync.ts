import { MAX_BATCH, type Operation } from '@urna-abierta/domain';

export interface SyncStore {
  pending(limit: number): Promise<Operation[]>;
  acknowledge(ids: string[]): Promise<void>;
  /** The server refuses these for good: they leave the queue but are kept for review. */
  quarantine(ids: string[]): Promise<void>;
  addRemote(operations: Operation[]): Promise<void>;
  cursor(): Promise<number>;
  setCursor(value: number): Promise<void>;
}

/** 'closed': the election closed, and the server no longer gives this table to this person. What was waiting went out anyway. */
export type SyncResult = 'done' | 'failed' | 'closed';

const REQUEST_TIMEOUT_MS = 10_000;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;

/** Wait grows with each failure, and is random so that phones do not all come back together. */
export function retryDelay(failures: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** failures);
  return ceiling / 2 + random() * (ceiling / 2);
}

export async function syncOnce(
  store: SyncStore,
  table: string,
  apiBase: string,
  request: typeof fetch = fetch,
): Promise<SyncResult> {
  const timeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    for (;;) {
      const batch = await store.pending(MAX_BATCH);
      if (batch.length === 0) break;
      const response = await request(`${apiBase}/sync/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table, operations: batch }),
        signal: timeout(),
      });
      if (!response.ok) return 'failed';
      const body = (await response.json()) as { acked: string[]; rejected: { id: string }[] };
      await store.acknowledge(body.acked);
      await store.quarantine(body.rejected.map((item) => item.id));
      if (body.acked.length + body.rejected.length === 0) return 'failed';
    }
    for (;;) {
      const since = await store.cursor();
      const response = await request(`${apiBase}/sync/pull?table=${encodeURIComponent(table)}&since=${since}`, {
        signal: timeout(),
      });
      if (response.status === 410) return 'closed';
      if (!response.ok) return 'failed';
      const body = (await response.json()) as { operations: Operation[]; next: number; more: boolean };
      await store.addRemote(body.operations);
      await store.setCursor(body.next);
      if (!body.more) break;
    }
    return 'done';
  } catch {
    return 'failed';
  }
}
