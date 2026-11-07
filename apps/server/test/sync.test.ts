import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { uuidv7, writePadron, type Operation } from '@urna-abierta/domain';
import { forgetActors, totpCode } from '../src/actor.ts';
import { buildApp, migrate, seedDemo } from '../src/app.ts';
import { clock } from '../src/clock.ts';
import { eraseElector } from '../src/routes-work.ts';
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
    // What the server remembers of roles a test edited goes with them.
    forgetActors();
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

    it('the server may keep only a hash of the setup code, as the installer leaves it', async () => {
      await pool.query('TRUNCATE users, role_assignments, devices CASCADE');
      const { URNA_SETUP_CODE: before } = process.env;
      delete process.env.URNA_SETUP_CODE;
      process.env.URNA_SETUP_CODE_HASH = createHash('sha256').update('CODIGO123456').digest('hex');
      try {
        const setup = (code: string) => app.inject({ method: 'POST', url: '/api/setup', payload: { code, name: 'Ana', accepted: true } });
        const theme = (code: string) => app.inject({ method: 'PUT', url: '/api/setup/theme', payload: { code, theme: {} } });
        expect((await setup(process.env.URNA_SETUP_CODE_HASH)).statusCode).toBe(403);
        expect((await theme('OTRO')).statusCode).toBe(403);
        expect((await theme('CODIGO123456')).statusCode).toBe(422);
        expect((await setup('CODIGO123456')).statusCode).toBe(200);
      } finally {
        delete process.env.URNA_SETUP_CODE_HASH;
        if (before !== undefined) process.env.URNA_SETUP_CODE = before;
      }
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

    it('an open election holds the security level of its kind, on the server and for everyone', async () => {
      const { invitation } = (await call('coordinacion', 'POST', '/api/users', { name: 'Sistemas', role: 'sistema' })).json();
      tokens.sistema = await redeem(invitation);
      expect((await call('jefe', 'GET', '/api/me')).json().secondFactorNeeded).toBe(false);
      const id = (await call('coordinacion', 'POST', '/api/elections', { name: 'Nacional', kind: 'nacional', days: ['2027-10-24'] })).json().id;
      // From here on administrators need the second step too: this test gives it to all but the chief.
      expect((await call('coordinacion', 'GET', '/api/users')).json().error).toBe('second_factor_needed');
      const jefe = (await pool.query(`SELECT id FROM users WHERE name = 'Rubén'`)).rows[0].id;
      await pool.query('UPDATE devices SET second_factor_at = now() WHERE user_id <> $1', [jefe]);
      forgetActors();
      const me = (await call('jefe', 'GET', '/api/me')).json();
      expect(me.secondFactorNeeded).toBe(true);
      expect(me.security).toMatchObject({ profile: 'nacional', minimum: 'nacional', choice: 'estudiantil' });
      expect((await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).json().electors[0].documentSuffix).toHaveLength(3);
      expect((await call('coordinacion', 'PUT', '/api/semaphore/fiscal-view', { enabled: true })).statusCode).toBe(409);
      // Nobody lowers it while that election is open, not even whoever looks after the system.
      const lower = await call('sistema', 'PUT', '/api/security', { profile: 'local' });
      expect(lower.statusCode).toBe(409);
      expect(lower.json()).toEqual({ error: 'election_needs_more', minimum: 'nacional' });
      // Keeping what the party had chosen lowers nothing, and does not turn the election's level into the party's choice.
      expect((await call('sistema', 'PUT', '/api/security', { profile: 'estudiantil' })).statusCode).toBe(200);
      expect((await call('jefe', 'GET', '/api/me')).json().security).toMatchObject({ profile: 'nacional', choice: 'estudiantil' });
      for (const status of ['jornada', 'escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${id}/status`, { status });
      expect((await call('sistema', 'PUT', '/api/security', { profile: 'estudiantil' })).statusCode).toBe(200);
      expect((await call('jefe', 'GET', '/api/me')).json().secondFactorNeeded).toBe(false);
      expect((await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).json().electors[0].documentSuffix).toHaveLength(8);
    });

    it('removing someone stops their phone', async () => {
      const users = (await call('coordinacion', 'GET', '/api/users')).json().users;
      const marta = users.find((u: { name: string }) => u.name === 'Marta');
      await call('coordinacion', 'DELETE', `/api/users/${marta.id}`);
      expect((await call('fiscal', 'GET', '/api/me')).statusCode).toBe(401);
    });
  });

  describe('invitations', () => {
    /** The second table goes to a district of its own: the chief of the demo keeps only the first. */
    const twoDistricts = async () => {
      const other = randomUUID();
      await pool.query('INSERT INTO units (id, election_id, name) VALUES ($1, $2, $3)', [other, demo.election, 'Otro distrito']);
      await pool.query('UPDATE polling_tables SET unit_id = $2 WHERE id = $1', [demo.tables[1]!.table, other]);
    };
    const newFiscal = async (name: string, mesa: string) => (await call('coordinacion', 'POST', '/api/users', { name, role: 'fiscal', table: mesa, phone: '+54 9 341 333-3333' })).json().id as string;
    const names = (response: { json: () => { invitations: { name: string }[] } }) => response.json().invitations.map((item) => item.name).sort();

    it('a district chief gets links only for the poll watchers of their own tables', async () => {
      await twoDistricts();
      await newFiscal('Propia', table);
      await newFiscal('Ajena', demo.tables[1]!.table);
      expect(names(await call('jefe', 'POST', `/api/elections/${demo.election}/invitations`))).toEqual(['Propia']);
      expect(names(await call('coordinacion', 'POST', `/api/elections/${demo.election}/invitations`))).toEqual(['Ajena', 'Propia']);
    });

    it('a chief who invites a poll watcher of their table who also does something else gets no link for them', async () => {
      const id = await newFiscal('Doble', table);
      await call('coordinacion', 'POST', `/api/users/${id}/roles`, { role: 'semaforo' });
      expect(names(await call('jefe', 'POST', `/api/elections/${demo.election}/invitations`))).toEqual([]);
    });

    it('without managing people, someone invites only a poll watcher of their tables, and never someone who can do more', async () => {
      await twoDistricts();
      const users = (await call('coordinacion', 'GET', '/api/users')).json().users as { id: string; name: string }[];
      const idOf = (name: string) => users.find((user) => user.name === name)!.id;
      const invite = (who: string, target: string) => call(who, 'POST', `/api/users/${target}/invitation`);
      const links = async (target: string) => (await pool.query('SELECT count(*)::int AS n FROM invitations WHERE user_id = $1', [target])).rows[0].n as number;
      const before = await links(idOf('Coordinación'));
      for (const target of ['Coordinación', 'Juli', 'Ana', 'Fiscal 1']) expect((await invite('jefe', idOf(target))).json()).toEqual({ error: 'forbidden' });
      expect(await links(idOf('Coordinación'))).toBe(before);
      expect((await invite('jefe', idOf('Marta'))).statusCode).toBe(200);
      // A poll watcher of their table who also notes the traffic light could do more than the chief.
      await call('coordinacion', 'POST', `/api/users/${idOf('Marta')}/roles`, { role: 'semaforo' });
      expect((await invite('jefe', idOf('Marta'))).statusCode).toBe(403);
      // So could every poll watcher, once the party lets them do something the chief cannot.
      expect((await invite('jefe', idOf('Laura'))).statusCode).toBe(200);
      await call('coordinacion', 'PUT', '/api/roles/fiscal', { permissions: ['table.work', 'semaphore.read'] });
      expect((await invite('jefe', idOf('Laura'))).statusCode).toBe(403);
      await call('coordinacion', 'PUT', '/api/roles/fiscal', { permissions: null });
      // Nobody gets a link for someone who is not there.
      expect((await invite('coordinacion', randomUUID())).statusCode).toBe(404);
      expect((await invite('coordinacion', 'no-es-un-id')).statusCode).toBe(404);
      // Whoever manages people can already give anyone any role: they invite anyone.
      for (const target of ['Coordinación', 'Juli', 'Fiscal 1']) expect((await invite('coordinacion', idOf(target))).statusCode).toBe(200);
    });

    it('a device from the link of someone who does not manage people cannot set up the second step of whoever never did', async () => {
      const marta = ((await call('coordinacion', 'GET', '/api/users')).json().users as { id: string; name: string }[]).find((user) => user.name === 'Marta')!.id;
      // The chief's link for a poll watcher of their table, who later gets a role that asks for the second step.
      tokens.copia = await redeem((await call('jefe', 'POST', `/api/users/${marta}/invitation`)).json().invitation);
      const fromCoordination = (await call('coordinacion', 'POST', `/api/users/${marta}/invitation`)).json().invitation as string;
      await call('coordinacion', 'POST', `/api/users/${marta}/roles`, { role: 'semaforo' });
      await pool.query(`INSERT INTO settings (key, value) VALUES ('security_profile', '"local"') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      // That device stays a poll watcher, who needs no second step; and it cannot set it up either.
      expect((await call('copia', 'GET', '/api/me')).json()).toMatchObject({ roles: ['fiscal'], secondFactorNeeded: false });
      const start = await call('copia', 'POST', '/api/auth/second-factor/start');
      expect([start.statusCode, start.json()]).toEqual([403, { error: 'needs_new_invitation' }]);
      expect((await call('copia', 'POST', '/api/auth/second-factor/verify', { code: '123456' })).json()).toEqual({ error: 'needs_new_invitation' });
      // Nor does a code it makes for an installed app.
      tokens.instalada = await redeem((await call('copia', 'POST', '/api/auth/handoff')).json().code);
      expect((await call('instalada', 'POST', '/api/auth/second-factor/start')).json()).toEqual({ error: 'needs_new_invitation' });
      // With a link from whoever manages people, the person sets it up, and from then on any phone of theirs proves it with the code.
      tokens.nueva = await redeem(fromCoordination);
      const { secret } = (await call('nueva', 'POST', '/api/auth/second-factor/start')).json();
      const code = () => totpCode(secret, Math.floor(Date.now() / 30_000));
      expect((await call('nueva', 'POST', '/api/auth/second-factor/verify', { code: code() })).statusCode).toBe(200);
      expect((await call('copia', 'POST', '/api/auth/second-factor/start')).json()).toEqual({ enrolled: true });
      expect((await call('copia', 'POST', '/api/auth/second-factor/verify', { code: code() })).statusCode).toBe(200);
    });

    it('a device from the link of someone who does not manage people stays the poll watcher it was made for, whatever the person gets later', async () => {
      const marta = ((await call('coordinacion', 'GET', '/api/users')).json().users as { id: string; name: string }[]).find((user) => user.name === 'Marta')!.id;
      tokens.copia = await redeem((await call('jefe', 'POST', `/api/users/${marta}/invitation`)).json().invitation);
      tokens.instalada = await redeem((await call('copia', 'POST', '/api/auth/handoff')).json().code);
      await call('coordinacion', 'POST', `/api/users/${marta}/roles`, { role: 'coordinacion' });
      await call('coordinacion', 'PUT', '/api/roles/fiscal', { permissions: ['table.work', 'semaphore.read'] });
      for (const device of ['copia', 'instalada']) {
        expect((await call(device, 'GET', '/api/users')).statusCode).toBe(403);
        expect((await call(device, 'GET', '/api/elections')).statusCode).toBe(403);
        expect((await call(device, 'GET', '/api/semaphore/categories')).statusCode).toBe(403);
        expect((await call(device, 'POST', `/api/users/${marta}/roles`, { role: 'semaforo_sensible' })).statusCode).toBe(403);
        expect((await call(device, 'GET', '/api/me')).json().roles).toEqual(['fiscal']);
        // Their table, as the chief could hand it.
        expect((await call(device, 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(200);
      }
      // With a link from whoever manages people, the person gets all they were given.
      tokens.nueva = await redeem((await call('coordinacion', 'POST', `/api/users/${marta}/invitation`)).json().invitation);
      expect((await call('nueva', 'GET', '/api/users')).statusCode).toBe(200);
      expect((await call('nueva', 'GET', '/api/semaphore/categories')).statusCode).toBe(200);
      expect((await pool.query(`SELECT count(*)::int AS n FROM role_assignments WHERE user_id = $1 AND role = 'semaforo_sensible'`, [marta])).rows[0].n).toBe(0);
      await call('coordinacion', 'PUT', '/api/roles/fiscal', { permissions: null });
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

    it('no field of the roll on a phone holds a whole document, not even the id of each person', async () => {
      // Ids as the rolls bring them: the whole document inside.
      await pool.query(`UPDATE electors SET id = 'd-' || document WHERE table_id = $1`, [table]);
      const documents: string[] = (await pool.query('SELECT document FROM electors WHERE table_id = $1', [table])).rows.map((row) => row.document);
      expect(documents).toHaveLength(40);
      const profile = (name: string) => pool.query(`INSERT INTO settings (key, value) VALUES ('security_profile', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(name)]);
      const bundle = async () => (await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).json();
      for (const name of ['local', 'nacional']) {
        await profile(name);
        const { electors } = await bundle();
        expect(electors).toHaveLength(40);
        const fields: string[] = electors.flatMap((elector: object) => Object.values(elector).map((value) => JSON.stringify(value)));
        expect(fields.filter((field) => documents.some((document) => field.includes(document)))).toEqual([]);
      }
      // In a student election every digit may show, but never inside the id.
      await profile('estudiantil');
      const { electors } = await bundle();
      expect(electors[0].documentSuffix).toHaveLength(8);
      expect(electors.filter((elector: { id: string }) => documents.some((document) => elector.id.includes(document)))).toEqual([]);
      expect(new Set(electors.map((elector: { id: string }) => elector.id)).size).toBe(40);
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

    it('hours come in a form every browser reads', async () => {
      await push('fiscal', table, Array.from({ length: 5 }, (_, i) => operation(table, i + 1)));
      const { hours } = (await call('estadistico', 'GET', `/api/elections/${demo.election}/stats`)).json();
      expect(hours).toEqual([{ hour: '2027-04-06T12:00:00Z', marks: 5 }]);
      expect(new Date(hours[0].hour).getTime()).toBe(Date.UTC(2027, 3, 6, 12));
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

    it('pulling also says what time it is on the server, so that a phone with the wrong date can tell', async () => {
      const body = (await call('fiscal', 'GET', `/api/sync/pull?table=${table}&since=0`)).json();
      expect(Math.abs(Date.parse(body.server_time) - Date.now())).toBeLessThan(60_000);
    });

    it('a phone prepared before the random ids gets its marks counted under the new id, and the old one is not stored', async () => {
      await pool.query(`UPDATE electors SET id = 'd-' || document WHERE table_id = $1`, [table]);
      const person = (await pool.query('SELECT id, public_id FROM electors WHERE table_id = $1 ORDER BY order_number LIMIT 1', [table])).rows[0];
      const old = operation(table, 1, person.id);
      const undo = { ...operation(table, 2), type: 'voter.unmarked', payload: { elector: person.id, cancels: [old.id] } };
      expect((await push('fiscal', table, [old, undo])).json().acked).toHaveLength(2);
      const pulled = await pullAll('laura', table);
      expect(pulled.map((item) => (item.payload as { elector: string }).elector)).toEqual([person.public_id, person.public_id]);
      expect((await pool.query(`SELECT 1 FROM operations WHERE payload->>'elector' = $1`, [person.id])).rowCount).toBe(0);
    });

    it('after the purge, a mark from a phone that was offline is acknowledged and dropped, and anything else waits apart', async () => {
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      expect((await call('coordinacion', 'POST', `/api/elections/${demo.election}/purge`)).statusCode).toBe(200);
      const mark = operation(table, 1);
      const alert = { ...operation(table, 2), type: 'incident.reported', payload: { kind: 'urgent' } };
      expect((await push('fiscal', table, [mark, alert])).json().acked).toEqual([mark.id, alert.id]);
      const stored = await pool.query('SELECT type, quarantined FROM operations WHERE table_id = $1', [table]);
      expect(stored.rows).toEqual([{ type: 'incident.reported', quarantined: true }]);
    });

    it('the purge counts at once, also when phones were already sending after the close', async () => {
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      // This one makes the server remember the election as closed.
      const alert = { ...operation(table, 1), type: 'incident.reported', payload: { kind: 'urgent' } };
      expect((await push('fiscal', table, [alert])).json().acked).toEqual([alert.id]);
      expect((await call('coordinacion', 'POST', `/api/elections/${demo.election}/purge`)).statusCode).toBe(200);
      const mark = operation(table, 2);
      expect((await push('fiscal', table, [mark])).json().acked).toEqual([mark.id]);
      const stored = await pool.query('SELECT type FROM operations WHERE table_id = $1', [table]);
      expect(stored.rows).toEqual([{ type: 'incident.reported' }]);
    });

    it('naming someone of another table by the id of the roll says nothing about whether they are on it', async () => {
      const other = demo.tables[1]!.table;
      const theirs = (await pool.query('SELECT id, public_id FROM electors WHERE table_id = $1 ORDER BY order_number LIMIT 1', [other])).rows[0];
      const real = operation(table, 1, theirs.id);
      const invented = operation(table, 2, `${other}-nadie`);
      expect((await push('fiscal', table, [real, invented])).json().acked).toHaveLength(2);
      // Both come back as they were sent: a real person and an invented one look the same.
      expect((await pullAll('fiscal', table)).map((item) => (item.payload as { elector: string }).elector)).toEqual([theirs.id, `${other}-nadie`]);
      expect((await pool.query(`SELECT 1 FROM operations WHERE payload->>'elector' = $1`, [theirs.public_id])).rowCount).toBe(0);
    });

    it('what arrives after the close is kept apart, not counted and not lost', async () => {
      await push('fiscal', table, [operation(table, 1)]);
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      expect((await push('fiscal', table, [operation(table, 2)])).json().acked).toHaveLength(1);
      expect(await pullAll('coordinacion', table)).toHaveLength(1);
      const kept = await pool.query('SELECT count(*)::int AS n FROM operations WHERE quarantined');
      expect(kept.rows[0].n).toBe(1);
    });

    it('closing the election takes the roll away from poll watchers and chiefs, and only the tally photo stays for the chief', async () => {
      const bytes = Buffer.from('acta');
      const sha = createHash('sha256').update(bytes).digest('hex');
      const photo = (who: string) => call(who, 'GET', `/api/tables/${table}/photos/${sha}`);
      await app.inject({ method: 'PUT', url: `/api/tables/${table}/photos/${sha}`, payload: bytes, headers: { authorization: `Bearer ${tokens.fiscal}`, 'content-type': 'image/jpeg' } });
      await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status: 'escrutinio' });
      expect((await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(200);
      await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status: 'cerrada' });
      for (const who of ['fiscal', 'jefe']) {
        const bundle = await call(who, 'GET', `/api/tables/${table}/bundle`);
        expect(bundle.statusCode).toBe(410);
        expect(bundle.json().error).toBe('election_closed');
        expect((await call(who, 'GET', `/api/sync/pull?table=${table}&since=0`)).statusCode).toBe(410);
      }
      expect((await photo('fiscal')).statusCode).toBe(410);
      expect((await photo('jefe')).body).toBe('acta');
      // Whoever runs the election still sees it all, to review what came late.
      expect((await call('coordinacion', 'GET', `/api/tables/${table}/bundle`)).statusCode).toBe(200);
      expect((await call('coordinacion', 'GET', `/api/sync/pull?table=${table}&since=0`)).statusCode).toBe(200);
      // And the phone hears how long it may keep the roll.
      expect((await call('fiscal', 'GET', '/api/me')).json().security.localHoursAfterClose).toBe(12);
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

    it('an alert that arrives after the close shows on the panel and on the table, said so, and can be resolved', async () => {
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      const alert = { ...operation(table, 1), type: 'incident.reported', payload: { kind: 'urgent' } };
      await push('fiscal', table, [alert]);
      const panel = async () => (await call('jefe', 'GET', `/api/district/${demo.election}`)).json().tables.find((t: { id: string }) => t.id === table);
      expect((await panel()).incidents).toHaveLength(1);
      expect((await call('jefe', 'GET', `/api/tables/${table}/detail`)).json().incidents).toEqual([{ id: alert.id, at: alert.device_time, kind: 'urgent', late: true }]);
      expect((await call('jefe', 'POST', `/api/incidents/${alert.id}/resolve`)).statusCode).toBe(200);
      expect((await call('jefe', 'GET', `/api/tables/${table}/detail`)).json().incidents).toEqual([]);
      expect((await panel()).incidents).toEqual([]);
    });

    it('the plan B goes to someone with a phone: the chief of the table, one of the whole election, then coordination', async () => {
      const contact = async () => (await call('fiscal', 'GET', '/api/me')).json().contact;
      expect(await contact()).toEqual({ name: 'Rubén', phone: '+54 9 341 000-0000' });
      await pool.query(`UPDATE users SET phone = '' WHERE name = 'Rubén'`);
      expect((await contact()).name).toBe('Coordinación');
      // A chief of the whole election has no district.
      expect((await call('coordinacion', 'POST', '/api/users', { name: 'Toda la elección', role: 'jefe', phone: '0341 15 333-3333' })).statusCode).toBe(200);
      expect(await contact()).toEqual({ name: 'Toda la elección', phone: '+5493413333333' });
      await pool.query(`UPDATE users SET phone = NULL WHERE name IN ('Toda la elección', 'Coordinación')`);
      // Nobody has a phone: the chief of the table, at least by name.
      expect(await contact()).toEqual({ name: 'Rubén', phone: '' });
    });

    it('a phone is kept in international form, so that WhatsApp opens; one with no area code stays as typed', async () => {
      const add = async (phone: string) => {
        const { id } = (await call('coordinacion', 'POST', '/api/users', { name: `Tel ${phone}`, role: 'fiscal', table, phone })).json();
        return (await pool.query('SELECT phone FROM users WHERE id = $1', [id])).rows[0].phone;
      };
      expect(await add('0341 15 555-1234')).toBe('+5493415551234');
      expect(await add('+54 9 11 5555-1234')).toBe('+5491155551234');
      expect(await add('15 555-1234')).toBe('15 555-1234');
      expect(await add('')).toBeNull();
    });

    it('at ten at night in Argentina it is still that day: the poll watcher keeps their table and the chief calls them', async () => {
      const id = (await call('coordinacion', 'POST', '/api/elections', { name: 'Dos días', kind: 'estudiantil', days: ['2027-04-06', '2027-04-07'] })).json().id;
      expect((await call('coordinacion', 'POST', '/api/elections', { name: 'Sin zona', kind: 'estudiantil', days: ['2027-04-06'], timeZone: 'Marte/Olympus' })).statusCode).toBe(400);
      const file = writePadron({ electors: Array.from({ length: 20 }, (_, i) => ({ id: `n-${i}`, full_name: `Noche${String(i).padStart(2, '0')}, Ana` })) as never });
      await app.inject({ method: 'POST', url: `/api/elections/${id}/roll`, payload: Buffer.from(file), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'application/zip' } });
      await call('coordinacion', 'POST', `/api/elections/${id}/tables/propose`, { size: 10 });
      const [first, second] = (await call('coordinacion', 'GET', `/api/elections/${id}/tables`)).json().tables.map((t: { id: string }) => t.id);
      await call('coordinacion', 'POST', `/api/elections/${id}/status`, { status: 'jornada' });
      // One person, a different table each day; and on the first table, someone else the second day.
      const night = (await call('coordinacion', 'POST', '/api/users', { name: 'Nocturna', role: 'fiscal', table: first, days: ['2027-04-06'] })).json();
      await pool.query(`INSERT INTO role_assignments (id, user_id, role, table_id, days) VALUES (gen_random_uuid(), $1, 'fiscal', $2, '{2027-04-07}')`, [night.id, second]);
      await call('coordinacion', 'POST', '/api/users', { name: 'Mañanera', role: 'fiscal', table: first, days: ['2027-04-07'] });
      forgetActors();
      tokens.nocturna = await redeem(night.invitation);
      const real = clock.now;
      try {
        clock.now = () => new Date('2027-04-07T01:00:00Z');
        expect((await call('nocturna', 'GET', '/api/me')).json().table).toMatchObject({ id: first, timeZone: 'America/Argentina/Buenos_Aires' });
        const panel = (await call('coordinacion', 'GET', `/api/district/${id}`)).json().tables;
        expect(panel.find((t: { id: string }) => t.id === first).fiscal.name).toBe('Nocturna');
        expect((await call('coordinacion', 'GET', `/api/tables/${first}/detail`)).json().fiscal.name).toBe('Nocturna');
        // At midnight there, the next day starts.
        clock.now = () => new Date('2027-04-07T03:30:00Z');
        expect((await call('nocturna', 'GET', '/api/me')).json().table.id).toBe(second);
        expect((await call('coordinacion', 'GET', `/api/tables/${first}/detail`)).json().fiscal.name).toBe('Mañanera');
        // An election somewhere else says so.
        await pool.query(`UPDATE elections SET time_zone = 'UTC' WHERE id = $1`, [id]);
        clock.now = () => new Date('2027-04-07T01:00:00Z');
        expect((await call('nocturna', 'GET', '/api/me')).json().table.id).toBe(second);
      } finally {
        clock.now = real;
      }
    });

    it('a zone given as an offset is refused, so that the panel and the phones agree on the day and nothing breaks', async () => {
      const create = (timeZone: string) => call('coordinacion', 'POST', '/api/elections', { name: `Zona ${timeZone}`, kind: 'estudiantil', days: ['2027-04-06'], timeZone });
      for (const offset of ['-0300', '-03:00', '+03:00', 'utc']) expect((await create(offset)).statusCode).toBe(400);
      const id = (await create('Etc/GMT+3')).json().id;
      expect((await call('coordinacion', 'GET', `/api/district/${id}`)).statusCode).toBe(200);
    });

    it('once the election closes, a poll watcher hears that it ended, not that they have no table yet', async () => {
      expect((await call('fiscal', 'GET', '/api/me')).json()).toMatchObject({ ended: false, table: { id: table } });
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      expect((await call('fiscal', 'GET', '/api/me')).json()).toMatchObject({ ended: true, table: null });
    });

    it('a week after the close, someone without a table hears that they have none, not that the election ended', async () => {
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      expect((await call('coordinacion', 'POST', `/api/elections/${demo.election}/purge`)).statusCode).toBe(200);
      expect((await call('fiscal', 'GET', '/api/me')).json()).toMatchObject({ ended: true, table: null });
      await pool.query(`UPDATE elections SET closed_at = now() - interval '8 days' WHERE id = $1`, [demo.election]);
      expect((await call('fiscal', 'GET', '/api/me')).json()).toMatchObject({ ended: false, table: null });
    });

    it('/me says when the roll of the table changed, with the same mark the roll itself carries', async () => {
      const me = async () => (await call('fiscal', 'GET', '/api/me')).json().table.rollRevision as string;
      const bundle = async () => (await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).json();
      const before = await me();
      expect((await bundle()).revision).toBe(before);
      expect(await me()).toBe(before);
      const person = (await pool.query('SELECT id FROM electors WHERE table_id = $1 ORDER BY order_number LIMIT 1', [table])).rows[0];
      expect((await call('coordinacion', 'PUT', `/api/elections/${demo.election}/electors/${person.id}`, { full_name: 'Corregida, Ana' })).statusCode).toBe(200);
      const after = await me();
      expect(after).not.toBe(before);
      const { revision, electors } = await bundle();
      expect(revision).toBe(after);
      expect(electors.some((elector: { name: string }) => elector.name === 'Corregida, Ana')).toBe(true);
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

    it('a correction after the choice asks the chief again, unless it says the same as the chosen one', async () => {
      const tally = (azul: number, seq: number) => ({ ...operation(table, seq), type: 'tally.submitted', payload: { category: 'cat-1', results: { l1: azul, l2: 10 } } });
      const [one, two] = [tally(100, 1), tally(101, 2)];
      await push('fiscal', table, [one, two]);
      expect((await call('jefe', 'POST', `/api/tables/${table}/tally/decide`, { category: 'cat-1', operation: two.id })).statusCode).toBe(200);
      const detail = async () => (await call('jefe', 'GET', `/api/tables/${table}/detail`)).json();
      await push('fiscal', table, [tally(101, 3)]);
      expect((await detail()).tallies[0]).toMatchObject({ disagree: false, chosen: two.id });
      const fixed = tally(99, 4);
      await push('fiscal', table, [fixed]);
      expect((await detail()).tallies[0]).toMatchObject({ disagree: true, chosen: null });
      expect((await call('jefe', 'POST', `/api/tables/${table}/tally/decide`, { category: 'cat-1', operation: fixed.id })).statusCode).toBe(200);
      expect((await detail()).tallies[0]).toMatchObject({ disagree: false, chosen: fixed.id });
    });

    it('results add up the chosen version of each table, blank and null included, and say what is left out', async () => {
      const other = demo.tables[1]!.table;
      const tally = (where: string, azul: number, seq: number) => ({ ...operation(where, seq), type: 'tally.submitted', payload: { category: 'cat-1', results: { l1: azul, l2: 10, blanco: 2, nulo: 1 } } });
      const results = async (who: string) => (await call(who, 'GET', `/api/elections/${demo.election}/results`)).json();
      await push('fiscal', table, [tally(table, 100, 1), { ...operation(table, 2), type: 'tally.photo', payload: { sha256: 'b'.repeat(64) } }]);
      expect((await results('estadistico')).categories[0]).toMatchObject({
        counted: 1, missing: 1, undecided: 0,
        lists: [{ id: 'l1', votes: 100 }, { id: 'l2', votes: 10 }, { id: 'blanco', votes: 2 }, { id: 'nulo', votes: 1 }],
      });
      const district = (await call('jefe', 'GET', `/api/district/${demo.election}`)).json();
      expect(district.tables.find((found: { id: string }) => found.id === table)).toMatchObject({ tallied: ['cat-1'], photo: true });
      const [one, two] = [tally(other, 50, 1), tally(other, 51, 2)];
      await push('otra', other, [one, two]);
      expect((await results('coordinacion')).categories[0]).toMatchObject({ counted: 1, undecided: 1, missing: 0 });
      await call('coordinacion', 'POST', `/api/tables/${other}/tally/decide`, { category: 'cat-1', operation: two.id });
      expect((await results('coordinacion')).categories[0].lists[0].votes).toBe(151);
      // The spreadsheet, table by table, is logged. A poll watcher sees none of it.
      const sheet = (await call('coordinacion', 'GET', `/api/elections/${demo.election}/results?tables=1`)).json();
      expect(sheet.perTable.map((row: { categories: Record<string, Record<string, number>> }) => row.categories['cat-1']!.l1)).toEqual([100, 51]);
      expect((await pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'results.downloaded'`)).rows[0].n).toBe(1);
      expect((await call('fiscal', 'GET', `/api/elections/${demo.election}/results`)).statusCode).toBe(403);
    });

    it('what arrives after the close waits for a person, who adds it or discards it, and the purge takes the rest', async () => {
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      const tally = { ...operation(table, 1), type: 'tally.submitted', payload: { category: 'cat-1', results: { l1: 7, l2: 3, blanco: 0, nulo: 0 } } };
      const photo = { ...operation(table, 2), type: 'tally.photo', payload: { sha256: 'a'.repeat(64) } };
      expect((await push('fiscal', table, [tally, photo])).json().late).toBe(true);
      const late = async () => (await call('jefe', 'GET', `/api/elections/${demo.election}/late`)).json();
      expect((await late()).items.map((item: { type: string }) => item.type)).toEqual(['tally.submitted', 'tally.photo']);
      expect((await call('coordinacion', 'GET', `/api/elections/${demo.election}/results`)).json().categories[0].counted).toBe(0);
      expect((await call('fiscal', 'POST', `/api/late/${tally.id}`, { decision: 'sumado' })).statusCode).toBe(403);
      expect((await call('jefe', 'POST', `/api/late/${tally.id}`, { decision: 'sumado' })).statusCode).toBe(200);
      expect((await call('jefe', 'POST', `/api/late/${tally.id}`, { decision: 'descartado' })).statusCode).toBe(404);
      expect((await call('coordinacion', 'GET', `/api/elections/${demo.election}/results`)).json().categories[0].lists[0].votes).toBe(7);
      expect((await late()).items.map((item: { type: string }) => item.type)).toEqual(['tally.photo']);
      expect((await call('coordinacion', 'POST', `/api/elections/${demo.election}/purge`)).statusCode).toBe(200);
      expect((await pool.query('SELECT count(*)::int AS n FROM operations WHERE quarantined')).rows[0].n).toBe(0);
      expect((await pool.query(`SELECT action FROM audit_log WHERE action LIKE 'late.%'`)).rows).toEqual([{ action: 'late.added' }]);
    });

    it('an election changes its lists only while prepared, its days until it closes, and is deleted only while prepared', async () => {
      const id = demo.election;
      expect((await call('coordinacion', 'PUT', `/api/elections/${id}`, { categories: [] })).statusCode).toBe(409);
      expect((await call('coordinacion', 'PUT', `/api/elections/${id}`, { days: ['2027-04-07'] })).statusCode).toBe(200);
      expect((await call('coordinacion', 'PUT', `/api/elections/${id}`, { days: [] })).statusCode).toBe(400);
      expect((await call('coordinacion', 'PUT', `/api/elections/${id}`, { name: 'Otra' })).statusCode).toBe(200);
      expect((await call('coordinacion', 'DELETE', `/api/elections/${id}`, { name: 'Otra' })).statusCode).toBe(409);
      const categories = [{ id: 'c', name: 'Consejo', lists: [{ id: 'l', name: 'Lista' }] }];
      const { id: fresh } = (await call('coordinacion', 'POST', '/api/elections', { name: 'Prueba', kind: 'estudiantil', days: ['2027-05-01'], categories })).json();
      expect((await call('coordinacion', 'PUT', `/api/elections/${fresh}`, { categories })).statusCode).toBe(200);
      expect((await call('coordinacion', 'DELETE', `/api/elections/${fresh}`, { name: 'otra cosa' })).statusCode).toBe(400);
      expect((await call('jefe', 'DELETE', `/api/elections/${fresh}`, { name: 'Prueba' })).statusCode).toBe(403);
      expect((await call('coordinacion', 'DELETE', `/api/elections/${fresh}`, { name: 'Prueba' })).statusCode).toBe(200);
      expect((await pool.query('SELECT count(*)::int AS n FROM elections WHERE id = $1', [fresh])).rows[0].n).toBe(0);
    });

    it('someone on the team changes name and table, loses a task, and a lost phone stops working while they stay', async () => {
      const me = async () => (await call('fiscal', 'GET', '/api/me')).json();
      const { user } = await me();
      const person = (await call('coordinacion', 'GET', '/api/users')).json().users.find((found: { id: string }) => found.id === user.id);
      const task = person.roles.find((found: { role: string }) => found.role === 'fiscal');
      expect(task).toMatchObject({ table, tableName: expect.any(String), election: demo.election });
      expect((await call('coordinacion', 'PUT', `/api/users/${user.id}`, { name: 'Nombre Nuevo', phone: '351 555 0000' })).statusCode).toBe(200);
      expect((await call('coordinacion', 'PUT', `/api/users/${user.id}/roles/${task.id}`, { table: demo.tables[1]!.table })).statusCode).toBe(200);
      expect(await me()).toMatchObject({ user: { name: 'Nombre Nuevo' }, table: { id: demo.tables[1]!.table } });
      expect((await call('jefe', 'PUT', `/api/users/${user.id}`, { name: 'Otro' })).statusCode).toBe(403);
      const lost = (await call('coordinacion', 'POST', `/api/users/${user.id}/lost-phone`)).json();
      expect(typeof lost.invitation).toBe('string');
      expect((await call('fiscal', 'GET', '/api/me')).statusCode).toBe(401);
      expect((await call('coordinacion', 'DELETE', `/api/users/${user.id}/roles/${task.id}`)).statusCode).toBe(200);
      const after = (await call('coordinacion', 'GET', '/api/users')).json().users.find((found: { id: string }) => found.id === user.id);
      expect(after.roles).toEqual([]);
    });

    it('while it is prepared, a table moves its cut with the next one, one person moves alone, and only an empty table goes', async () => {
      await pool.query(`UPDATE elections SET status = 'preparacion' WHERE id = $1`, [demo.election]);
      const [first, second] = demo.tables.map((found) => found.table) as [string, string];
      const people = async (where: string) => (await call('coordinacion', 'GET', `/api/tables/${where}/people`)).json().people as { id: string; order: number }[];
      const everyone = (await people(first)).length + (await people(second)).length;
      const preview = (await call('coordinacion', 'POST', `/api/tables/${first}/cut?preview=1`, { last: 'm' })).json();
      expect(preview.here + preview.next).toBe(everyone);
      expect((await people(second)).length).toBeGreaterThan(0);
      expect((await call('coordinacion', 'POST', `/api/tables/${first}/cut`, { last: 'zzzz' })).json()).toEqual({ here: everyone, next: 0 });
      expect((await people(first)).map((person) => person.order)).toEqual(Array.from({ length: everyone }, (_, index) => index + 1));
      const [one] = await people(first);
      const move = (from: string, to: string) => call('coordinacion', 'PUT', `/api/tables/${from}/people/${encodeURIComponent(one!.id)}`, { to });
      expect((await move(first, second)).statusCode).toBe(200);
      expect((await people(second)).map((person) => person.id)).toEqual([one!.id]);
      expect((await call('coordinacion', 'DELETE', `/api/tables/${second}`)).statusCode).toBe(409);
      expect((await move(second, first)).statusCode).toBe(200);
      expect((await call('coordinacion', 'DELETE', `/api/tables/${second}`)).statusCode).toBe(200);
      await pool.query(`UPDATE elections SET status = 'jornada' WHERE id = $1`, [demo.election]);
      expect((await call('coordinacion', 'POST', `/api/tables/${first}/cut`, { last: 'm' })).statusCode).toBe(409);
      expect((await call('coordinacion', 'POST', `/api/elections/${demo.election}/tables/reset`)).statusCode).toBe(409);
    });

    it('a doubtful row comes with the one that has its document, and a row leaves the roll only while it is prepared', async () => {
      const two = (await pool.query('SELECT id FROM electors WHERE election_id = $1 ORDER BY id LIMIT 2', [demo.election])).rows.map((row) => row.id as string);
      await pool.query('UPDATE electors SET document = $3, needs_review = true WHERE election_id = $1 AND id = ANY($2)', [demo.election, two, '30111222']);
      const review = async () => (await call('coordinacion', 'GET', `/api/elections/${demo.election}/review`)).json();
      expect(await review()).toMatchObject({ total: 2, status: 'jornada', rows: [{ twin: { document: '30111222' } }, { twin: { document: '30111222' } }] });
      const remove = () => call('coordinacion', 'DELETE', `/api/elections/${demo.election}/electors/${encodeURIComponent(two[1]!)}`);
      expect((await remove()).statusCode).toBe(409);
      await pool.query(`UPDATE elections SET status = 'preparacion' WHERE id = $1`, [demo.election]);
      expect((await remove()).statusCode).toBe(200);
      expect(await review()).toMatchObject({ total: 1, rows: [{ id: two[0], twin: null }] });
    });

    it('the schedule: voting hours by day, each poll watcher\'s own times in their plan, and a chief sees their district', async () => {
      const day = (await pool.query('SELECT days FROM elections WHERE id = $1', [demo.election])).rows[0].days[0].toISOString().slice(0, 10);
      const hours = (open: string, close: string) => call('coordinacion', 'PUT', `/api/elections/${demo.election}`, { hours: { [day]: { open, close } } });
      expect((await hours('18:00', '08:00')).statusCode).toBe(400);
      expect((await hours('08:00', '18:00')).statusCode).toBe(200);
      const { user } = (await call('fiscal', 'GET', '/api/me')).json();
      const task = (await call('coordinacion', 'GET', '/api/users')).json().users.find((found: { id: string }) => found.id === user.id).roles[0];
      const times = (schedule: object) => call('coordinacion', 'PUT', `/api/users/${user.id}/roles/${task.id}`, { schedule });
      expect((await times({ from: '13:00', to: '08:00' })).statusCode).toBe(400);
      expect((await times({ from: '08:00', to: '13:00', arrive: '07:30', meet: 'Puerta principal' })).statusCode).toBe(200);
      expect((await call('fiscal', 'GET', '/api/me')).json().table).toMatchObject({
        hours: { [day]: { open: '08:00', close: '18:00' } }, schedule: { from: '08:00', to: '13:00', arrive: '07:30', meet: 'Puerta principal' },
      });
      const schedule = (await call('jefe', 'GET', `/api/elections/${demo.election}/schedule`)).json();
      const row = schedule.tables.find((found: { id: string }) => found.id === table);
      expect(row.fiscales.find((fiscal: { name: string }) => fiscal.name === user.name).schedule).toMatchObject({ arrive: '07:30' });
      expect((await call('fiscal', 'GET', `/api/elections/${demo.election}/schedule`)).statusCode).toBe(403);
    });

    it('the log says what each entry was about, finds everything about a person of the roll, and a chief sees their district', async () => {
      const elector = (await pool.query('SELECT x.id, t.name AS table_name FROM electors x JOIN polling_tables t ON t.id = x.table_id WHERE x.election_id = $1 AND x.table_id = $2 LIMIT 1', [demo.election, table])).rows[0];
      const base = `/api/persons/${demo.election}/${encodeURIComponent(elector.id)}`;
      expect((await call('coordinacion', 'PUT', base, { full_name: 'Zapatería Prueba, Ana' })).statusCode).toBe(200);
      const exported = (await call('coordinacion', 'GET', `${base}/export`)).json();
      expect(exported.log.map((entry: { action: string }) => entry.action)).toEqual(['elector.corrected', 'person.exported']);
      const log = async (who: string, query = '') => (await call(who, 'GET', `/api/audit${query}`)).json();
      const request = await log('coordinacion', '?q=zapateria');
      expect(request.people).toEqual(['Zapatería Prueba, Ana']);
      expect(request.counts).toEqual({ seen: 1, changed: 1 });
      expect(request.entries.find((entry: { action: string }) => entry.action === 'elector.corrected')).toMatchObject({ about: 'Zapatería Prueba, Ana', about_table: elector.table_name, seen: false });
      expect((await log('coordinacion', '?kind=seen')).entries.every((entry: { seen: boolean }) => entry.seen)).toBe(true);
      // A chief sees what was about the tables of their district, and nothing of the party's settings.
      await call('coordinacion', 'PUT', '/api/party', { name: 'Agrupación de prueba' });
      const chief = await log('jefe');
      expect(chief.entries.some((entry: { action: string }) => entry.action === 'elector.corrected')).toBe(true);
      expect(chief.entries.some((entry: { action: string }) => entry.action === 'party.changed')).toBe(false);
      expect((await call('fiscal', 'GET', '/api/audit')).statusCode).toBe(403);
    });

    it('consent is taken back with when and how, and the mark goes; one loaded by mistake is removed; all of it logged', async () => {
      const elector = (await pool.query('SELECT id FROM electors WHERE election_id = $1 LIMIT 1', [demo.election])).rows[0].id;
      const base = `/api/persons/${demo.election}/${encodeURIComponent(elector)}`;
      await pool.query('INSERT INTO semaphore_marks (election_id, elector_id) VALUES ($1, $2)', [demo.election, elector]);
      const withdraw = () => call('coordinacion', 'POST', `${base}/consent/withdraw`, { date: '2027-04-26', means: 'por mail' });
      expect((await withdraw()).statusCode).toBe(404);
      expect((await call('coordinacion', 'PUT', `${base}/consent`, { date: '2027-03-02', means: 'por escrito' })).statusCode).toBe(200);
      expect((await withdraw()).statusCode).toBe(200);
      const consent = (await pool.query('SELECT consent FROM electors WHERE election_id = $1 AND id = $2', [demo.election, elector])).rows[0].consent;
      expect(consent).toMatchObject({ date: '2027-03-02', withdrawn: { date: '2027-04-26', means: 'por mail' } });
      expect((await pool.query('SELECT count(*)::int AS n FROM semaphore_marks WHERE elector_id = $1', [elector])).rows[0].n).toBe(0);
      expect((await call('coordinacion', 'DELETE', `${base}/consent`)).statusCode).toBe(200);
      const logged = (await pool.query(`SELECT action FROM audit_log WHERE action LIKE 'person.consent%' ORDER BY id`)).rows.map((row) => row.action);
      expect(logged).toEqual(['person.consent', 'person.consent_withdrawn', 'person.consent_removed']);
    });

    it('the party chooses until when the names are kept, and the purge says when they went', async () => {
      const categories = [{ id: 'c', name: 'Consejo', lists: [{ id: 'l', name: 'Lista' }] }];
      const create = (purgeBy: string) => call('coordinacion', 'POST', '/api/elections', { name: 'Con plazo', kind: 'estudiantil', days: ['2027-05-01'], categories, purgeBy });
      expect((await create('2027-04-01')).statusCode).toBe(400);
      const { id } = (await create('2027-05-31')).json();
      const listed = async () => (await call('coordinacion', 'GET', '/api/elections')).json().elections.find((found: { id: string }) => found.id === id);
      expect((await listed()).purge_by).toBe('2027-05-31');
      expect((await call('coordinacion', 'PUT', `/api/elections/${id}`, { purgeBy: '2027-06-30' })).statusCode).toBe(200);
      expect((await listed()).purge_by).toBe('2027-06-30');
      for (const status of ['jornada', 'escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${id}/status`, { status });
      expect((await call('coordinacion', 'POST', `/api/elections/${id}/purge`)).statusCode).toBe(200);
      expect((await pool.query('SELECT purged_at FROM elections WHERE id = $1', [id])).rows[0].purged_at).toBeInstanceOf(Date);
      expect((await call('coordinacion', 'PUT', `/api/elections/${id}`, { purgeBy: '2027-07-30' })).statusCode).toBe(409);
    });

    it('a traffic light category turns sensitive sealing the marks it has, only the permission undoes it, and it goes only once empty', async () => {
      const { id } = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Simpatiza', color: '#1E9E5A' })).json();
      const elector = (await pool.query('SELECT id FROM electors WHERE election_id = $1 LIMIT 1', [demo.election])).rows[0].id;
      await pool.query('INSERT INTO semaphore_marks (election_id, elector_id, category_id) VALUES ($1, $2, $3)', [demo.election, elector, id]);
      const mark = async () => (await pool.query('SELECT category_id, sealed FROM semaphore_marks WHERE election_id = $1 AND elector_id = $2', [demo.election, elector])).rows[0];
      expect((await call('coordinacion', 'GET', `/api/semaphore/categories/${id}`)).json().people).toBe(1);
      expect((await call('coordinacion', 'PUT', `/api/semaphore/categories/${id}`, { name: 'Afiliada', sensitive: true })).statusCode).toBe(200);
      expect(await mark()).toMatchObject({ category_id: null, sealed: expect.any(String) });
      const light = (await call('semaforo', 'GET', '/api/semaphore/categories')).json();
      expect(light.hidden).toBe(1);
      expect(light.categories.map((category: { id: string }) => category.id)).not.toContain(id);
      expect((await call('coordinacion', 'PUT', `/api/semaphore/categories/${id}`, { sensitive: false })).statusCode).toBe(403);
      const { user } = (await call('coordinacion', 'GET', '/api/me')).json();
      await call('coordinacion', 'POST', `/api/users/${user.id}/roles`, { role: 'semaforo_sensible' });
      expect((await call('coordinacion', 'DELETE', `/api/semaphore/categories/${id}`)).json()).toMatchObject({ error: 'in_use', people: 1 });
      expect((await call('coordinacion', 'PUT', `/api/semaphore/categories/${id}`, { sensitive: false })).statusCode).toBe(200);
      expect(await mark()).toMatchObject({ category_id: id, sealed: null });
      await pool.query('DELETE FROM semaphore_marks WHERE election_id = $1', [demo.election]);
      expect((await call('coordinacion', 'DELETE', `/api/semaphore/categories/${id}`)).statusCode).toBe(200);
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

    it('the id phones know a person by stays the same when the roll is imported again, and the marks sent with it count', async () => {
      const id = await newElection();
      await upload(id, writePadron({ electors: people(25) as never }));
      await call('coordinacion', 'POST', `/api/elections/${id}/tables/propose`, { size: 10 });
      const ids = async () => new Map((await pool.query('SELECT id, public_id FROM electors WHERE election_id = $1', [id])).rows.map((row) => [row.id, row.public_id]));
      const before = await ids();
      expect(new Set(before.values()).size).toBe(25);
      for (const value of before.values()) expect(value).toMatch(/^[\w-]{16}$/);
      await upload(id, writePadron({ electors: people(25).map((person) => ({ ...person, full_name: `${person.full_name} María` })) as never }));
      expect(await ids()).toEqual(before);
      // Each election has its own: the same person cannot be followed from one to another.
      const other = await newElection();
      await upload(other, writePadron({ electors: people(25) as never }));
      const theirs = (await pool.query('SELECT public_id FROM electors WHERE election_id = $1', [other])).rows.map((row) => row.public_id);
      expect(theirs.filter((value) => [...before.values()].includes(value))).toEqual([]);

      // A mark sent with the phone's id is counted, and shows when the person asks for their data.
      const { electors } = (await call('fiscal', 'GET', `/api/tables/${table}/bundle`)).json();
      await push('fiscal', table, [operation(table, 1, electors[0].id)]);
      expect((await call('coordinacion', 'GET', `/api/district/${demo.election}`)).json().tables.find((t: { id: string }) => t.id === table).voted).toBe(1);
      const inside = (await pool.query('SELECT election_id, id FROM electors WHERE public_id = $1', [electors[0].id])).rows[0];
      const exported = (await call('coordinacion', 'GET', `/api/persons/${inside.election_id}/${inside.id}/export`)).json();
      expect(exported.markedVoted).toHaveLength(1);
    });

    it('a database from before the random ids gets them, and the marks already sent are renamed', async () => {
      await pool.query(`UPDATE electors SET id = 'd-' || document WHERE table_id = $1`, [table]);
      // As the database was before 0003: without the column, and without having run it.
      await pool.query('ALTER TABLE electors DROP COLUMN public_id');
      await pool.query('DELETE FROM schema_migrations WHERE version >= 3');
      const old = operation(table, 1, 'd-99000001');
      await pool.query(`INSERT INTO operations (id, table_id, seq, type, device, device_seq, device_time, payload) VALUES ($1, $2, 1, 'voter.marked', 'd-1', 1, now(), $3)`, [old.id, table, JSON.stringify(old.payload)]);
      await migrate(pool);
      const person = (await pool.query(`SELECT public_id FROM electors WHERE id = 'd-99000001'`)).rows[0];
      expect(person.public_id).toMatch(/^[\w-]{16}$/);
      expect((await pool.query('SELECT payload FROM operations WHERE id = $1', [old.id])).rows[0].payload).toEqual({ elector: person.public_id });
      expect((await pool.query('SELECT count(DISTINCT public_id)::int AS n FROM electors')).rows[0].n).toBe(80);
      // And running it again changes nothing.
      await migrate(pool);
      expect((await pool.query(`SELECT public_id FROM electors WHERE id = 'd-99000001'`)).rows[0]).toEqual(person);
    });

    it('importing again keeps what was corrected and who asked to be erased, and a closed election takes no roll', async () => {
      const id = await newElection();
      const file = writePadron({ electors: people(5) as never });
      await upload(id, file);
      expect((await call('coordinacion', 'PUT', `/api/elections/${id}/electors/p-0`, { full_name: 'Corregida, Ana', document: '123' })).statusCode).toBe(200);
      expect((await call('coordinacion', 'DELETE', `/api/persons/${id}/p-1`)).statusCode).toBe(200);
      const preview = (await upload(id, file, true)).json();
      expect(preview).toMatchObject({ people: 4, added: 0, kept: 4, missing: 0, erased: 1, corrected: 1, toReview: 0 });
      expect((await upload(id, file)).statusCode).toBe(200);
      const rows = (await pool.query('SELECT id, full_name, document, needs_review FROM electors WHERE election_id = $1 ORDER BY id', [id])).rows;
      expect(rows).toHaveLength(5);
      expect(rows.find((row) => row.id === 'p-0')).toMatchObject({ full_name: 'Corregida, Ana', document: '123', needs_review: false });
      expect(rows.some((row) => row.id === 'p-1')).toBe(false);
      expect(rows.filter((row) => row.id.startsWith('x-'))).toEqual([expect.objectContaining({ full_name: 'Borrado a pedido', document: null })]);

      expect((await call('coordinacion', 'POST', `/api/elections/${id}/tables/propose`, { size: 10 })).json().created).toBe(1);
      const mesa = (await pool.query('SELECT id FROM polling_tables WHERE election_id = $1', [id])).rows[0].id as string;
      for (const status of ['jornada', 'escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${id}/status`, { status });
      expect((await upload(id, file)).json().error).toBe('election_closed');
      expect((await upload(id, file, true)).statusCode).toBe(409);
      expect((await call('coordinacion', 'POST', `/api/elections/${id}/tables/propose`, { size: 10 })).statusCode).toBe(409);
      expect((await call('coordinacion', 'PUT', `/api/elections/${id}/electors/p-2`, { full_name: 'Otra, Eva' })).statusCode).toBe(409);
      // Nor its tables or districts: who watched where stays as it was.
      expect((await call('coordinacion', 'PUT', `/api/tables/${mesa}`, { name: 'Otra mesa' })).statusCode).toBe(409);
      expect((await call('coordinacion', 'POST', `/api/elections/${id}/units`, { name: 'Distrito tarde' })).statusCode).toBe(409);
      expect((await pool.query('SELECT name FROM polling_tables WHERE id = $1', [mesa])).rows[0].name).toBe('Mesa 1');
      await call('coordinacion', 'POST', `/api/elections/${id}/purge`);
      expect((await upload(id, file)).statusCode).toBe(409);
      expect((await call('coordinacion', 'PUT', `/api/tables/${mesa}`, { place: 'Otra escuela' })).statusCode).toBe(409);
      expect((await pool.query(`SELECT count(*)::int AS n FROM electors WHERE election_id = $1 AND full_name <> ''`, [id])).rows[0].n).toBe(0);
    });

    it('a roll without DNI or legajo names people by their row: a row added on top moves no erasure and no correction to someone else', async () => {
      const id = await newElection();
      const csv = (text: string, preview = false) =>
        app.inject({ method: 'POST', url: `/api/elections/${id}/roll${preview ? '?preview=1' : ''}`, payload: Buffer.from(text), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'text/csv' } });
      const first = 'Apellido y nombre;DNI\nAlfa, Ana;123456\nBeta, Bea;654321\nGama, Gus;111222\n';
      expect((await csv(first)).statusCode).toBe(200);
      const rows = async () => (await pool.query('SELECT id, full_name, document FROM electors WHERE election_id = $1 AND erased_at IS NULL ORDER BY full_name', [id])).rows;
      expect((await rows()).map((row) => row.id)).toEqual(['f-1', 'f-2', 'f-3']);
      expect((await call('coordinacion', 'DELETE', `/api/persons/${id}/f-2`)).statusCode).toBe(200);
      expect((await call('coordinacion', 'PUT', `/api/persons/${id}/f-3`, { full_name: 'Gama, Gustavo' })).statusCode).toBe(200);

      const second = 'Apellido y nombre;DNI\nCero, Ceci;222333\nAlfa, Ana;123456\nBeta, Bea;654321\nGama, Gus;111222\n';
      expect((await csv(second, true)).json()).toMatchObject({ people: 3, added: 1, kept: 2, missing: 0, erased: 1, corrected: 1 });
      expect((await csv(second)).statusCode).toBe(200);
      // Each one keeps their own id, the new person takes nobody's, and whoever asked to be erased stays out.
      expect(await rows()).toEqual([
        { id: 'f-1', full_name: 'Alfa, Ana', document: '123456' },
        { id: 'f-5', full_name: 'Cero, Ceci', document: '222333' },
        { id: 'f-3', full_name: 'Gama, Gustavo', document: '111222' },
      ]);
      expect((await csv(first, true)).json()).toMatchObject({ people: 2, added: 0, kept: 2, missing: 1, erased: 1, corrected: 1 });
    });

    it('a roll loaded before what the file said was kept keyed: erasures and corrections made then or later stay with their person', async () => {
      const id = await newElection();
      const csv = (text: string, preview = false) =>
        app.inject({ method: 'POST', url: `/api/elections/${id}/roll${preview ? '?preview=1' : ''}`, payload: Buffer.from(text), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'text/csv' } });
      const file = 'Apellido y nombre;DNI\nAlfa, Ana;\nBeta, Bea;\nGama, Gus;\nDelta, Dora;\nÉpsilon, Eli;\n';
      expect((await csv(file)).statusCode).toBe(200);
      // As the first versions left it: no key, and an erasure that wiped what the row said before the server erased it again.
      await pool.query('UPDATE electors SET source_key = NULL WHERE election_id = $1', [id]);
      await pool.query(`UPDATE electors SET full_name = 'Borrado a pedido', search = '' WHERE election_id = $1 AND id = 'f-2'`, [id]);
      expect(await eraseElector(pool, id, 'f-2')).toMatchObject({ ref: expect.any(String) });
      // And a correction made without keeping the key.
      await pool.query(`UPDATE electors SET full_name = 'Épsilon, Elisa', search = 'epsilon elisa', corrected_at = now() WHERE election_id = $1 AND id = 'f-5'`, [id]);
      // Corrections made now, one of them erased afterwards.
      expect((await call('coordinacion', 'PUT', `/api/persons/${id}/f-3`, { full_name: 'Gama, Gustavo' })).statusCode).toBe(200);
      expect((await call('coordinacion', 'PUT', `/api/persons/${id}/f-4`, { full_name: 'Delta, Dorotea' })).statusCode).toBe(200);
      expect((await call('coordinacion', 'DELETE', `/api/persons/${id}/f-4`)).statusCode).toBe(200);

      const rows = async () => (await pool.query('SELECT id, full_name FROM electors WHERE election_id = $1 AND erased_at IS NULL ORDER BY id', [id])).rows;
      const before = await rows();
      expect(before).toEqual([
        { id: 'f-1', full_name: 'Alfa, Ana' },
        { id: 'f-3', full_name: 'Gama, Gustavo' },
        { id: 'f-5', full_name: 'Épsilon, Elisa' },
      ]);
      expect((await csv(file, true)).json()).toMatchObject({ people: 3, added: 0, kept: 3, missing: 0, erased: 2, corrected: 2 });
      expect((await csv(file)).statusCode).toBe(200);
      expect(await rows()).toEqual(before);
      // Once loaded again, every row has its key, and the same file is still nobody new.
      expect((await pool.query('SELECT count(*)::int AS n FROM electors WHERE election_id = $1 AND erased_at IS NULL AND source_key IS NULL', [id])).rows[0].n).toBe(0);
      expect((await csv(file, true)).json()).toMatchObject({ added: 0, kept: 3, missing: 0, erased: 2 });
    });

    it('refuses what it cannot read, and a roll made with an external AI if the election forbids it', async () => {
      const id = await newElection();
      expect((await upload(id, new TextEncoder().encode('nada'))).statusCode).toBe(422);
      await call('coordinacion', 'POST', `/api/users`, { name: 'x', role: 'sistema' });
      await pool.query(`INSERT INTO settings (key, value) VALUES ('security_profile', '"nacional"') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      await pool.query('UPDATE devices SET second_factor_at = now()');
      forgetActors();
      const withAi = writePadron({ electors: people(2) as never, externalAi: true });
      const res = await upload(id, withAi);
      expect(res.json().error).toBe('external_ai_forbidden');
      // The other levels let it in, and say so before it is loaded.
      const fileProblems = async () => (await upload(id, withAi, true)).json().problems.filter((item: { where: string }) => item.where === 'file');
      await pool.query(`UPDATE settings SET value = '"local"' WHERE key = 'security_profile'`);
      expect(await fileProblems()).toEqual([{ where: 'file', problem: 'external_ai_paid_only' }]);
      await pool.query(`UPDATE settings SET value = '"estudiantil"' WHERE key = 'security_profile'`);
      expect(await fileProblems()).toEqual([{ where: 'file', problem: 'external_ai' }]);
      expect((await upload(id, writePadron({ electors: people(2) as never }), true)).json().problems).toEqual([]);
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

    it('each person hears their own permissions, and a request about someone\'s data needs only that permission', async () => {
      const { invitation } = (await call('coordinacion', 'POST', '/api/users', { name: 'Sistemas', role: 'sistema' })).json();
      tokens.sistema = await redeem(invitation);
      expect((await call('sistema', 'GET', '/api/me')).json().permissions.sort()).toEqual(['audit.read', 'security.manage', 'users.manage']);
      const { recommended } = (await call('sistema', 'GET', '/api/roles')).json();
      await call('sistema', 'PUT', '/api/roles/coordinacion', { permissions: recommended.coordinacion.filter((p: string) => p !== 'election.manage') });
      expect((await call('coordinacion', 'GET', '/api/me')).json().permissions).not.toContain('election.manage');
      const found = (await call('coordinacion', 'GET', '/api/persons?q=acu')).json().people[0];
      const fix = { full_name: 'Acuña, Corregida', document: '' };
      expect((await call('coordinacion', 'PUT', `/api/elections/${found.election_id}/electors/${found.id}`, fix)).statusCode).toBe(403);
      expect((await call('coordinacion', 'PUT', `/api/persons/${found.election_id}/${found.id}`, fix)).statusCode).toBe(200);
      // The document stays, and can still be searched.
      const again = (await call('coordinacion', 'GET', `/api/persons?q=${found.document}`)).json().people.find((p: { id: string }) => p.id === found.id);
      expect(again).toMatchObject({ full_name: 'Acuña, Corregida', document: found.document });
      expect((await call('coordinacion', 'PUT', `/api/persons/${found.election_id}/${found.id}`, { full_name: ' ' })).statusCode).toBe(400);
      await pool.query(`UPDATE elections SET status = 'purgada' WHERE id = $1`, [found.election_id]);
      expect((await call('coordinacion', 'PUT', `/api/persons/${found.election_id}/${found.id}`, fix)).statusCode).toBe(409);
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
      // Whoever notes the light names people by the id the phones know them by.
      const electors = (await pool.query('SELECT public_id AS id FROM electors WHERE table_id = $1 ORDER BY order_number', [table])).rows;
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

    it('a sensitive mark cannot be seen through an export, nor replaced or cleared, without its own permission', async () => {
      const open = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Puede ser', color: '#E8A317' })).json().id;
      const closed = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Milita', color: '#D93A3A', sensitive: true })).json().id;
      const users = (await call('coordinacion', 'GET', '/api/users')).json().users;
      const idOf = (name: string) => users.find((u: { name: string }) => u.name === name).id;
      await call('coordinacion', 'POST', `/api/users/${idOf('Juli')}/roles`, { role: 'semaforo_sensible' });
      tokens.otro = await redeem((await call('coordinacion', 'POST', '/api/users', { name: 'Otro semáforo', role: 'semaforo' })).json().invitation);
      const found = (await call('coordinacion', 'GET', '/api/persons?q=acu')).json().people[0];
      const publicId = (await pool.query('SELECT public_id FROM electors WHERE election_id = $1 AND id = $2', [found.election_id, found.id])).rows[0].public_id;
      const mark = (who: string, category: string | null) => call(who, 'PUT', `/api/elections/${found.election_id}/people/${publicId}/semaphore`, { category });
      expect((await mark('semaforo', closed)).statusCode).toBe(200);

      // Whoever cannot see it notes a plain category, which stays under it, and clears only that.
      expect((await mark('otro', open)).statusCode).toBe(200);
      expect((await pool.query('SELECT category_id, sealed IS NOT NULL AS sealed FROM semaphore_marks')).rows).toEqual([{ category_id: open, sealed: true }]);
      const seen = async (who: string) => (await call(who, 'GET', `/api/elections/${found.election_id}/people?q=acu`)).json().people.find((p: { id: string }) => p.id === publicId).category;
      expect(await seen('otro')).toBe(open);
      expect(await seen('semaforo')).toBe(closed);

      const exported = (await call('coordinacion', 'GET', `/api/persons/${found.election_id}/${found.id}/export`)).json();
      expect(exported.semaphore).toMatchObject({ category: null, sensitive: true, hidden: true, under: 'Puede ser' });
      expect(JSON.stringify(exported)).not.toContain('Milita');
      expect((await mark('otro', null)).statusCode).toBe(200);
      expect((await pool.query('SELECT category_id, sealed IS NOT NULL AS sealed FROM semaphore_marks')).rows).toEqual([{ category_id: null, sealed: true }]);
      expect(await seen('otro')).toBeNull();

      await call('coordinacion', 'POST', `/api/users/${idOf('Coordinación')}/roles`, { role: 'semaforo_sensible' });
      const opened = (await call('coordinacion', 'GET', `/api/persons/${found.election_id}/${found.id}/export`)).json();
      expect(opened.semaphore).toMatchObject({ category: 'Milita', sensitive: true, hidden: false });
      expect(opened.semaphore.under).toBeUndefined();
      const logged = await pool.query(`SELECT target FROM audit_log WHERE action = 'semaphore.sensitive_viewed' ORDER BY id DESC LIMIT 1`);
      expect(logged.rows[0].target).toBe((await pool.query('SELECT ref FROM electors WHERE id = $1', [found.id])).rows[0].ref);
      // With the permission, the mark can be changed again.
      expect((await mark('semaforo', open)).statusCode).toBe(200);
      expect((await pool.query('SELECT category_id, sealed FROM semaphore_marks')).rows).toEqual([{ category_id: open, sealed: null }]);
      expect((await mark('otro', null)).statusCode).toBe(200);
      expect((await pool.query('SELECT 1 FROM semaphore_marks')).rowCount).toBe(0);
    });

    it('the traffic light names each person by the id phones know them by, never by the roll id, which can be the whole document', async () => {
      // Ids as the rolls bring them: the whole document inside.
      await pool.query(`UPDATE electors SET id = 'd-' || document WHERE table_id = $1`, [table]);
      const documents: string[] = (await pool.query('SELECT document FROM electors WHERE table_id = $1', [table])).rows.map((row) => row.document);
      const open = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Puede ser', color: '#E8A317' })).json().id;
      const search = async () => (await call('semaforo', 'GET', `/api/elections/${demo.election}/people?q=ez`)).json().people as { id: string; category: string | null }[];
      const people = await search();
      expect(people.length).toBeGreaterThan(1);
      expect(people.filter((person) => documents.some((document) => JSON.stringify(person).includes(document)))).toEqual([]);
      // Noted and cleared by that id.
      const mark = (id: string, category: string | null) => call('semaforo', 'PUT', `/api/elections/${demo.election}/people/${encodeURIComponent(id)}/semaphore`, { category });
      expect((await mark(people[0]!.id, open)).statusCode).toBe(200);
      expect((await search()).find((person) => person.id === people[0]!.id)?.category).toBe(open);
      expect((await mark(people[0]!.id, null)).statusCode).toBe(200);
      expect((await search()).find((person) => person.id === people[0]!.id)?.category).toBeNull();
      // The roll id is not a way in.
      expect((await mark(`d-${documents[0]}`, open)).statusCode).toBe(404);
    });

    it('the traffic light finds a document only whole, and its search takes no wildcards', async () => {
      const [person] = (await pool.query('SELECT public_id, full_name, document FROM electors WHERE table_id = $1 ORDER BY order_number LIMIT 1', [table])).rows;
      const found = async (q: string) => ((await call('semaforo', 'GET', `/api/elections/${demo.election}/people?q=${encodeURIComponent(q)}`)).json().people as { id: string }[]).map((p) => p.id).sort();
      // The demo has some people in more than one row.
      const same = (await pool.query('SELECT public_id FROM electors WHERE election_id = $1 AND document = $2', [demo.election, person.document])).rows.map((row) => row.public_id).sort();
      expect(same).toContain(person.public_id);
      expect(await found(person.document)).toEqual(same);
      expect(await found(`${person.full_name} ${person.document}`)).toEqual(same);
      expect(await found(`${person.document.slice(0, 2)}.${person.document.slice(2)}`)).toEqual(same);
      // Part of it, alone or after the name, finds no one: otherwise it could be read a digit at a time.
      for (const part of [person.document.slice(0, 3), person.document.slice(-3), `${person.full_name} ${person.document.slice(0, 1)}`, `${person.full_name} ${person.document.slice(0, -1)}`]) expect(await found(part)).toEqual([]);
      for (const wildcard of ['__', '%%', `${person.full_name.slice(0, 2)}%`]) expect(await found(wildcard)).toEqual([]);
      // A name is still found by any part of it.
      expect(await found(person.full_name.slice(1, 5))).toContain(person.public_id);
    });

    it('whoever cannot see sensitive marks cannot tell who has one by how a change is answered, nor touch it', async () => {
      const open = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Puede ser', color: '#E8A317' })).json().id;
      const closed = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Milita', color: '#D93A3A', sensitive: true })).json().id;
      const users = (await call('coordinacion', 'GET', '/api/users')).json().users;
      await call('coordinacion', 'POST', `/api/users/${users.find((u: { name: string }) => u.name === 'Juli').id}/roles`, { role: 'semaforo_sensible' });
      tokens.otro = await redeem((await call('coordinacion', 'POST', '/api/users', { name: 'Otro semáforo', role: 'semaforo' })).json().invitation);
      const [marked, unmarked] = (await call('otro', 'GET', `/api/elections/${demo.election}/people?q=ez`)).json().people as { id: string }[];
      expect((await call('semaforo', 'PUT', `/api/elections/${demo.election}/people/${marked!.id}/semaphore`, { category: closed })).statusCode).toBe(200);
      const answer = async (person: { id: string }, category: unknown) => {
        const response = await call('otro', 'PUT', `/api/elections/${demo.election}/people/${person.id}/semaphore`, { category });
        return [response.statusCode, response.json()];
      };
      const since = Number((await pool.query('SELECT coalesce(max(id), 0) AS n FROM audit_log')).rows[0].n);
      const refusals = async () => (await pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'semaphore.refused' AND id > $1`, [since])).rows[0].n as number;
      // A category that is not one is checked first, the same for everyone.
      for (const wrong of [0, 'no-existe']) expect(await answer(marked!, wrong)).toEqual(await answer(unmarked!, wrong));
      expect(await refusals()).toBe(0);
      // A plain category, or none, is taken the same with a sensitive mark or without one.
      for (const plain of [open, null]) expect(await answer(marked!, plain)).toEqual(await answer(unmarked!, plain));
      expect(await answer(marked!, open)).toEqual([200, { ok: true }]);
      // A sensitive category is refused to everyone alike, and trying it is recorded.
      const refused = await answer(marked!, closed);
      expect(refused).toEqual([403, { error: 'sensitive_mark' }]);
      expect(await answer(unmarked!, closed)).toEqual(refused);
      expect(await refusals()).toBe(2);
      // The sensitive mark is still there, as it was.
      const kept = await pool.query('SELECT sealed IS NOT NULL AS sealed FROM semaphore_marks m JOIN electors x ON x.election_id = m.election_id AND x.id = m.elector_id WHERE x.public_id = $1', [marked!.id]);
      expect(kept.rows).toEqual([{ sealed: true }]);
    });

    it('finds, exports, records consent and erases a person, and purges an election', async () => {
      const found = (await call('coordinacion', 'GET', '/api/persons?q=acu')).json().people[0];
      expect(found.document).toBeTruthy();
      const base = `/api/persons/${found.election_id}/${found.id}`;
      expect((await call('coordinacion', 'PUT', `${base}/consent`, { date: '2027-01-01', means: 'firma' })).statusCode).toBe(200);
      const exported = (await call('coordinacion', 'GET', `${base}/export`)).json();
      expect(exported).toMatchObject({ party: 'Agrupación Ejemplo', consent: { date: '2027-01-01', means: 'firma' }, person: { name: found.full_name, document: found.document }, table: { name: found.table_name } });
      expect(exported.election.name).toContain('Elección de prueba');
      // Nothing internal: no ids, flags or raw columns.
      expect(Object.keys(exported).sort()).toEqual(['consent', 'election', 'markedVoted', 'others', 'party', 'person', 'semaphore', 'table']);
      expect(JSON.stringify(exported)).not.toMatch(/election_id|needs_review|search|"review"|"ref"/);
      expect((await call('coordinacion', 'DELETE', base)).statusCode).toBe(200);
      expect((await call('coordinacion', 'GET', '/api/persons?q=borrado')).json().people).toEqual([]);
      expect((await pool.query('SELECT 1 FROM electors WHERE id = $1', [found.id])).rowCount).toBe(0);
      const erased = (await pool.query(`SELECT full_name, document FROM electors WHERE election_id = $1 AND id LIKE 'x-%'`, [found.election_id])).rows;
      expect(erased).toEqual([{ full_name: 'Borrado a pedido', document: null }]);

      expect((await call('coordinacion', 'POST', `/api/elections/${demo.election}/purge`)).statusCode).toBe(409);
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      expect((await call('coordinacion', 'POST', `/api/elections/${demo.election}/purge`)).statusCode).toBe(200);
      const left = await pool.query(`SELECT count(*)::int AS n FROM electors WHERE election_id = $1 AND (full_name <> '' OR document IS NOT NULL)`, [demo.election]);
      expect(left.rows[0].n).toBe(0);
    });

    it('what is handed to a person says they voted only if the mark stands, and in which other rolls they are', async () => {
      const [person] = (await pool.query('SELECT id, document FROM electors WHERE table_id = $1 ORDER BY order_number LIMIT 1', [table])).rows;
      const exported = async () => (await call('coordinacion', 'GET', `/api/persons/${demo.election}/${person.id}/export`)).json();
      const marked = { ...operation(table, 1), payload: { elector: person.id } };
      await push('fiscal', table, [marked]);
      expect((await exported()).markedVoted).toEqual([marked.device_time]);
      await push('fiscal', table, [{ ...operation(table, 2), type: 'voter.unmarked', payload: { elector: person.id, cancels: [marked.id] } }]);
      expect((await exported()).markedVoted).toEqual([]);
      expect((await call('coordinacion', 'GET', `/api/elections/${demo.election}/stats`)).json().voted).toBe(0);

      expect((await exported()).others).toEqual([]);
      const other = (await call('coordinacion', 'POST', '/api/elections', { name: 'Claustro', kind: 'estudiantil', days: ['2027-04-06'] })).json().id as string;
      const file = writePadron({ electors: [{ id: `d-${person.document}`, full_name: 'La misma, Persona', identifiers: [{ type: 'DNI', value: person.document }] }] as never });
      await app.inject({ method: 'POST', url: `/api/elections/${other}/roll`, payload: Buffer.from(file), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'application/zip' } });
      expect((await exported()).others).toEqual(['Claustro']);
    });

    it('erasing a person and purging the election leave no document behind, anywhere in the database', async () => {
      const id = (await call('coordinacion', 'POST', '/api/elections', { name: 'Con DNI', kind: 'estudiantil', days: ['2027-04-06'] })).json().id as string;
      const dnis = ['99111222', '99111333', '99111444'];
      const file = writePadron({ electors: dnis.map((dni, i) => ({ id: `d-${dni}`, full_name: `Persona${i}, Ana`, identifiers: [{ type: 'DNI', value: dni }], table: '1' })) as never });
      await app.inject({ method: 'POST', url: `/api/elections/${id}/roll`, payload: Buffer.from(file), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'application/zip' } });
      const mesa = (await pool.query('SELECT id FROM polling_tables WHERE election_id = $1', [id])).rows[0].id as string;
      const voted = (dni: string, seq: number) => ({ ...operation(mesa, seq), payload: { elector: `d-${dni}` } });
      expect((await push('coordinacion', mesa, [voted(dnis[0]!, 1), voted(dnis[1]!, 2)])).statusCode).toBe(200);
      const users = (await call('coordinacion', 'GET', '/api/users')).json().users;
      await call('coordinacion', 'POST', `/api/users/${users.find((u: { name: string }) => u.name === 'Juli').id}/roles`, { role: 'semaforo_sensible' });
      const sensitive = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Milita', color: '#D93A3A', sensitive: true })).json().id;
      const publicIds = (await pool.query('SELECT public_id FROM electors WHERE election_id = $1', [id])).rows.map((row) => row.public_id as string);
      for (const person of publicIds) expect((await call('semaforo', 'PUT', `/api/elections/${id}/people/${person}/semaphore`, { category: sensitive })).statusCode).toBe(200);
      const base = `/api/persons/${id}/d-${dnis[0]}`;
      await call('coordinacion', 'PUT', `${base}/consent`, { date: '2027-01-01', means: 'firma' });
      await call('coordinacion', 'GET', `${base}/export`);
      await call('coordinacion', 'PUT', `/api/elections/${id}/electors/d-${dnis[0]}`, { full_name: 'Persona0, Ana María', document: dnis[0] });
      expect((await call('coordinacion', 'DELETE', base)).statusCode).toBe(200);
      // A phone that never heard of the erasure marks the person under the old id.
      expect((await push('coordinacion', mesa, [voted(dnis[0]!, 3)])).statusCode).toBe(200);

      const everything = async () => {
        const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
        let dump = '';
        for (const { table_name } of tables.rows) dump += (await pool.query(`SELECT coalesce(string_agg(row_to_json(t)::text, E'\\n'), '') AS rows FROM "${table_name}" t`)).rows[0].rows;
        return dump;
      };
      expect(await everything()).not.toContain(dnis[0]);
      expect(await everything()).toContain(dnis[1]);
      // The erased person still counts as voted, once.
      const totals = (await call('coordinacion', 'GET', `/api/elections/${id}/stats`)).json();
      expect(totals.voted).toBe(2);

      for (const status of ['jornada', 'escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${id}/status`, { status });
      expect((await push('coordinacion', mesa, [voted(dnis[2]!, 4)])).statusCode).toBe(200);
      expect((await call('coordinacion', 'POST', `/api/elections/${id}/purge`)).statusCode).toBe(200);
      // And a phone that sends late after the purge is heard, and what it names is dropped.
      const late = voted(dnis[2]!, 5);
      expect((await push('coordinacion', mesa, [late])).json().acked).toEqual([late.id]);
      const dump = await everything();
      for (const dni of dnis) expect(dump).not.toContain(dni);
    });

    it('after an erasure, and after the purge, nothing in the audit log leads back to the table and order of anyone', async () => {
      const users = (await call('coordinacion', 'GET', '/api/users')).json().users;
      await call('coordinacion', 'POST', `/api/users/${users.find((u: { name: string }) => u.name === 'Juli').id}/roles`, { role: 'semaforo_sensible' });
      const sensitive = (await call('coordinacion', 'POST', '/api/semaphore/categories', { name: 'Milita', color: '#D93A3A', sensitive: true })).json().id;
      const two = (await pool.query('SELECT id, public_id FROM electors WHERE table_id = $1 ORDER BY order_number LIMIT 2', [table])).rows as { id: string; public_id: string }[];
      const erased = two[0]!.id;
      for (const person of two) expect((await call('semaforo', 'PUT', `/api/elections/${demo.election}/people/${person.public_id}/semaphore`, { category: sensitive })).statusCode).toBe(200);
      const since = Number((await pool.query('SELECT coalesce(max(id), 0) AS n FROM audit_log')).rows[0].n);
      const linked = async () =>
        (await pool.query(`SELECT DISTINCT x.order_number FROM audit_log a JOIN electors x ON x.ref::text = a.target OR a.detail->'people' ? x.ref::text WHERE a.action LIKE 'semaphore.%'`)).rows.map((row) => row.order_number);
      expect(await linked()).toHaveLength(2);
      expect((await call('coordinacion', 'DELETE', `/api/persons/${demo.election}/${erased}`)).statusCode).toBe(200);
      // Erasing again is not an error, and does not erase anyone else.
      const renamed = (await pool.query(`SELECT id FROM electors WHERE election_id = $1 AND erased_at IS NOT NULL`, [demo.election])).rows[0].id;
      expect((await call('coordinacion', 'DELETE', `/api/persons/${demo.election}/${renamed}`)).statusCode).toBe(200);
      expect(await linked()).toHaveLength(1);
      expect((await pool.query(`SELECT target FROM audit_log WHERE action = 'person.erased' AND id > $1`, [since])).rowCount).toBe(1);
      for (const status of ['escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${demo.election}/status`, { status });
      expect((await call('coordinacion', 'POST', `/api/elections/${demo.election}/purge`)).statusCode).toBe(200);
      expect(await linked()).toEqual([]);
      expect((await pool.query('SELECT count(*)::int AS n FROM electors WHERE election_id = $1 AND order_number IS NOT NULL', [demo.election])).rows[0].n).toBe(0);
    });

    it('a mark that arrives while someone is erased, or while the election is purged, does not keep their roll id', async () => {
      const load = async (dni: string) => {
        const id = (await call('coordinacion', 'POST', '/api/elections', { name: 'Carrera', kind: 'estudiantil', days: ['2027-04-06'] })).json().id as string;
        const file = writePadron({ electors: [{ id: `d-${dni}`, full_name: 'Persona, Ana', identifiers: [{ type: 'DNI', value: dni }], table: '1' }] as never });
        await app.inject({ method: 'POST', url: `/api/elections/${id}/roll`, payload: Buffer.from(file), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'application/zip' } });
        return { id, mesa: (await pool.query('SELECT id FROM polling_tables WHERE election_id = $1', [id])).rows[0].id as string };
      };
      const left = async (mesa: string, dni: string) => (await pool.query(`SELECT count(*)::int AS n FROM operations WHERE table_id = $1 AND payload::text LIKE '%' || $2 || '%'`, [mesa, dni])).rows[0].n;
      for (let round = 0; round < 8; round += 1) {
        const dni = `9930${String(round).padStart(4, '0')}`;
        const { id, mesa } = await load(dni);
        await Promise.all([push('coordinacion', mesa, [{ ...operation(mesa, round + 1), payload: { elector: `d-${dni}` } }]), call('coordinacion', 'DELETE', `/api/persons/${id}/d-${dni}`)]);
        expect(await left(mesa, dni), `erasure, round ${round}`).toBe(0);
        // The mark counts once, under the random id, whichever came first.
        expect((await pool.query(`SELECT count(*)::int AS n FROM operations o JOIN electors x ON x.public_id = o.payload->>'elector' WHERE o.table_id = $1`, [mesa])).rows[0].n).toBe(1);
      }
      for (let round = 0; round < 8; round += 1) {
        const dni = `9931${String(round).padStart(4, '0')}`;
        const { id, mesa } = await load(dni);
        for (const status of ['jornada', 'escrutinio', 'cerrada']) await call('coordinacion', 'POST', `/api/elections/${id}/status`, { status });
        const [late, purged] = await Promise.all([push('coordinacion', mesa, [{ ...operation(mesa, round + 1), payload: { elector: `d-${dni}` } }]), call('coordinacion', 'POST', `/api/elections/${id}/purge`)]);
        expect([late.statusCode, purged.statusCode]).toEqual([200, 200]);
        expect(await left(mesa, dni), `purge, round ${round}`).toBe(0);
      }
    });

    it('erasures and purges made before the roll id went too are done again when the server starts', async () => {
      const load = async (dnis: string[]) => {
        const id = (await call('coordinacion', 'POST', '/api/elections', { name: 'Vieja', kind: 'estudiantil', days: ['2027-04-06'] })).json().id as string;
        const file = writePadron({ electors: dnis.map((dni, i) => ({ id: `d-${dni}`, full_name: `Vieja${i}, Ana`, identifiers: [{ type: 'DNI', value: dni }], table: '1' })) as never });
        await app.inject({ method: 'POST', url: `/api/elections/${id}/roll`, payload: Buffer.from(file), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'application/zip' } });
        return { id, file, mesa: (await pool.query('SELECT id FROM polling_tables WHERE election_id = $1', [id])).rows[0].id as string };
      };
      const open = await load(['99320001', '99320002']);
      expect((await push('coordinacion', open.mesa, [{ ...operation(open.mesa, 1), payload: { elector: 'd-99320001' } }])).statusCode).toBe(200);
      // As erasing and purging left them before: the name gone, the roll id still there.
      await pool.query(`UPDATE electors SET full_name = 'Borrado a pedido', search = '', document = NULL WHERE id = 'd-99320001'`);
      const closed = await load(['99320003']);
      await pool.query(`UPDATE electors SET full_name = '', search = '', document = NULL WHERE election_id = $1`, [closed.id]);
      await pool.query(`UPDATE elections SET status = 'purgada' WHERE id = $1`, [closed.id]);

      // As a database before 0004: the server runs it, and the erasures that need the field key, once.
      await pool.query('DELETE FROM schema_migrations WHERE version >= 4');
      expect((await migrate(pool)).at(0)).toBe(4);
      expect(await migrate(pool)).toEqual([]);
      let dump = '';
      for (const name of ['electors', 'operations']) dump += (await pool.query(`SELECT coalesce(string_agg(row_to_json(t)::text, E'\\n'), '') AS rows FROM ${name} t`)).rows[0].rows;
      expect(dump).not.toContain('99320001');
      expect(dump).not.toContain('99320003');
      expect(dump).toContain('99320002');
      // Now it is an erasure like any other: the same roll does not bring the person back, and their vote still counts.
      const preview = await app.inject({ method: 'POST', url: `/api/elections/${open.id}/roll?preview=1`, payload: Buffer.from(open.file), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'application/zip' } });
      expect(preview.json()).toMatchObject({ people: 1, erased: 1, added: 0 });
      expect((await call('coordinacion', 'GET', `/api/elections/${open.id}/stats`)).json().voted).toBe(1);
    });

    it('any roll id can be erased, even one that looks like an erased one, and it is not counted as new afterwards', async () => {
      const id = (await call('coordinacion', 'POST', '/api/elections', { name: 'Equis', kind: 'estudiantil', days: ['2027-04-06'] })).json().id as string;
      const file = writePadron({ electors: [{ id: 'x-ana', full_name: 'Equis, Ana', identifiers: [{ type: 'DNI', value: '99123456' }] }, { id: 'x-eva', full_name: 'Equis, Eva' }] as never });
      const upload = (preview = false) =>
        app.inject({ method: 'POST', url: `/api/elections/${id}/roll${preview ? '?preview=1' : ''}`, payload: Buffer.from(file), headers: { authorization: `Bearer ${tokens.coordinacion}`, 'content-type': 'application/zip' } });
      await upload();
      expect((await upload(true)).json()).toMatchObject({ added: 0, kept: 2 });
      expect((await call('coordinacion', 'DELETE', `/api/persons/${id}/x-ana`)).statusCode).toBe(200);
      const rows = (await pool.query('SELECT id, full_name, document FROM electors WHERE election_id = $1 ORDER BY full_name', [id])).rows;
      expect(rows.map((row) => row.full_name)).toEqual(['Borrado a pedido', 'Equis, Eva']);
      expect(rows.some((row) => row.id === 'x-ana' || row.document)).toBe(false);
      expect((await upload(true)).json()).toMatchObject({ people: 1, added: 0, kept: 1, erased: 1 });
      // An erased row cannot get a name or a consent back.
      const erased = rows[0]!.id;
      expect((await call('coordinacion', 'PUT', `/api/persons/${id}/${erased}`, { full_name: 'Otra, Vez' })).statusCode).toBe(404);
      expect((await call('coordinacion', 'PUT', `/api/persons/${id}/${erased}/consent`, { date: '2027-01-01', means: 'firma' })).statusCode).toBe(404);
    });

    it('the audit log records who saw whom, by reference, and each panel once every few minutes', async () => {
      const since = Number((await pool.query('SELECT coalesce(max(id), 0) AS n FROM audit_log')).rows[0].n);
      const logged = async () => (await pool.query('SELECT action, target, detail FROM audit_log WHERE id > $1 ORDER BY id', [since])).rows;
      const people = (await call('semaforo', 'GET', `/api/elections/${demo.election}/people?q=ez`)).json().people;
      expect(people.length).toBeGreaterThan(0);
      await call('coordinacion', 'GET', '/api/persons?q=acu');
      for (let i = 0; i < 2; i += 1) {
        await call('coordinacion', 'GET', '/api/users');
        await call('jefe', 'GET', `/api/district/${demo.election}`);
        await call('jefe', 'GET', `/api/tables/${table}/detail`);
        await call('jefe', 'GET', `/api/sync/pull?table=${table}&since=0`);
        await call('fiscal', 'GET', `/api/sync/pull?table=${table}&since=0`);
        await call('coordinacion', 'GET', '/api/audit');
      }
      const unit = (await call('coordinacion', 'POST', `/api/elections/${demo.election}/units`, { name: 'Distrito nuevo' })).json().id;
      await call('coordinacion', 'PUT', `/api/tables/${table}`, { name: 'Mesa nueva', unit });
      const entries = await logged();
      const searched = entries.find((e) => e.action === 'semaphore.searched');
      const refs = (await pool.query('SELECT ref FROM electors WHERE public_id = ANY($1)', [people.map((p: { id: string }) => p.id)])).rows.map((row) => row.ref);
      expect(searched.detail.people.sort()).toEqual(refs.sort());
      expect(entries.find((e) => e.action === 'person.searched').detail.people.length).toBeGreaterThan(0);
      const count = (action: string) => entries.filter((e) => e.action === action).length;
      for (const action of ['users.viewed', 'district.viewed', 'table.viewed', 'table.pulled', 'audit.viewed', 'unit.created', 'table.changed']) expect(count(action), action).toBe(1);
      // Nothing in the log names anyone by roll id, document or name.
      const text = JSON.stringify(entries);
      const seen = (await pool.query('SELECT id, full_name, document FROM electors WHERE public_id = ANY($1)', [people.map((p: { id: string }) => p.id)])).rows;
      for (const person of seen) for (const value of [person.id, person.full_name, person.document]) expect(text).not.toContain(value);
    });

    it('the audit log records who did what, and cannot be changed', async () => {
      await call('fiscal', 'GET', `/api/tables/${table}/bundle`);
      const { entries } = (await call('coordinacion', 'GET', '/api/audit')).json();
      expect(entries.some((e: { action: string; who: string }) => e.action === 'roll.downloaded' && e.who === 'Marta')).toBe(true);
      await expect(pool.query('DELETE FROM audit_log')).rejects.toThrow(/cannot be changed/);
      await expect(pool.query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/cannot be changed/);
      await expect(pool.query('TRUNCATE audit_log')).rejects.toThrow(/cannot be changed/);
      expect((await call('fiscal', 'GET', '/api/audit')).statusCode).toBe(403);
    });
  });
});
