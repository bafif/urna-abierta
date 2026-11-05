import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { mainRole, SECURITY_PROFILES, type SecurityProfile } from '@urna-abierta/domain';
import { audit, authenticated, getSetting, hashToken, newToken, setSetting } from './actor.ts';

const INVITATION_DAYS = 14;

export async function createInvitation(pool: pg.Pool, userId: string): Promise<string> {
  const token = newToken();
  await pool.query(`INSERT INTO invitations (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`, [hashToken(token), userId, INVITATION_DAYS]);
  return token;
}

async function newDevice(pool: pg.Pool, userId: string): Promise<string> {
  const token = newToken();
  await pool.query('INSERT INTO devices (id, user_id, token_hash) VALUES ($1, $2, $3)', [randomUUID(), userId, hashToken(token)]);
  return token;
}

const sameText = (a: string, b: string) => {
  const [x, y] = [Buffer.from(hashToken(a)), Buffer.from(hashToken(b))];
  return timingSafeEqual(x, y);
};

export function authRoutes(app: FastifyInstance, pool: pg.Pool) {
  /** What anyone can know before logging in: nothing more than how the app should look. */
  app.get('/api/public', async () => {
    const admins = await pool.query(`SELECT 1 FROM role_assignments WHERE role = 'sistema' LIMIT 1`);
    return {
      setupNeeded: admins.rowCount === 0,
      party: await getSetting(pool, 'party', { name: '', theme: 'aula' }),
    };
  });

  /** The first administrator: only with the code the installer showed. */
  app.post<{ Body: { code?: unknown; name?: unknown; phone?: unknown; accepted?: unknown } }>('/api/setup', async (request, reply) => {
    const { code, name, phone, accepted } = request.body ?? {};
    const expected = process.env.URNA_SETUP_CODE;
    const admins = await pool.query(`SELECT 1 FROM role_assignments WHERE role = 'sistema' LIMIT 1`);
    if (admins.rowCount !== 0) return reply.code(409).send({ error: 'already_set_up' });
    if (!expected || typeof code !== 'string' || !sameText(code, expected)) return reply.code(403).send({ error: 'wrong_code' });
    if (typeof name !== 'string' || !name.trim() || name.length > 120) return reply.code(400).send({ error: 'invalid_name' });
    if (accepted !== true) return reply.code(400).send({ error: 'must_accept_responsibility' });
    const userId = randomUUID();
    await pool.query('INSERT INTO users (id, name, phone) VALUES ($1, $2, $3)', [userId, name.trim(), typeof phone === 'string' ? phone : null]);
    for (const role of ['sistema', 'coordinacion']) {
      await pool.query('INSERT INTO role_assignments (id, user_id, role) VALUES ($1, $2, $3)', [randomUUID(), userId, role]);
    }
    await setSetting(pool, 'responsibility_accepted', { at: new Date().toISOString(), by: userId });
    await audit(pool, { userId } as never, 'setup', userId);
    return { token: await newDevice(pool, userId) };
  });

  /** An invitation works once, and turns into this device's own credential. */
  app.post<{ Body: { token?: unknown } }>('/api/auth/redeem', async (request, reply) => {
    const { token } = request.body ?? {};
    if (typeof token !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    const used = await pool.query(
      `UPDATE invitations SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [hashToken(token)],
    );
    const userId = used.rows[0]?.user_id;
    if (!userId) return reply.code(410).send({ error: 'invitation_not_valid' });
    await audit(pool, { userId } as never, 'device.joined', userId);
    return { token: await newDevice(pool, userId) };
  });

  app.get('/api/me', { preHandler: authenticated(pool) }, async (request) => {
    const { actor } = request;
    await pool.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [actor.deviceId]);
    const profile = await getSetting<SecurityProfile>(pool, 'security_profile', 'estudiantil');
    const tableIds = actor.assignments.filter((a) => a.role === 'fiscal' && a.table_id).map((a) => a.table_id);
    const tables = await pool.query(
      `SELECT t.id, t.name, t.place, t.unit_id, e.id AS election_id, e.name AS election, e.days, e.status, e.categories,
              (SELECT count(*)::int FROM electors x WHERE x.table_id = t.id) AS total
       FROM polling_tables t JOIN elections e ON e.id = t.election_id
       WHERE t.id = ANY($1) AND e.status NOT IN ('cerrada', 'purgada')
       ORDER BY e.created_at DESC`,
      [tableIds],
    );
    const table = tables.rows[0] ?? null;
    let contact = null;
    if (table) {
      const chief = await pool.query(
        `SELECT u.name, u.phone FROM role_assignments a JOIN users u ON u.id = a.user_id
         WHERE u.removed_at IS NULL AND ((a.role = 'jefe' AND a.unit_id = $1) OR a.role = 'coordinacion')
         ORDER BY (a.role = 'jefe') DESC LIMIT 1`,
        [table.unit_id],
      );
      contact = chief.rows[0] ?? null;
    }
    return {
      user: { id: actor.userId, name: actor.name },
      roles: actor.roles,
      main: mainRole(actor.roles),
      party: await getSetting(pool, 'party', { name: '', theme: 'aula' }),
      security: { profile, ...SECURITY_PROFILES[profile] },
      table: table && {
        id: table.id,
        name: table.name,
        place: table.place,
        election: table.election,
        electionId: table.election_id,
        status: table.status,
        days: table.days.map((d: Date) => d.toISOString().slice(0, 10)),
        categories: table.categories,
        total: table.total,
      },
      contact,
    };
  });
}
