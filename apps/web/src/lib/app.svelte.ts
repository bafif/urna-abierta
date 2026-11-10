import { tick } from 'svelte';
import { dayIn, fakeRoll, MarkState, MAX_PHOTO_BYTES, parseOperation, SCHEMA_VERSION, uuidv7, type Operation, type RollEntry } from '@urna-abierta/domain';
import { CLOCK_WARNING_MS, offsetAfterJump } from './clock.ts';
import { PhotoState, QueueState, storeFor, UrnaDatabase } from './db.ts';
import { t } from './i18n.svelte.ts';
import { rollCanGo } from './roll-release.ts';
import { API, session, type TableInfo } from './session.svelte.ts';
import { pullAll, pushNow, retryDelay, sendPhoto, syncOnce, type SyncStore } from './sync.ts';

const PRACTICE_KEY = 'urna-abierta-practica';
const PRACTICE_PEOPLE = 40;
const MAX_PHOTO_SIDE = 1800;
const SHRINK_LIMIT_MS = 15_000;
/** The second try, already smaller, is quicker. */
const SHRINK_AGAIN_LIMIT_MS = 10_000;
/** An urgent alert goes out by itself: if it does not get through in this time, the plan B shows. */
const ALERT_LIMIT_MS = 8_000;
/** Survives the wipe of the roll until the next table: something reached the server after the close. */
const LATE_KEY = 'urna-llego-tarde';
/** Who this is and their table are asked again this often while there is signal: they say if the roll changed. */
const ME_EVERY_MS = 5 * 60_000;
/** A smaller difference is not worth writing down again. */
const CLOCK_NOTICE_MS = 60_000;
const PERIODIC_SYNC_MS = 30_000;
const ROOM_CHECK_MS = 10 * 60_000;
/** Enough to notice a full phone in time: what the app itself writes is far smaller than this. */
const ROOM_NEEDED_BYTES = 16 * 1024 * 1024;
const ROOM_CHECK_LIMIT_MS = 8_000;
/** Browsers take a while to notice freed space, so the check repeats by itself until then. */
const ROOM_RETRY_MS = 20_000;
const PREPARED_KEY = 'urna-abierta-prepared';
/** When the phone's clock was last looked at, while it was off: it may get fixed with the app closed. */
const CLOCK_SEEN_KEY = 'urna-abierta-reloj-visto';

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

/** The day here, not in Greenwich: at nine at night in Argentina it is already tomorrow there. */
export function localDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The ellipsis says that digits are missing, so it only goes when some are. */
export const shownDocument = (suffix: string) => (suffix.length <= 4 && suffix ? `…${suffix}` : suffix);

function draw(bitmap: ImageBitmap, scale: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.82));
}

async function withinLimit<T>(work: Promise<T>, ms: number): Promise<T | null> {
  const limit = new Promise<null>((done) => setTimeout(() => done(null), ms));
  try {
    return await Promise.race([work, limit]);
  } catch {
    return null;
  }
}

/** Keeps a photo of the tally sheet readable and light enough to go out with little signal. */
async function shrink(file: Blob): Promise<Blob> {
  const whole = async () => {
    const bitmap = await createImageBitmap(file);
    return draw(bitmap, Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height)));
  };
  // Some phones cannot open a whole photo at once: the browser can open it already smaller.
  const smaller = async () => draw(await createImageBitmap(file, { resizeWidth: MAX_PHOTO_SIDE, resizeQuality: 'medium' }), 1);
  // The last step of the day cannot depend on a phone managing this: the original photo works too, if it is not too big.
  return (await withinLimit(whole(), SHRINK_LIMIT_MS)) ?? (await withinLimit(smaller(), SHRINK_AGAIN_LIMIT_MS)) ?? file;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** What the poll watcher has to do now, worked out on the phone so that it also holds with no signal. */
export type Step = 'prepare' | 'waiting' | 'mark' | 'rest' | 'tally' | 'photo' | 'done';

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

class AppState {
  /** Practice has its own database: what happens in it can never get mixed with the real thing. */
  readonly practice = localStorage.getItem(PRACTICE_KEY) !== null;
  private readonly db = new UrnaDatabase(this.practice ? 'urna-abierta-practica' : 'urna-abierta');
  /** The table this phone holds: it may still have things to send after the person moved on. */
  private tableId = this.practice ? 'practica' : '';
  private marks = new MarkState();
  /** Everything applied to the marks, to rebuild them if a write fails. */
  private applied: Operation[] = [];
  private readonly store: SyncStore = {
    ...storeFor(this.db, (operations) => this.applyRemote(operations)),
    serverTime: (offset) => this.noteClock(offset),
    arrivedLate: () => {
      this.arrivedLate = true;
      localStorage.setItem(LATE_KEY, '1');
    },
  };
  /** Something reached the server after the close: the phone says coordination will look at it, not that all went fine. */
  arrivedLate = $state(typeof localStorage !== 'undefined' && localStorage.getItem(LATE_KEY) === '1');
  private deviceId = '';
  private lastMeAt = Date.now();
  /** The phone's clock and the time that passed, the last time they were looked at. */
  private clockSeen = { wall: Date.now(), mono: performance.now() };
  private deviceSeq = 0;
  private order = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextSyncAt = 0;
  private running: Promise<void> | null = null;
  /** Each reading of what is pending takes a number, and only the latest one counts. */
  private pendingReading = 0;
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
  pendingPhotos = $state(0);
  sending = $state(false);
  online = $state(true);
  persisted = $state<boolean | null>(null);
  canary = $state<Canary | null>(null);
  intact = $state<boolean | null>(null);
  tapSamples = $state.raw<number[]>([]);
  writeSamples = $state.raw<number[]>([]);
  /** How far ahead the server's clock is from this phone's, in milliseconds. */
  clockOffset = $state(0);
  /** A correction was just saved: the plan says so for a moment. */
  correctionSaved = $state(false);
  /** The table this phone was moved to, prepared by itself: the plan says why it changed. */
  movedTo = $state<string | null>(null);
  private correctionTimer: ReturnType<typeof setTimeout> | undefined;
  /** The roll of the table changed on the server, and the phone already has the new one. */
  rollUpdated = $state(false);
  /** Photos the server will never take, by their hash. */
  refusedPhotos = $state.raw<Set<string>>(new Set());

  voted(id: string): boolean {
    return this.marks.hasVoted(id);
  }

  /** The table to work on: the one assigned to this person, or the invented one when practicing. */
  get table(): TableInfo | null {
    if (!this.practice) return session.me?.table ?? null;
    return {
      id: 'practica',
      name: t('practice.table'),
      place: '',
      election: t('practice.election'),
      electionId: '',
      status: 'jornada',
      days: [localDay()],
      shift: null,
      categories: [{ id: 'practica', name: t('practice.category'), lists: [{ id: 'a', name: t('practice.listA') }, { id: 'b', name: t('practice.listB') }, { id: 'blanco', name: t('practice.blank') }] }],
      total: PRACTICE_PEOPLE,
    };
  }

  private ofType(type: Operation['type']): Operation[] {
    void this.revision;
    return this.applied.filter((operation) => operation.type === type);
  }

  get markedCount(): number {
    void this.revision;
    return this.electors.filter((entry) => this.marks.hasVoted(entry.id)).length;
  }

  get countedDays(): Set<string> {
    return new Set(this.ofType('envelopes.counted').map((operation) => (operation.payload as { day: string }).day));
  }

  /** The envelopes counted the last time, which the tally has to add up to. */
  get lastEnvelopes(): number | null {
    const last = this.ofType('envelopes.counted').at(-1);
    return last ? (last.payload as { envelopes: number }).envelopes : null;
  }

  /** The last count of one day's envelopes, with how many were crossed out then: a correction compares with that. */
  envelopesOf(day: string): { envelopes: number; marked: number } | null {
    const last = this.ofType('envelopes.counted').findLast((operation) => (operation.payload as { day: string }).day === day);
    return last ? (last.payload as { envelopes: number; marked: number }) : null;
  }

  /** The last tally sent for a category: a correction starts from it. */
  lastTally(category: string): Record<string, number> | null {
    const last = this.ofType('tally.submitted').findLast((operation) => (operation.payload as { category: string }).category === category);
    return last ? (last.payload as { results: Record<string, number> }).results : null;
  }

  get talliedCategories(): Set<string> {
    return new Set(this.ofType('tally.submitted').map((operation) => (operation.payload as { category: string }).category));
  }

  /** A photo the server refused does not count: it has to be taken again. One from another phone is not known here, so it counts. */
  get hasPhoto(): boolean {
    return this.ofType('tally.photo').some((operation) => !this.refusedPhotos.has((operation.payload as { sha256: string }).sha256));
  }

  get photoRefused(): boolean {
    return this.refusedPhotos.size > 0 && !this.hasPhoto;
  }

  /** Today where the election happens, by the server's clock: a phone with the wrong date or zone still gets its step right. */
  get today(): string {
    const now = new Date(Date.now() + this.clockOffset);
    const zone = this.table?.timeZone;
    return zone ? dayIn(zone, now) : localDay(now);
  }

  get clockWrong(): boolean {
    return Math.abs(this.clockOffset) > CLOCK_WARNING_MS;
  }

  get step(): Step {
    const table = this.table;
    if (this.electors.length === 0 || !table || table.days.length === 0) return 'prepare';
    const today = this.today;
    const own = table.shift ?? table.days;
    const last = own[own.length - 1]!;
    if (today < own[0]!) return 'waiting';
    if (today <= last && !this.countedDays.has(last)) {
      if (!own.includes(today) || this.countedDays.has(today)) return 'rest';
      return 'mark';
    }
    // Whoever does not work the last day ends with their shift: the count is someone else's.
    if (last !== table.days[table.days.length - 1]) return 'done';
    if (table.categories.some((category) => !this.talliedCategories.has(category.id))) return 'tally';
    return this.hasPhoto ? 'done' : 'photo';
  }

  /** Which day of the election today is, counted from one. */
  get dayNumber(): number {
    const days = this.table?.days ?? [];
    const index = days.indexOf(this.today);
    return index === -1 ? days.length : index + 1;
  }

  startPractice(): void {
    localStorage.setItem(PRACTICE_KEY, new Date().toISOString());
    location.reload();
  }

  async endPractice(): Promise<void> {
    localStorage.removeItem(PRACTICE_KEY);
    await this.db.delete();
    location.reload();
  }

  tapStats = () => ({ median: median(this.tapSamples), worst: this.tapSamples.length ? Math.max(...this.tapSamples) : null });
  writeStats = () => ({ median: median(this.writeSamples), worst: this.writeSamples.length ? Math.max(...this.writeSamples) : null });

  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
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
      // Leaving to the phone's settings and coming back is how the clock gets fixed.
      this.watchClock();
      if (document.visibilityState === 'visible') {
        void this.checkRoom();
        void this.sync();
      }
    });

    this.deviceId = (await this.db.getMeta<string>('deviceId')) ?? `d-${uuidv7()}`;
    await this.db.setMeta('deviceId', this.deviceId);
    this.deviceSeq = (await this.db.getMeta<number>('deviceSeq')) ?? 0;
    if (!this.practice) this.tableId = (await this.db.getMeta<string>('tableId')) ?? '';
    this.clockOffset = (await this.db.getMeta<number>('clockOffset')) ?? 0;
    const seen = Number(localStorage.getItem(CLOCK_SEEN_KEY));
    if (seen && !this.practice) this.useClockOffset(offsetAfterJump(this.clockOffset, Date.now() - seen));
    this.refusedPhotos = new Set(await this.db.photos.where('sent').equals(PhotoState.Refused).primaryKeys());

    this.electors = await this.db.electors.toArray();
    this.electors.sort((a, b) => a.order - b.order);
    await this.replay();
    this.dataLost = !this.practice && this.electors.length === 0 && localStorage.getItem(PREPARED_KEY) !== null;
    await this.touchCanary();
    await this.refreshPersistence();
    await this.refreshPending();
    // With signal, the first sync decides, a second from now: the server knows better than the calendar.
    if (!this.practice && !navigator.onLine) await this.letGoIfFinished(false);
  }

  /**
   * The roll does not stay on the phone: once the election closed or the person moved to another
   * table, and only when nothing is left to send, it goes. `reached`: the server answered just now.
   */
  private async letGoIfFinished(reached: boolean): Promise<void> {
    const { me } = session;
    // A table of an election that got deleted has nowhere to send what is left: it goes too.
    const deleted = reached && Boolean(this.tableId) && (me?.deleted?.tables.includes(this.tableId) ?? false);
    if (!this.tableId || (this.pendingCount + this.pendingPhotos > 0 && !deleted)) return;
    const lastDay = me?.table?.days.at(-1) ?? (await this.db.getMeta<string>('lastDay'));
    const timeZone = me?.table ? me.table.timeZone : await this.db.getMeta<string>('timeZone');
    const roll = { tableId: this.tableId, reached: reached && me !== null, assigned: me?.table?.id, lastDay, hoursKept: me?.security.localHoursAfterClose, timeZone, clockOffset: this.clockOffset };
    if (!rollCanGo(roll)) return;
    // Moved to another table: the old roll goes, and the new one is prepared right away.
    const moved = roll.reached && roll.assigned && roll.assigned !== roll.tableId ? me?.table : null;
    await this.wipe();
    if (moved) {
      this.movedTo = moved.name;
      await this.prepare().catch(() => undefined);
    }
  }

  private async wipe(): Promise<void> {
    await this.db.transaction('rw', this.db.electors, this.db.operations, this.db.photos, this.db.meta, async () => {
      await this.db.electors.clear();
      await this.db.operations.clear();
      await this.db.photos.clear();
      await this.db.meta.bulkDelete(['cursor', 'tableId', 'lastDay', 'timeZone']);
      localStorage.removeItem(LATE_KEY);
      this.arrivedLate = false;
    });
    localStorage.removeItem(PREPARED_KEY);
    this.electors = [];
    this.applied = [];
    this.marks = new MarkState();
    this.tableId = '';
    this.dataLost = false;
    this.intact = null;
    this.revision += 1;
  }

  /** The marks and everything else, from what is saved. */
  private async replay(): Promise<void> {
    this.applied = [];
    this.marks = new MarkState();
    for (const row of await this.db.operations.toArray()) {
      this.applyLocally(row.operation);
      this.order = Math.max(this.order, row.order);
    }
    this.revision += 1;
  }

  private noteClock(offset: number): void {
    if (Math.abs(offset - this.clockOffset) < CLOCK_NOTICE_MS) return;
    this.useClockOffset(offset);
  }

  private useClockOffset(offset: number): void {
    this.clockSeen = { wall: Date.now(), mono: performance.now() };
    if (offset === this.clockOffset) return;
    this.clockOffset = offset;
    void this.db.setMeta('clockOffset', offset).catch(() => undefined);
  }

  /**
   * The difference with the server is only measured with signal. If the phone's clock jumped since the last look by
   * about what it was off, someone fixed it, and the day has to stay right without waiting for signal.
   */
  private watchClock(): void {
    if (this.practice) return;
    const wall = Date.now();
    const mono = performance.now();
    const jump = wall - this.clockSeen.wall - (mono - this.clockSeen.mono);
    this.clockSeen = { wall, mono };
    this.useClockOffset(offsetAfterJump(this.clockOffset, jump));
    try {
      if (this.clockWrong) localStorage.setItem(CLOCK_SEEN_KEY, String(wall));
      else localStorage.removeItem(CLOCK_SEEN_KEY);
    } catch {
      // Without it, a clock fixed with the app closed waits for the next sync.
    }
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
  async prepare(): Promise<void> {
    await this.checkRoom();
    if (this.noRoom) throw new Error('no room');
    const table = this.table;
    if (!table) throw new Error('no table');
    // What is left from another table goes out first: once replaced, it would no longer belong anywhere.
    if (this.tableId && this.tableId !== table.id && this.pendingCount + this.pendingPhotos > 0) {
      await this.sync();
      if (this.pendingCount + this.pendingPhotos > 0) throw new Error('pending from another table');
      await this.letGoIfFinished(true);
    }
    let electors: RollEntry[];
    let revision: string | null = null;
    if (this.practice) {
      electors = fakeRoll(PRACTICE_PEOPLE, 1);
    } else {
      const response = await session.fetch(`${API}/tables/${table.id}/bundle`, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error('no server');
      ({ electors, revision } = (await response.json()) as { electors: RollEntry[]; revision: string });
    }
    await this.db.transaction('rw', this.db.electors, this.db.meta, async () => {
      await this.db.electors.clear();
      await this.db.electors.bulkPut(electors);
      await this.db.setMeta('tableId', table.id);
      await this.db.setMeta('lastDay', table.days.at(-1));
      await this.db.setMeta('timeZone', table.timeZone);
      await this.db.setMeta('rollRevision', revision);
      await this.db.setMeta('publicIds', true);
      const canary = await this.db.getMeta<Canary>('canary');
      if (canary) await this.db.setMeta('canary', { ...canary, preparedPeople: electors.length });
    });
    this.electors = electors;
    this.tableId = table.id;
    if (!this.practice) localStorage.setItem(PREPARED_KEY, new Date().toISOString());
    this.dataLost = false;
    this.canary = await this.db.getMeta<Canary>('canary') ?? null;
    this.intact = true;
    await this.refreshPersistence();
    void this.sync();
  }

  /**
   * Brings the roll again when it changed on the server: someone added, moved or corrected, a light. Marks stay,
   * because they name people by an id that never changes. A roll from before those ids is replaced once nothing is
   * left to send, together with its marks, which come back from the server under the new ids.
   */
  private async refreshRoll(): Promise<void> {
    const table = session.me?.table;
    if (this.practice || this.electors.length === 0 || !table?.rollRevision || table.id !== this.tableId) return;
    const before = !(await this.db.getMeta<boolean>('publicIds'));
    if (!before && (await this.db.getMeta<string>('rollRevision')) === table.rollRevision) return;
    if (before && this.pendingCount > 0) return;
    const response = await session.fetch(`${API}/tables/${table.id}/bundle`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return;
    const { electors, revision } = (await response.json()) as { electors: RollEntry[]; revision: string };
    // All of it before touching anything: the marks on screen must not disappear, not even for a moment.
    const pulled = before ? await pullAll(table.id, API, session.fetch) : null;
    if (before && !pulled) return;
    const replaced = await this.db.transaction('rw', this.db.electors, this.db.operations, this.db.meta, async () => {
      if (pulled) {
        const waiting = await this.db.operations.where('[queue+order]').between([QueueState.Pending, -Infinity], [QueueState.Pending, Infinity]).count();
        if (waiting > 0) return false;
        await this.db.operations.filter((row) => row.queue === QueueState.Done && row.operation.type.startsWith('voter.')).delete();
        const known = new Set(await this.db.operations.toCollection().primaryKeys());
        const fresh = pulled.operations.filter((operation) => !known.has(operation.id));
        await this.db.operations.bulkPut(fresh.map((operation) => ({ id: operation.id, queue: QueueState.Done, order: 0, operation })));
        await this.db.setMeta('cursor', pulled.next);
        await this.db.setMeta('publicIds', true);
      }
      await this.db.electors.clear();
      await this.db.electors.bulkPut(electors);
      await this.db.setMeta('rollRevision', revision);
      const canary = await this.db.getMeta<Canary>('canary');
      if (canary) await this.db.setMeta('canary', { ...canary, preparedPeople: electors.length });
      return true;
    });
    if (!replaced) return;
    this.electors = [...electors].sort((a, b) => a.order - b.order);
    if (pulled) await this.replay();
    this.canary = (await this.db.getMeta<Canary>('canary')) ?? null;
    this.intact = true;
    // Changing to the new ids changes nothing the person can see.
    if (!pulled) this.rollUpdated = true;
    this.revision += 1;
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
      table: this.tableId,
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
        await this.db.operations.put({ id: operation.id, queue: this.practice ? QueueState.Done : QueueState.Pending, order: this.order, operation });
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
    if (!this.practice) {
      this.pendingReading += 1;
      this.pendingCount += 1;
    }
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
    if (this.practice) return 'sent';
    // By itself and right away: behind a queue of marks, with little signal, it could take minutes. If it does not
    // get through, it stays queued like everything else, and the screen offers the plan B at once.
    const sent = await pushNow(this.store, this.tableId, [operation], API, session.fetch, ALERT_LIMIT_MS);
    await this.refreshPending().catch(() => undefined);
    this.schedule(1_000);
    return sent ? 'sent' : 'queued';
  }

  /** A correction of an earlier day keeps what was crossed out that day, not what is crossed out now. */
  async countEnvelopes(day: string, envelopes: number, marked = this.markedCount): Promise<boolean> {
    const operation = await this.record('envelopes.counted', { day, envelopes, marked });
    this.schedule(500);
    return operation !== null;
  }

  async submitTally(category: string, results: Record<string, number>): Promise<boolean> {
    const operation = await this.record('tally.submitted', { category, results });
    this.schedule(500);
    return operation !== null;
  }

  /**
   * A correction is one more version, sent like the first: nothing already sent is replaced, and the chief chooses
   * which one counts.
   */
  noteCorrection(): void {
    this.correctionSaved = true;
    clearTimeout(this.correctionTimer);
    this.correctionTimer = setTimeout(() => (this.correctionSaved = false), 10_000);
  }

  /** The photo stays saved on the phone until it reaches the server. One the server would never take is not kept. */
  async addPhoto(file: Blob): Promise<'saved' | 'unsaved' | 'tooBig'> {
    if (this.noRoom || this.storageBroken) return 'unsaved';
    const blob = await shrink(file);
    if (blob.size > MAX_PHOTO_BYTES) return 'tooBig';
    const bytes = await blob.arrayBuffer();
    const hash = await sha256(bytes);
    try {
      await this.db.photos.put({ sha256: hash, bytes, sent: this.practice ? PhotoState.Sent : PhotoState.Waiting });
    } catch {
      this.saveFailed = true;
      await this.checkRoom();
      return 'unsaved';
    }
    // The same picture again is a new try.
    this.forgetRefused(hash);
    const operation = await this.record('tally.photo', { sha256: hash });
    if (!operation) return 'unsaved';
    await this.refreshPending();
    this.schedule(500);
    return 'saved';
  }

  /** One at a time, each with its own limit. One the server refuses is set aside, so that the next ones still go. */
  private async sendPhotos(): Promise<void> {
    const waiting = await this.db.photos.where('sent').equals(PhotoState.Waiting).toArray();
    for (const photo of waiting) {
      const result = await sendPhoto(`${API}/tables/${this.tableId}/photos/${photo.sha256}`, photo.bytes, session.fetch);
      if (result === 'failed') return;
      await this.db.photos.update(photo.sha256, { sent: result === 'sent' ? PhotoState.Sent : PhotoState.Refused });
      if (result === 'refused') this.refusedPhotos = new Set([...this.refusedPhotos, photo.sha256]);
      else this.forgetRefused(photo.sha256);
    }
  }

  private forgetRefused(hash: string): void {
    if (!this.refusedPhotos.has(hash)) return;
    const refused = new Set(this.refusedPhotos);
    refused.delete(hash);
    this.refusedPhotos = refused;
  }

  private applyRemote(operations: Operation[]): void {
    for (const operation of operations) this.applyLocally(operation);
    if (operations.length > 0) this.revision += 1;
  }

  /**
   * A reading that started before something got saved can end after it. If that old number were
   * shown, the app would say that everything was sent when it was not.
   */
  private async refreshPending(): Promise<void> {
    this.pendingReading += 1;
    const reading = this.pendingReading;
    const operations = await this.db.operations
      .where('[queue+order]')
      .between([QueueState.Pending, -Infinity], [QueueState.Pending, Infinity])
      .count();
    const photos = await this.db.photos.where('sent').equals(PhotoState.Waiting).count();
    if (reading !== this.pendingReading) return;
    this.pendingCount = operations;
    this.pendingPhotos = photos;
  }

  /** The soonest one wins: finishing a send must not push back another that was just asked for. */
  private schedule(delay: number): void {
    const at = Date.now() + delay;
    if (this.timer !== undefined && this.nextSyncAt <= at) return;
    clearTimeout(this.timer);
    this.nextSyncAt = at;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.sync();
    }, delay);
  }

  /** One at a time. Whoever asks during a send gets another one after it, which sees what that one missed. */
  async sync(): Promise<void> {
    this.watchClock();
    if (this.practice || !this.tableId) return;
    if (this.running) {
      await this.running;
      return this.sync();
    }
    this.running = this.runSync().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runSync(): Promise<void> {
    this.sending = true;
    // Receiving operations writes too, so it waits while the phone has no room.
    let result = this.noRoom ? 'failed' : await syncOnce(this.store, this.tableId, API, session.fetch);
    if (result === 'closed') {
      // The server already said it: hearing it from /me as well lets the phone let go of the roll right away.
      await session.refresh();
      this.lastMeAt = Date.now();
      result = 'done';
    }
    if (result === 'done') {
      await this.sendPhotos().catch(() => undefined);
      if (Date.now() - this.lastMeAt > ME_EVERY_MS) {
        this.lastMeAt = Date.now();
        await session.refreshMe();
      }
    }
    await this.refreshPending().catch(() => undefined);
    await this.letGoIfFinished(result === 'done').catch(() => undefined);
    if (result === 'done') await this.refreshRoll().catch(() => undefined);
    this.sending = false;
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
      t('report.title'),
      `${t('report.date')}: ${new Date().toISOString()}`,
      `${t('report.browser')}: ${navigator.userAgent}`,
      `${t('report.installed')}: ${standalone}`,
      `${t('report.protected')}: ${this.persisted}`,
      `${t('report.used')}: ${estimate?.usage ? (estimate.usage / 1e6).toFixed(1) : '?'}`,
      `${t('report.intact')}: ${this.intact}`,
      `${t('report.people')}: ${this.electors.length}`,
      `${t('report.firstOpen')}: ${this.canary?.firstOpen}`,
      `${t('report.previousOpen')}: ${this.canary?.previousOpen}`,
      `${t('report.opens')}: ${this.canary?.opens}`,
      `${t('report.longestGap')}: ${this.canary?.longestGapDays.toFixed(2)}`,
      `${t('report.pending')}: ${this.pendingCount}`,
      `${t('report.noRoom')}: ${this.noRoom}`,
      `${t('report.tap', { count: this.tapSamples.length })}: ${tap.median?.toFixed(0)}/${tap.worst?.toFixed(0)}`,
      `${t('report.write', { count: this.writeSamples.length })}: ${write.median?.toFixed(0)}/${write.worst?.toFixed(0)}`,
    ].join('\n');
  }
}

export const app = new AppState();
