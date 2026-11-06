import Dexie, { type Table } from 'dexie';
import type { Operation, RollEntry } from '@urna-abierta/domain';
import type { SyncStore } from './sync.ts';

export const enum QueueState {
  Done = 0,
  Pending = 1,
  Quarantined = 2,
}

export interface StoredOperation {
  id: string;
  queue: QueueState;
  order: number;
  operation: Operation;
}

export interface StoredPhoto {
  sha256: string;
  /** Plain bytes, not a Blob: WebKit can refuse to store a Blob in the database. */
  bytes: ArrayBuffer;
  /** 0 waits to go, 1 got there, 2 the server will never take it. */
  sent: PhotoState;
}

export const enum PhotoState {
  Waiting = 0,
  Sent = 1,
  Refused = 2,
}

export class UrnaDatabase extends Dexie {
  photos!: Table<StoredPhoto, string>;
  electors!: Table<RollEntry, string>;
  operations!: Table<StoredOperation, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'urna-abierta') {
    super(name);
    this.version(1).stores({ electors: 'id', operations: 'id, [queue+order]', meta: 'key' });
    this.version(2).stores({ photos: 'sha256, sent' });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
}

export function storeFor(db: UrnaDatabase, onRemote: (operations: Operation[]) => void): SyncStore {
  return {
    async pending(limit) {
      const rows = await db.operations
        .where('[queue+order]')
        .between([QueueState.Pending, Dexie.minKey], [QueueState.Pending, Dexie.maxKey])
        .limit(limit)
        .toArray();
      return rows.map((row) => row.operation);
    },
    async acknowledge(ids) {
      await db.operations.where('id').anyOf(ids).modify({ queue: QueueState.Done });
    },
    async quarantine(ids) {
      await db.operations.where('id').anyOf(ids).modify({ queue: QueueState.Quarantined });
    },
    async addRemote(operations) {
      const known = new Set(
        await db.operations
          .where('id')
          .anyOf(operations.map((operation) => operation.id))
          .primaryKeys(),
      );
      const fresh = operations.filter((operation) => !known.has(operation.id));
      await db.operations.bulkPut(
        fresh.map((operation) => ({ id: operation.id, queue: QueueState.Done, order: 0, operation })),
      );
      onRemote(fresh);
    },
    async cursor() {
      return (await db.getMeta<number>('cursor')) ?? 0;
    },
    async setCursor(value) {
      await db.setMeta('cursor', value);
    },
  };
}
