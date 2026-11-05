import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { uuidv7, writePadron, type Operation } from '@urna-abierta/domain';
import { buildApp, migrate, seedDemo } from '../src/app.ts';

const url = process.env.TEST_DATABASE_URL;

function operation(table: string, seq: number, elector = `e-${seq}`): Operation {
  return { id: uuidv7(), schema: 1, table, device: 'd-1', device_seq: seq, device_time: '2027-04-06T12:00:00.000Z', type: 'voter.marked', payload: { elector } };
}

describe.skipIf(!url)('against a real Postgres', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let demo: Awaited<ReturnType<typeof seedDemo>>;
  let table: string;
  let tokens: Record<string, string>;

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
    app = buildApp(pool);
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
      const sha = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
      process.env.URNA_PHOTOS_DIR = '/tmp/urna-fotos-prueba';
      const put = (who: string, hash: string) => app.inject({ method: 'PUT', url: `/api/tables/${table}/photos/${hash}`, payload: bytes, headers: { authorization: `Bearer ${tokens[who]}`, 'content-type': 'image/jpeg' } });
      expect((await put('fiscal', 'a'.repeat(64))).statusCode).toBe(400);
      expect((await put('otra', sha)).statusCode).toBe(403);
      expect((await put('fiscal', sha)).statusCode).toBe(200);
      expect((await call('otra', 'GET', `/api/tables/${table}/photos/${sha}`)).statusCode).toBe(403);
      expect((await call('jefe', 'GET', `/api/tables/${table}/photos/${sha}`)).body).toBe('foto de prueba');
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
      const res = await upload(id, writePadron({ electors: people(2) as never, externalAi: true }));
      expect(res.json().error).toBe('external_ai_forbidden');
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
