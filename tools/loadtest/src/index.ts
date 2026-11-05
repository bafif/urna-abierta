/**
 * Simulates the phones of an election against a server, to measure what a small machine takes.
 * Each phone has its own connection, with its own TLS handshake, as in real life.
 *
 *   node src/index.ts --url https://localhost:8443 --tables 100 --scenario storm --backlog 100 --jitter 30
 *   node src/index.ts --url https://localhost:8443 --tables 100 --scenario steady --seconds 60 --votes-per-hour 120
 */
import http from 'node:http';
import https from 'node:https';
import { parseArgs } from 'node:util';
import { MAX_BATCH, SCHEMA_VERSION, uuidv7, type Operation } from '@urna-abierta/domain';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://localhost:8443' },
    tables: { type: 'string', default: '10' },
    scenario: { type: 'string', default: 'storm' },
    backlog: { type: 'string', default: '100' },
    jitter: { type: 'string', default: '30' },
    seconds: { type: 'string', default: '60' },
    'votes-per-hour': { type: 'string', default: '120' },
    run: { type: 'string', default: `${Date.now()}` },
  },
});

const base = new URL(args.url!);
const secure = base.protocol === 'https:';
const TIMEOUT_MS = 10_000;

interface Counters {
  latencies: number[];
  failures: number;
  retries: number;
}
const counters: Counters = { latencies: [], failures: 0, retries: 0 };

class Phone {
  private readonly agent = secure
    ? new https.Agent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: false })
    : new http.Agent({ keepAlive: true, maxSockets: 1 });

  close(): void {
    this.agent.destroy();
  }

  request(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const request = (secure ? https : http).request(
        new URL(path, base),
        {
          method,
          agent: this.agent,
          timeout: TIMEOUT_MS,
          headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            counters.latencies.push(performance.now() - started);
            const text = Buffer.concat(chunks).toString();
            try {
              resolve({ status: response.statusCode ?? 0, json: text ? JSON.parse(text) : null });
            } catch {
              resolve({ status: response.statusCode ?? 0, json: null });
            }
          });
        },
      );
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', reject);
      request.end(payload);
    });
  }

  /** Like the app: on a failure it waits a growing, random time and tries again. */
  async withRetries(method: string, path: string, body?: unknown): Promise<any> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.request(method, path, body);
        if (response.status < 500) return response.json;
      } catch {
        // counted below, like a server error
      }
      counters.failures += 1;
      if (attempt >= 12) throw new Error('gave up');
      counters.retries += 1;
      const ceiling = Math.min(60_000, 2_500 * 2 ** attempt);
      await sleep(ceiling / 2 + Math.random() * (ceiling / 2));
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeOperation(table: string, device: string, seq: number): Operation {
  return {
    id: uuidv7(),
    schema: SCHEMA_VERSION,
    table,
    device,
    device_seq: seq,
    device_time: new Date().toISOString(),
    type: 'voter.marked',
    payload: { elector: `e-${seq}` },
  };
}

function percentile(sorted: number[], fraction: number): number {
  return sorted.length === 0 ? 0 : Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!);
}

const tableIds = Array.from({ length: Number(args.tables) }, (_, i) => `carga-${args.run}-${i}`);

async function countStored(phone: Phone, table: string): Promise<number> {
  let since = 0;
  let total = 0;
  for (;;) {
    const body = await phone.withRetries('GET', `/api/sync/pull?table=${table}&since=${since}`);
    total += body.operations.length;
    since = body.next;
    if (!body.more) return total;
  }
}

/** Every table was out of signal and all of them come back within the same few seconds. */
async function storm(): Promise<Record<string, unknown>> {
  const backlog = Number(args.backlog);
  const jitter = Number(args.jitter) * 1000;
  let firstBatches: Operation[][] = [];
  const results = await Promise.all(
    tableIds.map(async (table, tableIndex) => {
      await sleep(Math.random() * jitter);
      const phone = new Phone();
      const started = performance.now();
      const operations = Array.from({ length: backlog }, (_, i) => makeOperation(table, `d-${tableIndex}`, i));
      for (let i = 0; i < operations.length; i += MAX_BATCH) {
        const batch = operations.slice(i, i + MAX_BATCH);
        if (i === 0) firstBatches[tableIndex] = batch;
        const body = await phone.withRetries('POST', '/api/sync/push', { table, operations: batch });
        if (body.acked.length !== batch.length) throw new Error('operations not acknowledged');
      }
      await phone.withRetries('GET', `/api/sync/pull?table=${table}&since=0`);
      phone.close();
      return performance.now() - started;
    }),
  );
  const checker = new Phone();
  let lost = 0;
  const sample = tableIds.slice(0, Math.min(25, tableIds.length));
  for (const table of sample) {
    // Sending again must not duplicate anything.
    const index = tableIds.indexOf(table);
    await checker.withRetries('POST', '/api/sync/push', { table, operations: firstBatches[index] });
    lost += Math.abs(backlog - (await countStored(checker, table)));
  }
  checker.close();
  const sorted = [...results].sort((a, b) => a - b);
  firstBatches = [];
  return {
    table_sync_ms_p50: percentile(sorted, 0.5),
    table_sync_ms_p95: percentile(sorted, 0.95),
    table_sync_ms_max: Math.round(sorted[sorted.length - 1] ?? 0),
    tables_checked: sample.length,
    operations_lost_or_duplicated: lost,
  };
}

/** A normal hour at the busiest rate: votes arrive, and district chiefs watch their panel. */
async function steady(): Promise<Record<string, unknown>> {
  const stopAt = Date.now() + Number(args.seconds) * 1000;
  const meanGap = 3_600_000 / Number(args['votes-per-hour']);
  const fiscal = async (table: string, tableIndex: number) => {
    const phone = new Phone();
    let seq = 0;
    let since = 0;
    await sleep(Math.random() * meanGap);
    while (Date.now() < stopAt) {
      const operations = [makeOperation(table, `d-${tableIndex}`, seq)];
      seq += 1;
      await phone.withRetries('POST', '/api/sync/push', { table, operations });
      const body = await phone.withRetries('GET', `/api/sync/pull?table=${table}&since=${since}`);
      since = body.next;
      await sleep(-Math.log(1 - Math.random()) * meanGap);
    }
    phone.close();
  };
  const chief = async (index: number) => {
    const phone = new Phone();
    await sleep(Math.random() * 15_000);
    while (Date.now() < stopAt) {
      for (let i = index; i < Math.min(index + 10, tableIds.length); i += 1) {
        await phone.withRetries('GET', `/api/tables/${tableIds[i]}/summary`);
      }
      await sleep(15_000);
    }
    phone.close();
  };
  const chiefs: Promise<void>[] = [];
  for (let i = 0; i < tableIds.length; i += 10) chiefs.push(chief(i));
  await Promise.all([...tableIds.map(fiscal), ...chiefs]);
  return {};
}

const started = performance.now();
const extra = args.scenario === 'storm' ? await storm() : await steady();
const duration = performance.now() - started;
const sorted = [...counters.latencies].sort((a, b) => a - b);
console.log(
  JSON.stringify({
    scenario: args.scenario,
    tables: tableIds.length,
    requests: sorted.length,
    requests_per_second: Math.round((sorted.length / duration) * 1000),
    latency_ms_p50: percentile(sorted, 0.5),
    latency_ms_p95: percentile(sorted, 0.95),
    latency_ms_p99: percentile(sorted, 0.99),
    latency_ms_max: Math.round(sorted[sorted.length - 1] ?? 0),
    failed_attempts: counters.failures,
    retries: counters.retries,
    seconds: Math.round(duration / 1000),
    ...extra,
  }),
);
process.exit(0);
