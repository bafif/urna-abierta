import { tick } from 'svelte';
import { resolve } from '$app/paths';
import { fakeRoll, MarkState, parseOperation, SCHEMA_VERSION, uuidv7, type Operation, type RollEntry } from '@urna-abierta/domain';
import { QueueState, storeFor, UrnaDatabase } from './db.ts';
import { retryDelay, syncOnce } from './sync.ts';

/** Until logins exist, a test can pick its table from the address. */
function tableFromAddress(): string {
  const requested = new URLSearchParams(location.search).get('mesa');
  return requested && /^[\w-]{1,64}$/.test(requested) ? requested : 'mesa-de-prueba';
}

export const TABLE_ID = tableFromAddress();
const API = `${resolve('/')}api`;
const PERIODIC_SYNC_MS = 30_000;
const ROOM_CHECK_MS = 10 * 60_000;
/** Enough to notice a full phone in time: what the app itself writes is far smaller than this. */
const ROOM_NEEDED_BYTES = 16 * 1024 * 1024;
const ROOM_CHECK_LIMIT_MS = 8_000;
/** Browsers take a while to notice freed space, so the check repeats by itself until then. */
const ROOM_RETRY_MS = 20_000;
const PREPARED_KEY = 'urna-abierta-prepared';

/**
 * Whether the phone has room left, found by writing to a separate store. It cannot be asked:
 * the storage estimate stays the same with a full disk. And it has to be known beforehand,
 * because on a phone with no room at all, a write to the database breaks it, and when the
 * browser recovers it the database comes back empty. Without writes, nothing is lost.
 */
async function hasRoom(): Promise<boolean> {
  if (typeof caches === 'undefined') return true;
  // Outside the prefix of the app files, which the service worker cleans up when it activates.
  const name = 'room-check';
  try {
    for (let attempt = 0; ; attempt += 1) {
      let cache: Cache;
      try {
        cache = await caches.open(name);
      } catch {
        // The store is not available here, which says nothing about the disk.
        return true;
      }
      try {
        await cache.put(`${API}/room-check`, new Response(new Blob([new Uint8Array(ROOM_NEEDED_BYTES)])));
        return true;
      } catch {
        // Blocking a poll watcher by mistake is costly: it has to fail twice to count.
        if (attempt === 1) return false;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  } finally {
    await caches.delete(name).catch(() => undefined);
  }
}

/** A check that does not answer means «unknown», never «no room», and never holds the app back. */
function hasRoomWithinLimit(): Promise<boolean> {
  return Promise.race([
    hasRoom(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), ROOM_CHECK_LIMIT_MS)),
  ]);
}

interface Canary {
  firstOpen: string;
  previousOpen: string | null;
  lastOpen: string;
  opens: number;
  longestGapDays: number;
  preparedPeople: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

class AppState {
  private readonly db = new UrnaDatabase();
  private marks = new MarkState();
  /** Everything applied to the marks, to rebuild them if a write fails. */
  private applied: Operation[] = [];
  private readonly store = storeFor(this.db, (operations) => this.applyRemote(operations));
  private deviceId = '';
  private deviceSeq = 0;
  private order = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private syncing = false;
  private roomCheck: Promise<boolean> | null = null;
  private roomRetry: ReturnType<typeof setTimeout> | undefined;

  ready = $state(false);
  /** Saved data cannot be opened. */
  storageBroken = $state(false);
  /** The phone had a table prepared and now has nothing. */
  dataLost = $state(false);
  /** The phone is out of room: nothing is written until there is some. */
  noRoom = $state(false);
  saveFailed = $state(false);
  checkingRoom = $state(false);
  electors = $state.raw<RollEntry[]>([]);
  /** Bumped when marks change, because MarkState is a plain class Svelte cannot observe. */
  revision = $state(0);
  pendingCount = $state(0);
  sending = $state(false);
  online = $state(true);
  persisted = $state<boolean | null>(null);
  canary = $state<Canary | null>(null);
  intact = $state<boolean | null>(null);
  contact = $state('');
  tapSamples = $state.raw<number[]>([]);
  writeSamples = $state.raw<number[]>([]);

  voted(id: string): boolean {
    return this.marks.hasVoted(id);
  }

  tapStats = () => ({ median: median(this.tapSamples), worst: this.tapSamples.length ? Math.max(...this.tapSamples) : null });
  writeStats = () => ({ median: median(this.writeSamples), worst: this.writeSamples.length ? Math.max(...this.writeSamples) : null });

  async start(): Promise<void> {
    try {
      await this.load();
    } catch {
      this.storageBroken = true;
    }
    this.ready = true;
    if (this.storageBroken) return;
    this.schedule(1_000);
    void this.checkRoom();
    setInterval(() => void this.checkRoom(), ROOM_CHECK_MS);
  }

  /** One check at a time: deleting the test file of one would make another one fail. */
  async checkRoom(): Promise<void> {
    this.checkingRoom = true;
    this.roomCheck ??= hasRoomWithinLimit().finally(() => {
      this.roomCheck = null;
    });
    this.noRoom = !(await this.roomCheck);
    this.checkingRoom = false;
    clearTimeout(this.roomRetry);
    if (this.noRoom) {
      this.roomRetry = setTimeout(() => void this.checkRoom(), ROOM_RETRY_MS);
    } else {
      this.saveFailed = false;
    }
  }

  private async load(): Promise<void> {
    this.online = navigator.onLine;
    window.addEventListener('online', () => {
      this.online = true;
      this.failures = 0;
      void this.sync();
    });
    window.addEventListener('offline', () => {
      this.online = false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.checkRoom();
        void this.sync();
      }
    });

    this.deviceId = (await this.db.getMeta<string>('deviceId')) ?? `d-${uuidv7()}`;
    await this.db.setMeta('deviceId', this.deviceId);
    this.deviceSeq = (await this.db.getMeta<number>('deviceSeq')) ?? 0;
    this.contact = (await this.db.getMeta<string>('contact')) ?? '';

    this.electors = await this.db.electors.toArray();
    this.electors.sort((a, b) => a.order - b.order);
    const stored = await this.db.operations.toArray();
    for (const row of stored) {
      this.applyLocally(row.operation);
      this.order = Math.max(this.order, row.order);
    }
    this.dataLost = this.electors.length === 0 && localStorage.getItem(PREPARED_KEY) !== null;
    await this.touchCanary();
    await this.refreshPersistence();
    await this.refreshPending();
  }

  private applyLocally(operation: Operation): void {
    this.applied.push(operation);
    this.marks.apply(operation);
  }

  private forget(operation: Operation): void {
    this.applied = this.applied.filter((item) => item.id !== operation.id);
    this.marks = new MarkState();
    for (const item of this.applied) this.marks.apply(item);
    this.revision += 1;
  }

  private async touchCanary(): Promise<void> {
    const now = new Date().toISOString();
    const previous = await this.db.getMeta<Canary>('canary');
    const gap = previous ? (Date.parse(now) - Date.parse(previous.lastOpen)) / 86_400_000 : 0;
    const canary: Canary = {
      firstOpen: previous?.firstOpen ?? now,
      previousOpen: previous?.lastOpen ?? null,
      lastOpen: now,
      opens: (previous?.opens ?? 0) + 1,
      longestGapDays: Math.max(previous?.longestGapDays ?? 0, gap),
      preparedPeople: previous?.preparedPeople ?? null,
    };
    await this.db.setMeta('canary', canary);
    this.canary = canary;
    this.intact = canary.preparedPeople === null ? null : canary.preparedPeople === this.electors.length;
  }

  async refreshPersistence(): Promise<void> {
    if (!navigator.storage?.persist) {
      this.persisted = null;
      return;
    }
    this.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  }

  /** Copies the roll onto the phone. It only counts as ready once it has been written. */
  async prepare(size: number): Promise<void> {
    await this.checkRoom();
    if (this.noRoom) throw new Error('no room');
    let electors: RollEntry[];
    try {
      const response = await fetch(`${API}/tables/${TABLE_ID}/bundle?size=${size}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('no server');
      electors = ((await response.json()) as { electors: RollEntry[] }).electors;
    } catch {
      // Without a server the phone test still works, with the same invented people.
      electors = fakeRoll(size, 1);
    }
    await this.db.transaction('rw', this.db.electors, this.db.meta, async () => {
      await this.db.electors.clear();
      await this.db.electors.bulkPut(electors);
      const canary = await this.db.getMeta<Canary>('canary');
      if (canary) await this.db.setMeta('canary', { ...canary, preparedPeople: electors.length });
    });
    this.electors = electors;
    localStorage.setItem(PREPARED_KEY, new Date().toISOString());
    this.dataLost = false;
    this.canary = await this.db.getMeta<Canary>('canary') ?? null;
    this.intact = true;
    await this.refreshPersistence();
    void this.sync();
  }

  async reset(): Promise<void> {
    localStorage.removeItem(PREPARED_KEY);
    await this.db.delete();
    location.reload();
  }

  /**
   * Returns the operation once it is saved on the phone. If it could not be saved, nothing
   * stays on screen pretending it was, and writing stops until there is room again.
   */
  private async record(type: Operation['type'], payload: object): Promise<Operation | null> {
    if (this.noRoom || this.storageBroken) return null;
    this.deviceSeq += 1;
    this.order += 1;
    const operation = parseOperation({
      id: uuidv7(),
      schema: SCHEMA_VERSION,
      table: TABLE_ID,
      device: this.deviceId,
      device_seq: this.deviceSeq,
      device_time: new Date().toISOString(),
      type,
      payload,
    });
    if (!operation) throw new Error('invalid operation');
    this.applyLocally(operation);
    this.revision += 1;
    const started = performance.now();
    try {
      await this.db.transaction('rw', this.db.operations, this.db.meta, async () => {
        await this.db.operations.put({ id: operation.id, queue: QueueState.Pending, order: this.order, operation });
        await this.db.setMeta('deviceSeq', this.deviceSeq);
      });
    } catch {
      this.forget(operation);
      this.saveFailed = true;
      await this.checkRoom();
      return null;
    }
    this.saveFailed = false;
    this.writeSamples = [...this.writeSamples.slice(-199), performance.now() - started];
    this.pendingCount += 1;
    return operation;
  }

  /** Returns whether the mark was saved. */
  async mark(id: string): Promise<boolean> {
    if (this.noRoom || this.storageBroken) return false;
    const started = performance.now();
    const saved = this.record('voter.marked', { elector: id });
    await tick();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.tapSamples = [...this.tapSamples.slice(-199), performance.now() - started];
      }),
    );
    const operation = await saved;
    this.schedule(1_000);
    return operation !== null;
  }

  async undo(id: string): Promise<void> {
    const cancels = this.marks.activeMarks(id);
    if (cancels.length === 0) return;
    await this.record('voter.unmarked', { elector: id, cancels });
    this.schedule(1_000);
  }

  /** Whether the alert reached the server, stays queued, or could not even be saved. */
  async reportIncident(): Promise<'sent' | 'queued' | 'unsaved'> {
    const operation = await this.record('incident.reported', { kind: 'urgent' });
    if (!operation) return 'unsaved';
    await this.sync();
    const row = await this.db.operations.get(operation.id);
    return row?.queue === QueueState.Done ? 'sent' : 'queued';
  }

  async saveContact(value: string): Promise<void> {
    this.contact = value;
    await this.db.setMeta('contact', value);
  }

  private applyRemote(operations: Operation[]): void {
    for (const operation of operations) this.applyLocally(operation);
    if (operations.length > 0) this.revision += 1;
  }

  private async refreshPending(): Promise<void> {
    this.pendingCount = await this.db.operations
      .where('[queue+order]')
      .between([QueueState.Pending, -Infinity], [QueueState.Pending, Infinity])
      .count();
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), delay);
  }

  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.sending = true;
    // Receiving operations writes too, so it waits while the phone has no room.
    const result = this.noRoom ? 'failed' : await syncOnce(this.store, TABLE_ID, API);
    await this.refreshPending().catch(() => undefined);
    this.sending = false;
    this.syncing = false;
    this.online = navigator.onLine;
    if (result === 'done') {
      this.failures = 0;
      this.schedule(PERIODIC_SYNC_MS);
    } else {
      this.failures += 1;
      this.schedule(retryDelay(this.failures));
    }
  }

  async report(): Promise<string> {
    const estimate = await navigator.storage?.estimate?.();
    const tap = this.tapStats();
    const write = this.writeStats();
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    return [
      'Urna Abierta: informe de prueba',
      `fecha: ${new Date().toISOString()}`,
      `navegador: ${navigator.userAgent}`,
      `instalada: ${standalone}`,
      `almacenamiento protegido: ${this.persisted}`,
      `espacio usado (MB): ${estimate?.usage ? (estimate.usage / 1e6).toFixed(1) : '?'}`,
      `datos intactos: ${this.intact}`,
      `personas: ${this.electors.length}`,
      `primera apertura: ${this.canary?.firstOpen}`,
      `apertura anterior: ${this.canary?.previousOpen}`,
      `aperturas: ${this.canary?.opens}`,
      `mayor intervalo sin abrir (días): ${this.canary?.longestGapDays.toFixed(2)}`,
      `pendientes de enviar: ${this.pendingCount}`,
      `sin espacio: ${this.noRoom}`,
      `tachar, ms (mediana/peor, ${this.tapSamples.length} muestras): ${tap.median?.toFixed(0)}/${tap.worst?.toFixed(0)}`,
      `guardar, ms (mediana/peor, ${this.writeSamples.length} muestras): ${write.median?.toFixed(0)}/${write.worst?.toFixed(0)}`,
    ].join('\n');
  }
}

export const app = new AppState();
