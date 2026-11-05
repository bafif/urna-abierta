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
  private readonly marks = new MarkState();
  private readonly store = storeFor(this.db, (operations) => this.applyRemote(operations));
  private deviceId = '';
  private deviceSeq = 0;
  private order = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private syncing = false;

  ready = $state(false);
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
      if (document.visibilityState === 'visible') void this.sync();
    });

    this.deviceId = (await this.db.getMeta<string>('deviceId')) ?? `d-${uuidv7()}`;
    await this.db.setMeta('deviceId', this.deviceId);
    this.deviceSeq = (await this.db.getMeta<number>('deviceSeq')) ?? 0;
    this.contact = (await this.db.getMeta<string>('contact')) ?? '';

    this.electors = await this.db.electors.toArray();
    this.electors.sort((a, b) => a.order - b.order);
    const stored = await this.db.operations.toArray();
    for (const row of stored) {
      this.marks.apply(row.operation);
      this.order = Math.max(this.order, row.order);
    }
    await this.touchCanary();
    await this.refreshPersistence();
    await this.refreshPending();
    this.ready = true;
    this.schedule(1_000);
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
    this.canary = await this.db.getMeta<Canary>('canary') ?? null;
    this.intact = true;
    await this.refreshPersistence();
    void this.sync();
  }

  async reset(): Promise<void> {
    await this.db.delete();
    location.reload();
  }

  private async record(type: Operation['type'], payload: object): Promise<Operation> {
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
    this.marks.apply(operation);
    this.revision += 1;
    const started = performance.now();
    await this.db.transaction('rw', this.db.operations, this.db.meta, async () => {
      await this.db.operations.put({ id: operation.id, queue: QueueState.Pending, order: this.order, operation });
      await this.db.setMeta('deviceSeq', this.deviceSeq);
    });
    this.writeSamples = [...this.writeSamples.slice(-199), performance.now() - started];
    this.pendingCount += 1;
    return operation;
  }

  async mark(id: string): Promise<void> {
    const started = performance.now();
    const saved = this.record('voter.marked', { elector: id });
    await tick();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.tapSamples = [...this.tapSamples.slice(-199), performance.now() - started];
      }),
    );
    await saved;
    this.schedule(1_000);
  }

  async undo(id: string): Promise<void> {
    const cancels = this.marks.activeMarks(id);
    if (cancels.length === 0) return;
    await this.record('voter.unmarked', { elector: id, cancels });
    this.schedule(1_000);
  }

  /** Returns whether the alert reached the server. If not, it stays queued. */
  async reportIncident(): Promise<boolean> {
    const operation = await this.record('incident.reported', { kind: 'urgent' });
    await this.sync();
    const row = await this.db.operations.get(operation.id);
    return row?.queue === QueueState.Done;
  }

  async saveContact(value: string): Promise<void> {
    this.contact = value;
    await this.db.setMeta('contact', value);
  }

  private applyRemote(operations: Operation[]): void {
    for (const operation of operations) this.marks.apply(operation);
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
    const result = await syncOnce(this.store, TABLE_ID, API);
    await this.refreshPending();
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
      `tachar, ms (mediana/peor, ${this.tapSamples.length} muestras): ${tap.median?.toFixed(0)}/${tap.worst?.toFixed(0)}`,
      `guardar, ms (mediana/peor, ${this.writeSamples.length} muestras): ${write.median?.toFixed(0)}/${write.worst?.toFixed(0)}`,
    ].join('\n');
  }
}

export const app = new AppState();
