import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { dayIn, mainRole, SECURITY_PROFILES, storedPhone, themeProblems } from '@urna-abierta/domain';
import { attemptLimiter, audit, authenticated, can, forgetActors, getSetting, hashToken, needsSecondFactor, newToken, newTotpSecret, seal, securityProfile, setSetting, totpMatches, unseal, type Actor } from './actor.ts';
import { clock } from './clock.ts';
import { rollRevision, tableRoll } from './routes-sync.ts';

/** The theme chosen when installing is the one everyone sees until the party says otherwise. */
const defaultParty = () => ({ name: '', theme: process.env.URNA_TEMA ?? 'aula' });
const INVITATION_DAYS = 14;
const GUESSES_ALLOWED = 10;
const GUESS_WINDOW_MS = 15 * 60_000;

/**
 * `by` is who asks for it, or null for the demo of whoever runs the server. A device that comes from the link of
 * someone who does not manage people does not set up the second step of a person who never did.
 */
export async function createInvitation(pool: pg.Pool, userId: string, by: Actor | null): Promise<string> {
  const token = newToken();
  await pool.query(`INSERT INTO invitations (token_hash, user_id, expires_at, may_enroll) VALUES ($1, $2, now() + make_interval(days => $3), $4)`, [hashToken(token), userId, INVITATION_DAYS, by === null || can(by, 'users.manage')]);
  return token;
}

async function newDevice(pool: pg.Pool, userId: string, mayEnroll: boolean): Promise<string> {
  const token = newToken();
  await pool.query('INSERT INTO devices (id, user_id, token_hash, may_enroll) VALUES ($1, $2, $3, $4)', [randomUUID(), userId, hashToken(token), mayEnroll]);
  return token;
}

const sameText = (a: string, b: string) => {
  const [x, y] = [Buffer.from(hashToken(a)), Buffer.from(hashToken(b))];
  return timingSafeEqual(x, y);
};

interface StoredTheme {
  id: string;
  archivosFuentes?: { sha256?: string; datos?: string }[];
}

/**
 * A theme that passed the reading check. With the same id, it replaces the previous one. It comes as
 * one file, and its fonts are kept apart: each phone asks for them once, and not every time it opens.
 */
export async function addTheme(pool: pg.Pool, theme: StoredTheme): Promise<void> {
  const fonts = [];
  for (const { datos, ...font } of theme.archivosFuentes ?? []) {
    const [, mediaType, base64] = /^data:([^;]+);base64,(.*)$/.exec(datos ?? '') ?? [];
    const bytes = Buffer.from(base64 ?? '', 'base64');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await pool.query('INSERT INTO theme_fonts (sha256, media_type, data) VALUES ($1, $2, $3) ON CONFLICT (sha256) DO NOTHING', [sha256, mediaType, bytes]);
    fonts.push({ ...font, sha256 });
  }
  const themes = await getSetting<StoredTheme[]>(pool, 'themes', []);
  const stored = [...themes.filter((other) => other.id !== theme.id), { ...theme, ...(fonts.length > 0 ? { archivosFuentes: fonts } : {}) }];
  await setSetting(pool, 'themes', stored);
  // What the replaced theme had and no other uses goes away.
  const inUse = stored.flatMap((item) => (item.archivosFuentes ?? []).map((font) => font.sha256));
  await pool.query('DELETE FROM theme_fonts WHERE NOT (sha256 = ANY($1))', [inUse]);
}

export const MAX_THEME_BYTES = 24 * 1024 * 1024;

export function authRoutes(app: FastifyInstance, pool: pg.Pool) {
  const guesses = attemptLimiter(GUESSES_ALLOWED, GUESS_WINDOW_MS);
  const beforeSecondFactor = authenticated(pool, { beforeSecondFactor: true });

  /** What anyone can know before logging in: nothing more than how the app should look. */
  app.get('/api/public', async () => {
    const admins = await pool.query(`SELECT 1 FROM role_assignments WHERE role = 'sistema' LIMIT 1`);
    return {
      setupNeeded: admins.rowCount === 0,
      party: await getSetting(pool, 'party', defaultParty()),
      themes: await getSetting(pool, 'themes', []),
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
    await pool.query('INSERT INTO users (id, name, phone) VALUES ($1, $2, $3)', [userId, name.trim(), storedPhone(phone)]);
    for (const role of ['sistema', 'coordinacion']) {
      await pool.query('INSERT INTO role_assignments (id, user_id, role) VALUES ($1, $2, $3)', [randomUUID(), userId, role]);
    }
    await setSetting(pool, 'responsibility_accepted', { at: new Date().toISOString(), by: userId });
    await audit(pool, { userId } as never, 'setup', userId);
    return { token: await newDevice(pool, userId, true) };
  });

  /** The theme chosen in the installer, which arrives right after the server starts and before anyone gets in. */
  app.put<{ Body: { code?: unknown; theme?: unknown } }>('/api/setup/theme', { bodyLimit: MAX_THEME_BYTES }, async (request, reply) => {
    const { code, theme } = request.body ?? {};
    const expected = process.env.URNA_SETUP_CODE;
    const admins = await pool.query(`SELECT 1 FROM role_assignments WHERE role = 'sistema' LIMIT 1`);
    if (admins.rowCount !== 0) return reply.code(409).send({ error: 'already_set_up' });
    if (!expected || typeof code !== 'string' || !sameText(code, expected)) return reply.code(403).send({ error: 'wrong_code' });
    const problems = themeProblems(theme);
    if (problems.length > 0) return reply.code(422).send({ error: 'theme_not_usable', problems });
    await addTheme(pool, theme as StoredTheme);
    await audit(pool, null, 'theme.added', (theme as StoredTheme).id);
    return { ok: true };
  });

  /** Not private, because it shows before anyone logs in. Its address is its hash, so it never changes. */
  app.get<{ Params: { sha: string } }>('/api/theme-fonts/:sha', async (request, reply) => {
    const { sha } = request.params;
    if (!/^[0-9a-f]{64}$/.test(sha)) return reply.code(400).send({ error: 'invalid_font' });
    const found = await pool.query('SELECT media_type, data FROM theme_fonts WHERE sha256 = $1', [sha]);
    if (!found.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return reply.type(found.rows[0].media_type).header('cache-control', 'public, max-age=31536000, immutable').send(found.rows[0].data);
  });

  /** An invitation works once, and turns into this device's own credential. */
  app.post<{ Body: { token?: unknown } }>('/api/auth/redeem', async (request, reply) => {
    const { token } = request.body ?? {};
    if (typeof token !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    if (guesses.blocked(request.ip)) return reply.code(429).send({ error: 'too_many_attempts' });
    const used = await pool.query(
      `UPDATE invitations SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id, may_enroll`,
      [hashToken(token)],
    );
    const userId = used.rows[0]?.user_id;
    if (!userId) {
      guesses.failed(request.ip);
      return reply.code(410).send({ error: 'invitation_not_valid' });
    }
    await audit(pool, { userId } as never, 'device.joined', userId);
    return { token: await newDevice(pool, userId, used.rows[0].may_enroll) };
  });

  /** A short code to bring this person's session to an installed app, which on iPhone starts empty. */
  app.post('/api/auth/handoff', { preHandler: beforeSecondFactor }, async (request) => {
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    await pool.query(`INSERT INTO invitations (token_hash, user_id, expires_at, may_enroll) VALUES ($1, $2, now() + interval '15 minutes', $3)`, [hashToken(code), request.actor.userId, request.actor.mayEnroll]);
    return { code };
  });

  /**
   * The secret is kept sealed. It is shown once, and again only while it was never confirmed, to a device that may set
   * it up: one that came from the link of someone who does not manage people asks for a new link.
   */
  app.post('/api/auth/second-factor/start', { preHandler: beforeSecondFactor }, async (request, reply) => {
    const { actor } = request;
    const found = await pool.query('SELECT totp_sealed FROM users WHERE id = $1', [actor.userId]);
    if (found.rows[0].totp_sealed) return { enrolled: true };
    if (!actor.mayEnroll) return reply.code(403).send({ error: 'needs_new_invitation' });
    const pending = await getSetting<string | null>(pool, `totp_pending_${actor.userId}`, null);
    const secret = pending ? unseal(pending) : newTotpSecret();
    if (!pending) await setSetting(pool, `totp_pending_${actor.userId}`, seal(secret));
    return reply.send({ enrolled: false, secret, url: `otpauth://totp/Urna%20Abierta:${encodeURIComponent(actor.name)}?secret=${secret}&issuer=Urna%20Abierta` });
  });

  app.post<{ Body: { code?: unknown } }>('/api/auth/second-factor/verify', { preHandler: beforeSecondFactor }, async (request, reply) => {
    const { actor } = request;
    const { code } = request.body ?? {};
    if (typeof code !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    if (guesses.blocked(actor.userId)) return reply.code(429).send({ error: 'too_many_attempts' });
    const found = await pool.query('SELECT totp_sealed FROM users WHERE id = $1', [actor.userId]);
    if (!found.rows[0].totp_sealed && !actor.mayEnroll) return reply.code(403).send({ error: 'needs_new_invitation' });
    const pending = await getSetting<string | null>(pool, `totp_pending_${actor.userId}`, null);
    const sealed: string | null = found.rows[0].totp_sealed ?? pending;
    if (!sealed || !totpMatches(unseal(sealed), code.replace(/\D/g, ''))) {
      guesses.failed(actor.userId);
      return reply.code(403).send({ error: 'wrong_code' });
    }
    if (!found.rows[0].totp_sealed) {
      await pool.query('UPDATE users SET totp_sealed = $2 WHERE id = $1', [actor.userId, sealed]);
      await pool.query('DELETE FROM settings WHERE key = $1', [`totp_pending_${actor.userId}`]);
    }
    await pool.query('UPDATE devices SET second_factor_at = now() WHERE id = $1', [actor.deviceId]);
    forgetActors();
    await audit(pool, actor, 'device.second_factor', actor.userId);
    return { ok: true };
  });

  app.get('/api/me', { preHandler: beforeSecondFactor }, async (request) => {
    const { actor } = request;
    await pool.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [actor.deviceId]);
    const { profile, chosen, minimum } = await securityProfile(pool);
    const tableIds = actor.assignments.filter((a) => a.role === 'fiscal' && a.table_id).map((a) => a.table_id);
    const tables = await pool.query(
      `SELECT t.id, t.name, t.place, t.unit_id, e.id AS election_id, e.name AS election, e.days, e.status, e.categories, e.time_zone,
              (SELECT count(*)::int FROM electors x WHERE x.table_id = t.id) AS total
       FROM polling_tables t JOIN elections e ON e.id = t.election_id
       WHERE t.id = ANY($1) AND e.status NOT IN ('cerrada', 'purgada')
       ORDER BY e.created_at DESC`,
      [tableIds],
    );
    const iso = (day: Date) => day.toISOString().slice(0, 10);
    const now = clock.now();
    const shiftOf = (id: string) => actor.assignments.find((a) => a.role === 'fiscal' && a.table_id === id)?.days?.map(iso) ?? null;
    // Someone may have a different table each day: the one of today, or else the next one. Today where the election is.
    const rank = (row: { id: string; days: Date[]; time_zone: string }) => {
      const days = shiftOf(row.id) ?? row.days.map(iso);
      const today = dayIn(row.time_zone, now);
      return days.includes(today) ? 0 : days.some((day) => day > today) ? 1 : 2;
    };
    const table = [...tables.rows].sort((a, b) => rank(a) - rank(b))[0] ?? null;
    let contact = null;
    let ended = false;
    if (table) {
      // Someone with a phone, or the plan B has nothing to call: the chief of the table, one of the whole election, coordination.
      const chief = await pool.query(
        `SELECT u.name, u.phone FROM role_assignments a JOIN users u ON u.id = a.user_id
         WHERE u.removed_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > now())
           AND ((a.role = 'jefe' AND (a.unit_id = $1 OR (a.unit_id IS NULL AND (a.election_id IS NULL OR a.election_id = $2)))) OR a.role = 'coordinacion')
         ORDER BY (btrim(coalesce(u.phone, '')) <> '') DESC, coalesce(a.role = 'jefe' AND a.unit_id = $1, false) DESC, (a.role = 'jefe') DESC, u.created_at
         LIMIT 1`,
        [table.unit_id, table.election_id],
      );
      contact = chief.rows[0] ?? null;
    } else {
      // Whoever worked an election that just closed is told so, rather than that they have no table yet.
      // Only for a week: after that, someone from the primaries may be waiting for a table in the general election.
      const closed = await pool.query(
        `SELECT 1 FROM role_assignments a JOIN polling_tables t ON t.id = a.table_id JOIN elections e ON e.id = t.election_id
         WHERE a.user_id = $1 AND a.role = 'fiscal' AND e.status IN ('cerrada', 'purgada') AND e.closed_at > now() - interval '7 days' LIMIT 1`,
        [actor.userId],
      );
      ended = closed.rowCount !== 0;
    }
    return {
      user: { id: actor.userId, name: actor.name },
      roles: actor.roles,
      // What each screen checks: a party can edit what a role allows.
      permissions: actor.permissions,
      main: mainRole(actor.roles),
      secondFactorNeeded: await needsSecondFactor(pool, actor),
      party: await getSetting(pool, 'party', defaultParty()),
      security: {
        profile,
        chosen: (await pool.query(`SELECT 1 FROM settings WHERE key = 'security_profile'`)).rowCount === 1,
        // What the party chose, which is what the Security screen starts from: the profile above may be an election's.
        choice: chosen,
        minimum,
        fiscalView: await getSetting(pool, 'fiscal_semaphore', false),
        ...SECURITY_PROFILES[profile],
      },
      table: table && {
        id: table.id,
        name: table.name,
        place: table.place,
        election: table.election,
        electionId: table.election_id,
        status: table.status,
        days: table.days.map(iso),
        shift: shiftOf(table.id),
        categories: table.categories,
        total: table.total,
        timeZone: table.time_zone,
        rollRevision: rollRevision(await tableRoll(pool, table.id)),
      },
      contact,
      ended,
    };
  });
}
