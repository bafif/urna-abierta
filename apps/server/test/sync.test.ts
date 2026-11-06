import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { uuidv7, writePadron, type Operation } from '@urna-abierta/domain';
import { forgetActors, totpCode } from '../src/actor.ts';
import { buildApp, migrate, seedDemo } from '../src/app.ts';
import { diskPhotoStore, photoStoreFromEnv, PhotoStoreUnavailable, s3PhotoStore, type PhotoStore } from '../src/photo-store.ts';
import { fakeS3 } from './fake-s3.ts';

const url = process.env.TEST_DATABASE_URL;
const s3Endpoint = process.env.URNA_TEST_S3_ENDPOINT;

function operation(table: string, seq: number, elector = `e-${seq}`): Operation {
  return { id: uuidv7(), schema: 1, table, device: 'd-1', device_seq: seq, device_time: '2027-04-06T12:00:00.000Z', type: 'voter.marked', payload: { elector } };
}

describe.skipIf(!url)('against a real Postgres', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let demo: Awaited<ReturnType<typeof seedDemo>>;
  let table: string;
  let tokens: Record<string, string>;
  let photosFolder: string;

  const redeem = async (invitation: string) => (await app.inject({ method: 'POST', url: '/api/auth/redeem', payload: { token: invitation } })).json().token as string;
  const call = (who: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: object) =>
    app.inject({ method, url: path, payload, headers: { authorization: `Bearer ${tokens[who]}` } });
  const push = (who: string, tableId: string, operations: unknown[]) => call(who, 'POST', '/api/sync/push', { table: tableId, operations });

  async function pullAll(who: string, tableId: string): Promise<Operation[]> {
    const all: Operation[] = [];
    let since = 0;
    for (;;) {
      const body = (await call(who, 'GET', `/api/sync/pull?table=${tableId}&since=${since}`)).json();
      all.push(...body.operations);
      since = body.next;
      if (!body.more) return all;
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    await migrate(pool);
    process.env.URNA_FIELD_KEY = 'clave de prueba';
    photosFolder = await mkdtemp(join(tmpdir(), 'urna-fotos-prueba-'));
    app = buildApp(pool, { photos: diskPhotoStore(photosFolder) });
    await app.ready();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE settings, users, elections, invitations, devices, role_assignments, semaphore_categories CASCADE');
    demo = await seedDemo(pool, { size: 40, tables: 2 });
    table = demo.tables[0]!.table;
    tokens = {
      fiscal: await redeem(demo.tables[0]!.invitations[0]!),
      laura: await redeem(demo.tables[0]!.invitations[1]!),
      otra: await redeem(demo.tables[1]!.invitations[0]!),
      jefe: await redeem(demo.links.jefe!),
      coordinacion: await redeem(demo.links.coordinacion!),
      semaforo: await redeem(demo.links.semaforo!),
      estadistico: await redeem(demo.links.estadistico!),
    };
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await rm(photosFolder, { recursive: true, force: true });
  });

  describe('getting in', () => {
    it('nothing works without a device credential', async () => {
      expect((await app.inject({ url: `/api/sync/pull?table=${table}` })).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/me', headers: { authorization: 'Bearer inventado' } })).statusCode).toBe(401);
    });

    it('an invitation works only once', async () => {
      const { invitation } = (await call('coordinacion', 'POST', '/api/users', { name: 'Nueva', role: 'fiscal', table })).json();
      expect((await app.inject({ method: 'POST', url: '/api/auth/redeem', payload: { token: invitation } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/api/auth/redeem', payload: { token: invitation } })).statusCode).toBe(410);
    });

    it('the first administrator needs the code, and accepting responsibility, and happens once', async () => {
      await pool.query('TRUNCATE users, role_assignments, devices CASCADE');
      process.env.URNA_SETUP_CODE = 'codigo';
      const setup = (payload: object) => app.inject({ method: 'POST', url: '/api/setup', payload });
      expect((await app.inject({ url: '/api/public' })).json().setupNeeded).toBe(true);
      expect((await setup({ code: 'otro', name: 'Ana', accepted: true })).statusCode).toBe(403);
      expect((await setup({ code: 'codigo', name: 'Ana' })).statusCode).toBe(400);
      expect((await setup({ code: 'codigo', name: 'Ana', accepted: true })).statusCode).toBe(200);
      expect((await setup({ code: 'codigo', name: 'Eva', accepted: true })).statusCode).toBe(409);
    });

    it('a code brings a session to an installed app, once, and guessing gets blocked', async () => {
      const { code } = (await call('fiscal', 'POST', '/api/auth/handoff')).json();
      expect(code).toMatch(/^\d{8}$/);
      const redeem = (token: string, ip = '10.0.0.1') => app.inject({ method: 'POST', url: '/api/auth/redeem', payload: { token }, remoteAddress: ip });
      expect((await redeem(code)).statusCode).toBe(200);
      expect((await redeem(code)).statusCode).toBe(410);
      for (let i = 0; i < 9; i += 1) expect((await redeem(`mal-${i}`, '10.0.0.2')).statusCode).toBe(410);
      expect((await redeem('otra', '10.0.0.2')).statusCode).toBe(410);
      expect((await redeem('otra', '10.0.0.2')).statusCode).toBe(429);
      expect((await redeem('otra', '10.0.0.3')).statusCode).toBe(410);
    });

    it('with the stricter profiles, chiefs need a second step on each device and poll watchers do not', async () => {
      await pool.query(`INSERT INTO settings (key, value) VALUES ('security_profile', '"local"') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      expect((await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(200);
      expect((await call('jefe', 'GET', `/api/tables/${table}/bundle`)).json().error).toBe('second_factor_needed');
      expect((await call('jefe', 'GET', '/api/me')).json().secondFactorNeeded).toBe(true);
      const { secret } = (await call('jefe', 'POST', '/api/auth/second-factor/start')).json();
      expect((await call('jefe', 'POST', '/api/auth/second-factor/verify', { code: '000000' })).statusCode).toBe(403);
      const code = totpCode(secret, Math.floor(Date.now() / 30_000));
      expect((await call('jefe', 'POST', '/api/auth/second-factor/verify', { code })).statusCode).toBe(200);
      expect((await call('jefe', 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(200);
      expect((await call('jefe', 'POST', '/api/auth/second-factor/start')).json().enrolled).toBe(true);
    });

    it('removing someone stops their phone', async () => {
      const users = (await call('coordinacion', 'GET', '/api/users')).json().users;
      const marta = users.find((u: { name: string }) => u.name === 'Marta');
      await call('coordinacion', 'DELETE', `/api/users/${marta.id}`);
      expect((await call('fiscal', 'GET', '/api/me')).statusCode).toBe(401);
    });
  });

  describe('who sees what', () => {
    it('a poll watcher reaches only their own table', async () => {
      const other = demo.tables[1]!.table;
      expect((await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(200);
      expect((await call('fiscal', 'GET', `/api/tables/${other}/bundle`)).statusCode).toBe(403);
      expect((await push('fiscal', other, [operation(other, 1)])).statusCode).toBe(403);
      expect((await call('fiscal', 'GET', `/api/sync/pull?table=${other}&since=0`)).statusCode).toBe(403);
    });

    it('the roll that reaches a phone has no addresses and only the digits the election allows', async () => {
      await pool.query(`UPDATE electors SET address = 'Calle Falsa 123'`);
      await pool.query(`INSERT INTO settings (key, value) VALUES ('security_profile', '"nacional"') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      const { electors } = (await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).json();
      expect(JSON.stringify(electors)).not.toContain('Calle Falsa');
      expect(electors[0].documentSuffix).toHaveLength(3);
      expect(electors[0].document).toBeUndefined();
    });

    it('roles only reach their own work', async () => {
      expect((await call('fiscal', 'GET', '/api/users')).statusCode).toBe(403);
      expect((await call('fiscal', 'GET', `/api/elections/${demo.election}/stats`)).statusCode).toBe(403);
      expect((await call('fiscal', 'GET', `/api/elections/${demo.election}/people?q=acu`)).statusCode).toBe(403);
      expect((await call('estadistico', 'GET', `/api/elections/${demo.election}/people?q=acu`)).statusCode).toBe(403);
      expect((await call('estadistico', 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(403);
      expect((await call('semaforo', 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(403);
      expect((await call('jefe', 'GET', '/api/persons?q=acu')).statusCode).toBe(403);
      expect((await call('jefe', 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(200);
    });

    it('statistics never show a name or a group too small', async () => {
      await push('fiscal', table, [operation(table, 1)]);
      const body = (await call('estadistico', 'GET', `/api/elections/${demo.election}/stats`)).json();
      expect(body.people).toBe(80);
      expect(body.voted).toBe(1);
      expect(body.hours).toEqual([]);
      expect(JSON.stringify(body)).not.toMatch(/Acuña|document/);
    });
  });

  describe('sync', () => {
    it('stores an operation only once when the phone sends it again', async () => {
      const batch = [operation(table, 1), operation(table, 2)];
      for (let i = 0; i < 3; i += 1) expect((await push('fiscal', table, batch)).json().acked).toHaveLength(2);
      expect(await pullAll('fiscal', table)).toHaveLength(2);
    });

    it('a repeated operation inside the same batch is stored once', async () => {
      const one = operation(table, 1);
      expect((await push('fiscal', table, [one, one])).statusCode).toBe(200);
      expect(await pullAll('fiscal', table)).toHaveLength(1);
    });

    it('refuses a malformed operation without blocking the valid ones', async () => {
      const good = operation(table, 1);
      const body = (await push('fiscal', table, [{ ...operation(table, 2), id: 'x' }, good])).json();
      expect(body.acked).toEqual([good.id]);
      expect(body.rejected).toHaveLength(1);
    });

    it('refuses an operation of another table, and a batch too large', async () => {
      expect((await push('fiscal', table, [operation('otra', 1)])).json().rejected[0].reason).toBe('wrong_table');
      expect((await push('fiscal', table, Array.from({ length: 51 }, (_, i) => operation(table, i)))).statusCode).toBe(413);
    });

    it('a reader never skips an operation while several phones write at once', async () => {
      let done = false;
      const seen = new Set<string>();
      let since = 0;
      const reader = (async () => {
        while (!done) {
          const body = (await call('fiscal', 'GET', `/api/sync/pull?table=${table}&since=${since}`)).json();
          for (const item of body.operations) seen.add(item.id);
          since = body.next;
        }
      })();
      const expected = new Set<string>();
      await Promise.all(
        Array.from({ length: 12 }, async (_, phone) => {
          for (let b = 0; b < 8; b += 1) {
            const batch = Array.from({ length: 10 }, (_, i) => operation(table, phone * 1000 + b * 100 + i));
            for (const item of batch) expected.add(item.id);
            expect((await push(phone % 2 ? 'fiscal' : 'laura', table, batch)).statusCode).toBe(200);
          }
        }),
      );
      done = true;
      await reader;
      for (const item of await pullAll('fiscal', table)) seen.add(item.id);
      expect(seen.size).toBe(expected.size);
    });

    it('what arrives after the close is kept apart, not counted and not lost', async () => {
      await push('fiscal', table, [operation(table, 1)]);
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      expect((await push('fiscal', table, [operation(table, 2)])).json().acked).toHaveLength(1);
      expect(await pullAll('fiscal', table)).toHaveLength(1);
      const kept = await pool.query('SELECT count(*)::int AS n FROM operations WHERE quarantined');
      expect(kept.rows[0].n).toBe(1);
    });
  });

  describe('election day', () => {
    it('the chief sees the alert, the votes and how long a table has been silent', async () => {
      const mine = operation(table, 1, 'e-1');
      const theirs = operation(table, 2, 'e-1');
      const undo = { ...operation(table, 3), type: 'voter.unmarked', payload: { elector: 'e-1', cancels: [mine.id] } };
      const alert = { ...operation(table, 4), type: 'incident.reported', payload: { kind: 'urgent' } };
      await push('fiscal', table, [mine, theirs, undo, alert]);
      const { tables } = (await call('jefe', 'GET', `/api/district/${demo.election}`)).json();
      const mesa = tables.find((t: { id: string }) => t.id === table);
      expect(mesa.voted).toBe(1);
      expect(mesa.incidents).toHaveLength(1);
      expect(mesa.lastSync).toBeTruthy();
      expect((await call('fiscal', 'POST', `/api/incidents/${alert.id}/resolve`)).statusCode).toBe(403);
      expect((await call('jefe', 'POST', `/api/incidents/${alert.id}/resolve`)).statusCode).toBe(200);
      const detail = (await call('jefe', 'GET', `/api/tables/${table}/detail`)).json();
      expect(detail.incidents).toEqual([]);
    });

    it('compares the nightly envelope count with what was crossed out', async () => {
      const count = (envelopes: number, marked: number, seq: number) => ({ ...operation(table, seq), type: 'envelopes.counted', payload: { day: '2027-04-06', envelopes, marked } });
      await push('fiscal', table, [count(69, 69, 1), count(70, 69, 2)]);
      const { envelopes } = (await call('jefe', 'GET', `/api/tables/${table}/detail`)).json();
      expect(envelopes.map((e: { matches: boolean }) => e.matches)).toEqual([true, false]);
    });

    it('two counts that differ wait for a person: nothing merges them', async () => {
      const tally = (azul: number, seq: number) => ({ ...operation(table, seq), type: 'tally.submitted', payload: { category: 'cat-1', results: { l1: azul, l2: 10 } } });
      const [one, two] = [tally(100, 1), tally(101, 2)];
      await push('fiscal', table, [one, two]);
      let detail = (await call('jefe', 'GET', `/api/tables/${table}/detail`)).json();
      expect(detail.tallies[0]).toMatchObject({ disagree: true, chosen: null });
      expect((await call('jefe', 'POST', `/api/tables/${table}/tally/decide`, { category: 'cat-1', operation: two.id })).statusCode).toBe(200);
      detail = (await call('jefe', 'GET', `/api/tables/${table}/detail`)).json();
      expect(detail.tallies[0]).toMatchObject({ disagree: false, chosen: two.id });
    });

    it('a photo is only accepted if it matches its hash, and only its table can see it', async () => {
      const bytes = Buffer.from('foto de prueba');
      const sha = createHash('sha256').update(bytes).digest('hex');
      const put = (who: string, hash: string, where = table) => app.inject({ method: 'PUT', url: `/api/tables/${where}/photos/${hash}`, payload: bytes, headers: { authorization: `Bearer ${tokens[who]}`, 'content-type': 'image/jpeg' } });
      expect((await put('fiscal', 'a'.repeat(64))).statusCode).toBe(400);
      expect((await put('otra', sha)).statusCode).toBe(403);
      expect((await put('fiscal', sha)).statusCode).toBe(200);
      expect((await call('otra', 'GET', `/api/tables/${table}/photos/${sha}`)).statusCode).toBe(403);
      expect((await call('jefe', 'GET', `/api/tables/${table}/photos/${sha}`)).body).toBe('foto de prueba');
      // The same picture sent from another table belongs to that one as well.
      expect((await put('otra', sha, demo.tables[1]!.table)).statusCode).toBe(200);
      expect((await call('otra', 'GET', `/api/tables/${demo.tables[1]!.table}/photos/${sha}`)).body).toBe('foto de prueba');
      // On disk, as always, under its hash.
      expect((await diskPhotoStore(photosFolder).get(sha))?.toString()).toBe('foto de prueba');
      expect((await app.inject({ url: '/api/health' })).json()).toEqual({ ok: true, photos: { storage: 'disk' } });
    });

    it('when the photo storage fails, the phone hears 503 and nothing is recorded', async () => {
      let failing = true;
      const kept = new Map<string, Buffer>();
      const flaky: PhotoStore = {
        where: 'en ninguna parte',
        async put(sha, bytes) {
          if (failing) throw new PhotoStoreUnavailable('prueba');
          kept.set(sha, bytes);
        },
        async get(sha) {
          if (failing) throw new PhotoStoreUnavailable('prueba');
          return kept.get(sha) ?? null;
        },
        status: () => ({ storage: 's3', working: !failing }),
        probe: async () => !failing,
      };
      const other = buildApp(pool, { photos: flaky });
      try {
        const bytes = Buffer.from('foto que espera');
        const sha = createHash('sha256').update(bytes).digest('hex');
        const send = () => other.inject({ method: 'PUT', url: `/api/tables/${table}/photos/${sha}`, payload: bytes, headers: { authorization: `Bearer ${tokens.fiscal}`, 'content-type': 'image/jpeg' } });
        const fetchIt = () => other.inject({ url: `/api/tables/${table}/photos/${sha}`, headers: { authorization: `Bearer ${tokens.jefe}` } });
        const response = await send();
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: 'photo_storage_unavailable' });
        expect((await pool.query('SELECT 1 FROM photos WHERE sha256 = $1', [sha])).rowCount).toBe(0);
        expect(await diskPhotoStore(photosFolder).get(sha)).toBeNull();
        expect((await other.inject({ url: '/api/health' })).json()).toEqual({ ok: true, photos: { storage: 's3', working: false } });
        // The phone tries again later, and then it goes through.
        failing = false;
        expect((await send()).statusCode).toBe(200);
        expect((await fetchIt()).body).toBe('foto que espera');
        failing = true;
        expect((await fetchIt()).statusCode).toBe(503);
        // Recorded, but the store lost it: not found, never a crash.
        failing = false;
        kept.clear();
        expect((await fetchIt()).statusCode).toBe(404);
      } finally {
        await other.close();
      }
    });

    it('after switching to a bucket that cannot be listed, the photos from the disk are still served', async () => {
      const bytes = Buffer.from('foto de antes del bucket');
      const sha = createHash('sha256').update(bytes).digest('hex');
      const send = (to: FastifyInstance, payload: Buffer, hash: string) => to.inject({ method: 'PUT', url: `/api/tables/${table}/photos/${hash}`, payload, headers: { authorization: `Bearer ${tokens.fiscal}`, 'content-type': 'image/jpeg' } });
      expect((await send(app, bytes, sha)).statusCode).toBe(200);

      const credentials = { region: 'us-east-1', accessKeyId: 'prueba', secretAccessKey: 'secreto de prueba' };
      const bucket = await fakeS3(credentials);
      // As AWS answers a missing object when the key has no s3:ListBucket.
      bucket.denyListing(true);
      const photos = s3PhotoStore({ config: { ...credentials, endpoint: bucket.endpoint, bucket: 'fotos-prueba' }, prefix: 'fotos/', fieldKey: 'clave de prueba', previous: diskPhotoStore(photosFolder), log: { info: () => undefined, error: () => undefined } });
      const other = buildApp(pool, { photos });
      const fetchIt = (hash: string) => other.inject({ url: `/api/tables/${table}/photos/${hash}`, headers: { authorization: `Bearer ${tokens.jefe}` } });
      try {
        const old = await fetchIt(sha);
        expect(old.statusCode).toBe(200);
        expect(old.body).toBe('foto de antes del bucket');
        expect(bucket.requests).toHaveLength(0);
        // A new one goes to the bucket and comes back from it.
        const fresh = Buffer.from('foto nueva, en el bucket');
        const freshSha = createHash('sha256').update(fresh).digest('hex');
        expect((await send(other, fresh, freshSha)).statusCode).toBe(200);
        expect((await fetchIt(freshSha)).body).toBe('foto nueva, en el bucket');
        // Recorded but lost from both: not found, and the bucket is not marked as failing.
        bucket.objects.clear();
        expect((await fetchIt(freshSha)).statusCode).toBe(404);
        expect((await other.inject({ url: '/api/health' })).json()).toEqual({ ok: true, photos: { storage: 's3', working: true } });
      } finally {
        await other.close();
        await bucket.close();
      }
    });

    it.skipIf(!s3Endpoint)('photos also go through a real S3 bucket (URNA_TEST_S3_ENDPOINT)', async () => {
      const photos = photoStoreFromEnv({
        URNA_S3_ENDPOINT: s3Endpoint,
        URNA_S3_BUCKET: process.env.URNA_TEST_S3_BUCKET,
        URNA_S3_REGION: process.env.URNA_TEST_S3_REGION,
        URNA_S3_ACCESS_KEY_ID: process.env.URNA_TEST_S3_ACCESS_KEY_ID,
        URNA_S3_SECRET_ACCESS_KEY: process.env.URNA_TEST_S3_SECRET_ACCESS_KEY,
        URNA_S3_PREFIX: `prueba-${randomBytes(4).toString('hex')}/`,
        URNA_FIELD_KEY: 'clave de prueba',
        URNA_PHOTOS_DIR: photosFolder,
      });
      const other = buildApp(pool, { photos });
      try {
        expect(await photos.probe()).toBe(true);
        const bytes = randomBytes(200_000);
        const sha = createHash('sha256').update(bytes).digest('hex');
        const response = await other.inject({ method: 'PUT', url: `/api/tables/${table}/photos/${sha}`, payload: bytes, headers: { authorization: `Bearer ${tokens.fiscal}`, 'content-type': 'image/jpeg' } });
        expect(response.statusCode).toBe(200);
        expect(await diskPhotoStore(photosFolder).get(sha)).toBeNull();
        const back = await other.inject({ url: `/api/tables/${table}/photos/${sha}`, headers: { authorization: `Bearer ${tokens.jefe}` } });
        expect(back.statusCode).toBe(200);
        expect(back.rawPayload.equals(bytes)).toBe(true);
        expect((await other.inject({ url: '/api/health' })).json()).toEqual({ ok: true, photos: { storage: 's3', working: true } });
      } finally {
        await other.close();
      }
    });
  });

  describe('the roll', () => {
    const upload = (election: string, file: Uint8Array, preview = false) =>
      app.inject({ method: 'POST', url: `/api/elections/${election}/roll${preview ? '?preview=1' : ''}`, payload: Buffer.from(file), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'application/zip' } });
    const newElection = async () => (await call('coordinacion', 'POST', '/api/elections', { name: 'Otra', kind: 'estudiantil', days: ['2027-04-06'] })).json().id as string;
    const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p-${i}`, full_name: `Prueba${String(i).padStart(3, '0')}, Ana`, identifiers: [{ type: 'DNI', value: `99${i}` }], review: { status: i === 0 ? 'pending' : 'ok' } }));

    it('previews without touching, imports, and then proposes tables', async () => {
      const id = await newElection();
      const file = writePadron({ electors: people(25) as never });
      const preview = (await upload(id, file, true)).json();
      expect(preview).toMatchObject({ people: 25, added: 25, toReview: 1, withoutTable: 25 });
      expect((await pool.query('SELECT count(*)::int AS n FROM electors WHERE election_id = $1', [id])).rows[0].n).toBe(0);
      expect((await upload(id, file)).statusCode).toBe(200);
      expect((await call('coordinacion', 'POST', `/api/elections/${id}/tables/propose`, { size: 10 })).json().created).toBe(3);
      const { tables } = (await call('coordinacion', 'GET', `/api/elections/${id}/tables`)).json();
      expect(tables.map((t: { people: number }) => t.people)).toEqual([10, 10, 5]);
    });

    it('importing again keeps tables, and says who is new and who is missing', async () => {
      const id = await newElection();
      await upload(id, writePadron({ electors: people(25) as never }));
      await call('coordinacion', 'POST', `/api/elections/${id}/tables/propose`, { size: 10 });
      const preview = (await upload(id, writePadron({ electors: [...people(24), { id: 'nuevo', full_name: 'Nueva, Eva' }] as never }), true)).json();
      expect(preview).toMatchObject({ added: 1, kept: 24, missing: 1 });
      await upload(id, writePadron({ electors: people(25) as never }));
      const without = await pool.query('SELECT count(*)::int AS n FROM electors WHERE election_id = $1 AND table_id IS NULL', [id]);
      expect(without.rows[0].n).toBe(0);
    });

    it('refuses what it cannot read, and a roll made with an external AI if the election forbids it', async () => {
      const id = await newElection();
      expect((await upload(id, new TextEncoder().encode('nada'))).statusCode).toBe(422);
      await call('coordinacion', 'POST', `/api/users`, { name: 'x', role: 'sistema' });
      await pool.query(`INSERT INTO settings (key, value) VALUES ('security_profile', '"nacional"') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      await pool.query('UPDATE devices SET second_factor_at = now()');
      forgetActors();
      const res = await upload(id, writePadron({ electors: people(2) as never, externalAi: true }));
      expect(res.json().error).toBe('external_ai_forbidden');
    });
  });

  describe('backups', () => {
    it('only whoever looks after the system can list and download them, by exact name', async () => {
      const { mkdtemp, writeFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const folder = await mkdtemp(join(tmpdir(), 'urna-copias-'));
      await writeFile(join(folder, 'urna-20270406-120000.tar.gpg'), 'cifrado');
      await writeFile(join(folder, 'otra-cosa.txt'), 'no');
      process.env.URNA_BACKUPS_DIR = folder;
      expect((await call('coordinacion', 'GET', '/api/backups')).statusCode).toBe(403);
      const { invitation } = (await call('coordinacion', 'POST', '/api/users', { name: 'Sistemas', role: 'sistema' })).json();
      tokens.sistema = await redeem(invitation);
      const { backups } = (await call('sistema', 'GET', '/api/backups')).json();
      expect(backups.map((item: { name: string }) => item.name)).toEqual(['urna-20270406-120000.tar.gpg']);
      expect((await call('sistema', 'GET', '/api/backups/urna-20270406-120000.tar.gpg')).body).toBe('cifrado');
      expect((await call('sistema', 'GET', '/api/backups/otra-cosa.txt')).statusCode).toBe(400);
      expect((await call('sistema', 'GET', '/api/backups/..%2F..%2Fetc%2Fpasswd')).statusCode).toBe(400);
    });
  });

  describe('what a party can adjust', () => {
    it('a role can be edited, without leaving the system unmanageable, and it can go back to what is recommended', async () => {
      const { invitation } = (await call('coordinacion', 'POST', '/api/users', { name: 'Sistemas', role: 'sistema' })).json();
      tokens.sistema = await redeem(invitation);
      expect((await call('jefe', 'GET', `/api/elections/${demo.election}/stats`)).statusCode).toBe(403);
      const { recommended } = (await call('sistema', 'GET', '/api/roles')).json();
      const edit = (role: string, permissions: unknown) => call('sistema', 'PUT', `/api/roles/${role}`, { permissions });
      expect((await edit('jefe', [...recommended.jefe, 'stats.read'])).statusCode).toBe(200);
      expect((await call('jefe', 'GET', `/api/elections/${demo.election}/stats`)).statusCode).toBe(200);
      expect((await edit('jefe', ['inventado'])).statusCode).toBe(400);
      expect((await edit('sistema', ['audit.read'])).statusCode).toBe(409);
      expect((await call('jefe', 'PUT', '/api/roles/jefe', { permissions: [] })).statusCode).toBe(403);
      expect((await edit('jefe', null)).statusCode).toBe(200);
      expect((await call('jefe', 'GET', `/api/elections/${demo.election}/stats`)).statusCode).toBe(403);
    });

    it('taking away the work of a table really takes it away', async () => {
      const { invitation } = (await call('coordinacion', 'POST', '/api/users', { name: 'Sistemas', role: 'sistema' })).json();
      tokens.sistema = await redeem(invitation);
      expect((await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(200);
      await call('sistema', 'PUT', '/api/roles/fiscal', { permissions: [] });
      expect((await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(403);
      expect((await push('fiscal', table, [operation(table, 1)])).statusCode).toBe(403);
    });

    it('the role that only sees numbers expires by itself', async () => {
      await call('coordinacion', 'POST', '/api/users', { name: 'Numeritos', role: 'estadistico' });
      const row = await pool.query(`SELECT a.expires_at FROM role_assignments a JOIN users u ON u.id = a.user_id WHERE u.name = 'Numeritos'`);
      expect(new Date(row.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
    });

    it('shifts: each poll watcher works their days, and a table is covered only if every day is', async () => {
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const id = (await call('coordinacion', 'POST', '/api/elections', { name: 'Tres días', kind: 'estudiantil', days: [day(0), day(1), day(2)] })).json().id;
      const file = writePadron({ electors: Array.from({ length: 12 }, (_, i) => ({ id: `t-${i}`, full_name: `Turno${i}, Ana` })) as never });
      await app.inject({ method: 'POST', url: `/api/elections/${id}/roll`, payload: Buffer.from(file), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'application/zip' } });
      await call('coordinacion', 'POST', `/api/elections/${id}/tables/propose`, { size: 20 });
      const uncovered = async () => (await call('coordinacion', 'GET', '/api/elections')).json().elections.find((e: { id: string }) => e.id === id).tables_without_fiscal;
      const mesa = (await call('coordinacion', 'GET', `/api/elections/${id}/tables`)).json().tables[0].id;
      expect(await uncovered()).toBe(1);
      const first = (await call('coordinacion', 'POST', '/api/users', { name: 'Día Uno', role: 'fiscal', table: mesa, days: [day(0)] })).json();
      expect(await uncovered()).toBe(1);
      const second = (await call('coordinacion', 'POST', '/api/users', { name: 'Días Dos', role: 'fiscal', table: mesa, days: [day(1), day(2)] })).json();
      expect(await uncovered()).toBe(0);
      tokens.uno = await redeem(first.invitation);
      tokens.dos = await redeem(second.invitation);
      expect((await call('uno', 'GET', '/api/me')).json().table.shift).toEqual([day(0)]);
      expect((await call('dos', 'GET', '/api/me')).json().table.shift).toEqual([day(1), day(2)]);
      const { tables } = (await call('coordinacion', 'GET', `/api/elections/${id}/tables`)).json();
      expect(tables[0].fiscales.map((f: { name: string }) => f.name).sort()).toEqual(['Día Uno', 'Días Dos']);
    });

    it('poll watchers see the traffic light of their table only if the party allows it, and never a sensitive category', async () => {
      const color = '#E8A317';
      const open = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Puede ser', color })).json().id;
      const closed = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Milita', color, sensitive: true })).json().id;
      const users = (await call('coordinacion', 'GET', '/api/users')).json().users;
      await call('coordinacion', 'POST', `/api/users/${users.find((u: { name: string }) => u.name === 'Juli').id}/roles`, { role: 'semaforo_sensible' });
      const { electors } = (await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).json();
      const mark = (elector: string, category: string) => call('semaforo', 'PUT', `/api/elections/${demo.election}/people/${elector}/semaphore`, { category });
      expect((await mark(electors[0].id, open)).statusCode).toBe(200);
      expect((await mark(electors[1].id, closed)).statusCode).toBe(200);
      const roll = async () => (await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).json().electors;
      expect((await roll())[0].light).toBeUndefined();
      expect((await call('coordinacion', 'PUT', '/api/semaphore/fiscal-view', { enabled: true })).statusCode).toBe(200);
      expect((await roll())[0].light).toEqual({ name: 'Puede ser', color });
      expect((await roll())[1].light).toBeUndefined();
      await pool.query(`INSERT INTO settings (key, value) VALUES ('security_profile', '"nacional"') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      expect((await roll())[0].light).toBeUndefined();
    });

    it('the chief does not get alarmed at night: a table that closed its day is not silent', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const count = { ...operation(table, 1), type: 'envelopes.counted', payload: { day: today, envelopes: 0, marked: 0 } };
      await push('fiscal', table, [count]);
      const { tables } = (await call('jefe', 'GET', `/api/district/${demo.election}`)).json();
      expect(tables.find((t: { id: string }) => t.id === table).countedDays).toEqual([today]);
      const { elections } = (await call('jefe', 'GET', '/api/district/elections')).json();
      expect(elections[0].days).toContain(today);
    });
  });

  describe('themes a party adds', () => {
    it('only takes a theme that can be read, and anyone can see it before logging in', async () => {
      const color = '#101010';
      const colors = (texto: string) => Object.fromEntries(['superficie', 'superficie2', 'linea', 'margen', 'sobrePrimario', 'sobrePeligro', 'bienFondo'].map((k) => [k, '#ffffff']).concat([['fondo', '#ffffff'], ['texto', texto], ['suave', '#555555'], ['primario', color], ['acento', color], ['marca', color], ['peligro', '#a00000'], ['peligroFondo', '#ffffff'], ['peligroTexto', '#a00000'], ['bien', '#0a5a2a']]));
      const theme = { id: 'propio', nombre: 'Propio', fuentes: { titulo: 'Poppins' }, forma: { radio: '8px' }, recetas: { tachado: 'linea', cabecera: 'simple' }, claro: colors('#101010'), oscuro: colors('#101010') };
      const put = (body: object) => call('coordinacion', 'PUT', '/api/themes', { theme: body });
      expect((await put({ ...theme, claro: colors('#999999') })).json().error).toBe('theme_not_usable');
      expect((await put({ ...theme, forma: { radio: '8px;background:url(x)' } })).statusCode).toBe(422);
      expect((await call('fiscal', 'PUT', '/api/themes', { theme })).statusCode).toBe(403);
      expect((await put(theme)).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/public' })).json().themes[0].id).toBe('propio');
    });

    it('the fonts come in the same file, and each phone asks for them apart, once', async () => {
      const colors = Object.fromEntries(['superficie', 'superficie2', 'linea', 'margen', 'sobrePrimario', 'sobrePeligro', 'bienFondo', 'fondo', 'peligroFondo'].map((k) => [k, '#ffffff']).concat([['texto', '#101010'], ['suave', '#555555'], ['primario', '#101010'], ['acento', '#101010'], ['marca', '#101010'], ['peligro', '#a00000'], ['peligroTexto', '#a00000'], ['bien', '#0a5a2a']]));
      const bytes = Buffer.from(`wOF2${'x'.repeat(300_000)}`);
      const base = { nombre: 'Con letras', fuentes: { titulo: "'Mi Letra'" }, forma: { radio: '8px' }, recetas: { tachado: 'linea', cabecera: 'simple' }, claro: colors, oscuro: colors };
      const theme = { ...base, id: 'con-letras', archivosFuentes: [{ familia: 'Mi Letra', peso: '400', datos: `data:font/woff2;base64,${bytes.toString('base64')}` }] };
      expect((await call('coordinacion', 'PUT', '/api/themes', { theme })).statusCode).toBe(200);

      const open = await app.inject({ url: '/api/public' });
      expect(open.body.length).toBeLessThan(5_000);
      const font = open.json().themes.find((item: { id: string }) => item.id === 'con-letras').archivosFuentes[0];
      expect(font).toMatchObject({ familia: 'Mi Letra', peso: '400' });
      expect(font.datos).toBeUndefined();

      const got = await app.inject({ url: `/api/theme-fonts/${font.sha256}` });
      expect(got.statusCode).toBe(200);
      expect(got.rawPayload.equals(bytes)).toBe(true);
      expect(got.headers['content-type']).toContain('font/woff2');
      expect(got.headers['cache-control']).toContain('immutable');
      expect((await app.inject({ url: '/api/theme-fonts/nada' })).statusCode).toBe(400);

      // Replacing the theme takes away the font that nothing uses anymore.
      const other = Buffer.from(`wOF2${'y'.repeat(1000)}`);
      await call('coordinacion', 'PUT', '/api/themes', { theme: { ...theme, archivosFuentes: [{ familia: 'Mi Letra', datos: `data:font/woff2;base64,${other.toString('base64')}` }] } });
      expect((await app.inject({ url: `/api/theme-fonts/${font.sha256}` })).statusCode).toBe(404);
    });

    it('the theme of the installer gets in with the installation code, and only until the first administrator', async () => {
      const theme = { id: 'desde-instalador', nombre: 'Desde el instalador', fuentes: { titulo: 'Poppins' }, forma: { radio: '8px' }, recetas: { tachado: 'linea', cabecera: 'simple' } };
      const colors = Object.fromEntries(['superficie', 'superficie2', 'linea', 'margen', 'sobrePrimario', 'sobrePeligro', 'bienFondo', 'fondo', 'peligroFondo'].map((k) => [k, '#ffffff']).concat([['texto', '#101010'], ['suave', '#555555'], ['primario', '#101010'], ['acento', '#101010'], ['marca', '#101010'], ['peligro', '#a00000'], ['peligroTexto', '#a00000'], ['bien', '#0a5a2a']]));
      const full = { ...theme, claro: colors, oscuro: colors };
      process.env.URNA_SETUP_CODE = 'codigo';
      await pool.query('TRUNCATE users, role_assignments, devices CASCADE');
      const send = (code: string, body: object) => app.inject({ method: 'PUT', url: '/api/setup/theme', payload: { code, theme: body } });
      expect((await send('otro', full)).statusCode).toBe(403);
      expect((await send('codigo', { ...full, claro: { ...colors, texto: '#999999' } })).statusCode).toBe(422);
      expect((await send('codigo', full)).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/public' })).json().themes.map((item: { id: string }) => item.id)).toContain('desde-instalador');
      await app.inject({ method: 'POST', url: '/api/setup', payload: { code: 'codigo', name: 'Ana', accepted: true } });
      expect((await send('codigo', full)).statusCode).toBe(409);
    });
  });

  describe('traffic light and personal data', () => {
    it('starts empty, and a sensitive category needs its own permission', async () => {
      expect((await call('semaforo', 'GET', '/api/semaphore/categories')).json().categories).toEqual([]);
      const open = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Puede ser', color: '#E8A317' })).json().id;
      const closed = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Milita', color: '#D93A3A', sensitive: true })).json().id;
      expect((await call('semaforo', 'GET', '/api/semaphore/categories')).json().categories).toHaveLength(1);
      const person = (await call('semaforo', 'GET', `/api/elections/${demo.election}/people?q=a`)).json();
      expect(person.people).toEqual([]);
      const found = (await call('semaforo', 'GET', `/api/elections/${demo.election}/people?q=ez`)).json().people[0];
      const mark = (category: string) => call('semaforo', 'PUT', `/api/elections/${demo.election}/people/${found.id}/semaphore`, { category });
      expect((await mark(open)).statusCode).toBe(200);
      expect((await mark(closed)).statusCode).toBe(403);
      const users = (await call('coordinacion', 'GET', '/api/users')).json().users;
      await call('coordinacion', 'POST', `/api/users/${users.find((u: { name: string }) => u.name === 'Juli').id}/roles`, { role: 'semaforo_sensible' });
      expect((await mark(closed)).statusCode).toBe(200);
      const stored = await pool.query('SELECT category_id, sealed FROM semaphore_marks');
      expect(stored.rows[0].category_id).toBeNull();
      expect(stored.rows[0].sealed).not.toContain(closed);
      const again = (await call('semaforo', 'GET', `/api/elections/${demo.election}/people?q=ez`)).json().people.find((p: { id: string }) => p.id === found.id);
      expect(again.category).toBe(closed);
    });

    it('finds, exports, records consent and erases a person, and purges an election', async () => {
      const found = (await call('coordinacion', 'GET', '/api/persons?q=acu')).json().people[0];
      expect(found.document).toBeTruthy();
      const base = `/api/persons/${found.election_id}/${found.id}`;
      expect((await call('coordinacion', 'PUT', `${base}/consent`, { date: '2027-01-01', means: 'firma' })).statusCode).toBe(200);
      expect((await call('coordinacion', 'GET', `${base}/export`)).json().person.consent.means).toBe('firma');
      expect((await call('coordinacion', 'DELETE', base)).statusCode).toBe(200);
      expect((await call('coordinacion', 'GET', '/api/persons?q=borrado')).json().people).toEqual([]);
      const erased = (await pool.query('SELECT full_name, document FROM electors WHERE id = $1', [found.id])).rows[0];
      expect(erased).toEqual({ full_name: 'Borrado a pedido', document: null });

      expect((await call('coordinacion', 'POST', `/api/elections/${demo.election}/purge`)).statusCode).toBe(409);
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      expect((await call('coordinacion', 'POST', `/api/elections/${demo.election}/purge`)).statusCode).toBe(200);
      const left = await pool.query(`SELECT count(*)::int AS n FROM electors WHERE election_id = $1 AND (full_name <> '' OR document IS NOT NULL)`, [demo.election]);
      expect(left.rows[0].n).toBe(0);
    });

    it('the audit log records who did what, and cannot be changed', async () => {
      await call('fiscal', 'GET', `/api/tables/${table}/bundle`);
      const { entries } = (await call('coordinacion', 'GET', '/api/audit')).json();
      expect(entries.some((e: { action: string; who: string }) => e.action === 'roll.downloaded' && e.who === 'Marta')).toBe(true);
      await expect(pool.query('DELETE FROM audit_log')).rejects.toThrow(/cannot be changed/);
      await expect(pool.query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/cannot be changed/);
      expect((await call('fiscal', 'GET', '/api/audit')).statusCode).toBe(403);
    });
  });
});
