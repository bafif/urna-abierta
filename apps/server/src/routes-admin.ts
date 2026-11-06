import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { foldText, isRole, isSecurityProfile, MAX_ROLL_BYTES, PERMISSIONS, PERMISSIONS_KEPT, readCsvRoll, readPadron, ROLES, SECURITY_PROFILES, stricterProfile, themeProblems, type PadronRead, type Permission, type Role, type RoleOverrides } from '@urna-abierta/domain';
import { audit, auditView, authenticated, can, erasedId, forgetActors, getSetting, isErasedId, requires, securityProfile, setSetting } from './actor.ts';
import { forgetStatuses } from './routes-sync.ts';
import { addTheme, createInvitation, MAX_THEME_BYTES } from './routes-auth.ts';

/** A CSV saved by Excel in Spanish on Windows comes in Windows-1252: read as UTF-8, its accents would break. */
function csvText(body: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('windows-1252').decode(body);
  }
}
const STATS_ROLE_DAYS = 90;
const STATUSES = ['preparacion', 'jornada', 'escrutinio', 'cerrada', 'purgada'];
const KINDS = ['estudiantil', 'local', 'nacional', 'otra'];
const text = (value: unknown, max = 200) => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null);

/** Once an election closes, its roll and its tables stay as they are: what remains is reviewing it and purging it. */
export async function closedElection(pool: pg.Pool, election: string): Promise<boolean | null> {
  const found = await pool.query('SELECT status FROM elections WHERE id = $1', [election]);
  return found.rows[0] ? ['cerrada', 'purgada'].includes(found.rows[0].status) : null;
}

export function adminRoutes(app: FastifyInstance, pool: pg.Pool) {
  const manageElection = requires(pool, 'election.manage');
  const manageUsers = requires(pool, 'users.manage');

  // ---------- The party ----------
  app.put<{ Body: { name?: unknown; theme?: unknown } }>('/api/party', { preHandler: manageElection }, async (request, reply) => {
    const name = text(request.body?.name, 120);
    const theme = text(request.body?.theme, 40) ?? 'aula';
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    await setSetting(pool, 'party', { name, theme });
    await audit(pool, request.actor, 'party.changed');
    return { name, theme };
  });

  /** Themes a party adds. Each has to pass the same reading check as the ones that come with the app. */
  app.put<{ Body: { theme?: unknown } }>('/api/themes', { preHandler: manageElection, bodyLimit: MAX_THEME_BYTES }, async (request, reply) => {
    const { theme } = request.body ?? {};
    const problems = themeProblems(theme);
    if (problems.length > 0) return reply.code(422).send({ error: 'theme_not_usable', problems });
    await addTheme(pool, theme as { id: string });
    await audit(pool, request.actor, 'theme.added', (theme as { id: string }).id);
    return { ok: true };
  });

  app.put<{ Body: { profile?: unknown } }>('/api/security', { preHandler: requires(pool, 'security.manage') }, async (request, reply) => {
    const { profile } = request.body ?? {};
    if (!isSecurityProfile(profile)) return reply.code(400).send({ error: 'invalid_profile' });
    // An open election holds the level its kind asks for, whoever wants to lower it.
    const { minimum } = await securityProfile(pool);
    if (stricterProfile(profile, minimum) !== profile) return reply.code(409).send({ error: 'election_needs_more', minimum });
    await setSetting(pool, 'security_profile', profile);
    // Going to a stricter profile takes away what it does not allow.
    if (!SECURITY_PROFILES[profile].fiscalSeesSemaphore) await setSetting(pool, 'fiscal_semaphore', false);
    await audit(pool, request.actor, 'security.changed', profile);
    return { profile, ...SECURITY_PROFILES[profile] };
  });

  // ---------- Roles: the permissions are a fixed list, and what each role gets can be edited ----------
  app.get('/api/roles', { preHandler: manageUsers }, async () => ({
    permissions: PERMISSIONS,
    recommended: ROLES,
    edited: await getSetting<RoleOverrides>(pool, 'role_permissions', {}),
    kept: PERMISSIONS_KEPT,
  }));

  app.put<{ Params: { role: string }; Body: { permissions?: unknown } }>('/api/roles/:role', { preHandler: manageUsers }, async (request, reply) => {
    const { role } = request.params;
    const { permissions } = request.body ?? {};
    if (!isRole(role)) return reply.code(404).send({ error: 'no_such_role' });
    const edited = await getSetting<RoleOverrides>(pool, 'role_permissions', {});
    if (permissions === null) {
      delete edited[role as Role];
    } else {
      const known = new Set<string>(PERMISSIONS);
      if (!Array.isArray(permissions) || permissions.some((item) => !known.has(item))) return reply.code(400).send({ error: 'invalid_permissions' });
      const kept = PERMISSIONS_KEPT[role as Role] ?? [];
      if (kept.some((item) => !permissions.includes(item))) return reply.code(409).send({ error: 'must_keep' });
      edited[role as Role] = permissions as Permission[];
    }
    await setSetting(pool, 'role_permissions', edited);
    forgetActors();
    await audit(pool, request.actor, 'role.edited', role, { permissions });
    return { ok: true };
  });

  /** In a low risk election, the party can let poll watchers see the traffic light of their table. */
  app.put<{ Body: { enabled?: unknown } }>('/api/semaphore/fiscal-view', { preHandler: manageElection }, async (request, reply) => {
    const enabled = request.body?.enabled === true;
    const { profile } = await securityProfile(pool);
    if (enabled && !SECURITY_PROFILES[profile].fiscalSeesSemaphore) return reply.code(409).send({ error: 'profile_forbids' });
    await setSetting(pool, 'fiscal_semaphore', enabled);
    await audit(pool, request.actor, 'semaphore.fiscal_view', undefined, { enabled });
    return { enabled };
  });

  // ---------- Backups ----------
  /** They are made on the server and already encrypted. From here they can be taken somewhere else. */
  const backupsDir = () => process.env.URNA_BACKUPS_DIR ?? '/copias';
  const BACKUP_NAME = /^urna-\d{8}-\d{6}\.tar\.gpg$/;

  app.get('/api/backups', { preHandler: requires(pool, 'security.manage') }, async () => {
    const names = await readdir(backupsDir()).catch(() => [] as string[]);
    const backups = await Promise.all(
      names.filter((name) => BACKUP_NAME.test(name)).map(async (name) => {
        const info = await stat(join(backupsDir(), name));
        return { name, bytes: info.size, at: info.mtime.toISOString() };
      }),
    );
    return { backups: backups.sort((a, b) => b.name.localeCompare(a.name)) };
  });

  app.get<{ Params: { name: string } }>('/api/backups/:name', { preHandler: requires(pool, 'security.manage') }, async (request, reply) => {
    const { name } = request.params;
    if (!BACKUP_NAME.test(name)) return reply.code(400).send({ error: 'invalid_name' });
    const info = await stat(join(backupsDir(), name)).catch(() => null);
    if (!info) return reply.code(404).send({ error: 'not_found' });
    await audit(pool, request.actor, 'backup.downloaded', name);
    return reply.type('application/octet-stream').header('content-disposition', `attachment; filename="${name}"`).send(createReadStream(join(backupsDir(), name)));
  });

  // ---------- People ----------
  app.get('/api/users', { preHandler: manageUsers }, async (request) => {
    await auditView(pool, request.actor, 'users.viewed');
    const users = await pool.query(
      `SELECT u.id, u.name, u.phone,
              COALESCE(json_agg(json_build_object('role', a.role, 'table', a.table_id, 'unit', a.unit_id)) FILTER (WHERE a.id IS NOT NULL), '[]') AS roles,
              EXISTS (SELECT 1 FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL) AS joined
       FROM users u LEFT JOIN role_assignments a ON a.user_id = u.id
       WHERE u.removed_at IS NULL GROUP BY u.id ORDER BY u.created_at`,
    );
    return { users: users.rows };
  });

  app.post<{ Body: { name?: unknown; phone?: unknown; role?: unknown; table?: unknown; unit?: unknown; expiresAt?: unknown; days?: unknown } }>('/api/users', { preHandler: manageUsers }, async (request, reply) => {
    const { role, phone, table, unit, expiresAt, days } = request.body ?? {};
    const name = text(request.body?.name, 120);
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    if (!isRole(role)) return reply.code(400).send({ error: 'invalid_role' });
    const userId = randomUUID();
    await pool.query('INSERT INTO users (id, name, phone) VALUES ($1, $2, $3)', [userId, name, typeof phone === 'string' ? phone : null]);
    const shift = Array.isArray(days) ? days.filter((day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) : null;
    // Whoever only looks at the numbers does not keep access for good.
    const expires = typeof expiresAt === 'string' ? expiresAt : role === 'estadistico' ? new Date(Date.now() + STATS_ROLE_DAYS * 86_400_000).toISOString() : null;
    await pool.query('INSERT INTO role_assignments (id, user_id, role, table_id, unit_id, expires_at, days) VALUES ($1, $2, $3, $4, $5, $6, $7::date[])', [randomUUID(), userId, role, typeof table === 'string' ? table : null, typeof unit === 'string' ? unit : null, expires, shift]);
    await audit(pool, request.actor, 'user.created', userId, { role });
    return { id: userId, invitation: await createInvitation(pool, userId) };
  });

  app.post<{ Params: { id: string }; Body: { role?: unknown; table?: unknown; unit?: unknown } }>('/api/users/:id/roles', { preHandler: manageUsers }, async (request, reply) => {
    const { role, table, unit } = request.body ?? {};
    if (!isRole(role)) return reply.code(400).send({ error: 'invalid_role' });
    await pool.query('INSERT INTO role_assignments (id, user_id, role, table_id, unit_id) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), request.params.id, role, typeof table === 'string' ? table : null, typeof unit === 'string' ? unit : null]);
    forgetActors();
    await audit(pool, request.actor, 'role.added', request.params.id, { role });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/invitation', { preHandler: requires(pool, 'team.invite') }, async (request) => {
    await audit(pool, request.actor, 'invitation.created', request.params.id);
    return { invitation: await createInvitation(pool, request.params.id) };
  });

  /** Takes someone out: their phones stop working the next time they connect. */
  app.delete<{ Params: { id: string } }>('/api/users/:id', { preHandler: manageUsers }, async (request) => {
    await pool.query('UPDATE users SET removed_at = now() WHERE id = $1', [request.params.id]);
    await pool.query('UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [request.params.id]);
    await pool.query('DELETE FROM role_assignments WHERE user_id = $1', [request.params.id]);
    forgetActors();
    await audit(pool, request.actor, 'user.removed', request.params.id);
    return { ok: true };
  });

  // ---------- Elections ----------
  app.get('/api/elections', { preHandler: manageElection }, async () => {
    const rows = await pool.query(
      `SELECT e.id, e.name, e.kind, e.days, e.status, e.categories,
              (SELECT count(*)::int FROM electors x WHERE x.election_id = e.id) AS people,
              (SELECT count(*)::int FROM electors x WHERE x.election_id = e.id AND x.needs_review) AS to_review,
              (SELECT count(*)::int FROM electors x WHERE x.election_id = e.id AND x.table_id IS NULL) AS without_table,
              (SELECT count(*)::int FROM polling_tables t WHERE t.election_id = e.id) AS tables,
              (SELECT count(*)::int FROM polling_tables t WHERE t.election_id = e.id AND NOT (
                 EXISTS (SELECT 1 FROM role_assignments a WHERE a.table_id = t.id AND a.role = 'fiscal' AND a.days IS NULL)
                 OR e.days <@ COALESCE((SELECT array_agg(d) FROM role_assignments a, unnest(a.days) AS d WHERE a.table_id = t.id AND a.role = 'fiscal'), '{}'::date[])
               )) AS tables_without_fiscal
       FROM elections e ORDER BY e.created_at DESC`,
    );
    return { elections: rows.rows.map((row) => ({ ...row, days: row.days.map((d: Date) => d.toISOString().slice(0, 10)) })) };
  });

  /** Which elections someone working with numbers or the traffic light can pick: names only. */
  app.get('/api/open-elections', { preHandler: authenticated(pool) }, async (request, reply) => {
    const { actor } = request;
    if (!can(actor, 'semaphore.read') && !can(actor, 'stats.read') && !can(actor, 'semaphore.sensitive')) return reply.code(403).send({ error: 'forbidden' });
    const rows = await pool.query(`SELECT id, name, status FROM elections WHERE status <> 'purgada' ORDER BY created_at DESC`);
    return { elections: rows.rows };
  });

  app.post<{ Body: { name?: unknown; kind?: unknown; days?: unknown; categories?: unknown } }>('/api/elections', { preHandler: manageElection }, async (request, reply) => {
    const { kind, days, categories } = request.body ?? {};
    const name = text(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    if (typeof kind !== 'string' || !KINDS.includes(kind)) return reply.code(400).send({ error: 'invalid_kind' });
    const dates = Array.isArray(days) ? days.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
    if (dates.length === 0) return reply.code(400).send({ error: 'no_days' });
    const id = randomUUID();
    await pool.query('INSERT INTO elections (id, name, kind, days, categories) VALUES ($1, $2, $3, $4::date[], $5)', [id, name, kind, dates, JSON.stringify(Array.isArray(categories) ? categories : [])]);
    await audit(pool, request.actor, 'election.created', id);
    return { id };
  });

  app.put<{ Params: { id: string }; Body: { categories?: unknown; days?: unknown; name?: unknown } }>('/api/elections/:id', { preHandler: manageElection }, async (request) => {
    const { categories, days, name } = request.body ?? {};
    await pool.query('UPDATE elections SET categories = COALESCE($2, categories), days = COALESCE($3::date[], days), name = COALESCE($4, name) WHERE id = $1', [request.params.id, Array.isArray(categories) ? JSON.stringify(categories) : null, Array.isArray(days) ? days : null, text(name)]);
    await audit(pool, request.actor, 'election.changed', request.params.id);
    return { ok: true };
  });

  /** preparation > voting days > count > closed > purged, and only forward. */
  app.post<{ Params: { id: string }; Body: { status?: unknown } }>('/api/elections/:id/status', { preHandler: manageElection }, async (request, reply) => {
    const { status } = request.body ?? {};
    const current = await pool.query('SELECT status FROM elections WHERE id = $1', [request.params.id]);
    if (!current.rows[0]) return reply.code(404).send({ error: 'not_found' });
    if (typeof status !== 'string' || STATUSES.indexOf(status) !== STATUSES.indexOf(current.rows[0].status) + 1) return reply.code(409).send({ error: 'invalid_step' });
    if (status === 'purgada') return reply.code(409).send({ error: 'use_purge' });
    await pool.query(`UPDATE elections SET status = $2, closed_at = CASE WHEN $2 = 'cerrada' THEN now() ELSE closed_at END WHERE id = $1`, [request.params.id, status]);
    forgetStatuses();
    await audit(pool, request.actor, 'election.status', request.params.id, { status });
    return { status };
  });

  // ---------- The roll ----------
  for (const type of ['application/zip', 'application/octet-stream', 'text/csv']) {
    app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_ROLL_BYTES }, (_request, body, done) => done(null, body));
  }

  /** ?preview=1 says what would change, without touching anything. Crossed-out names and the traffic light stay. */
  app.post<{ Params: { id: string }; Querystring: { preview?: string }; Body: Buffer }>('/api/elections/:id/roll', { preHandler: manageElection, bodyLimit: MAX_ROLL_BYTES }, async (request, reply) => {
    const election = request.params.id;
    const closed = await closedElection(pool, election);
    if (closed === null) return reply.code(404).send({ error: 'not_found' });
    if (closed) return reply.code(409).send({ error: 'election_closed' });
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'send_a_file' });
    const isCsv = (request.headers['content-type'] ?? '').startsWith('text/csv');
    const read: PadronRead = isCsv ? readCsvRoll(csvText(request.body)) : readPadron(new Uint8Array(request.body));
    if (!read.padron) return reply.code(422).send({ error: 'cannot_read', problems: read.problems });
    const { manifest } = read.padron;
    const { profile } = await securityProfile(pool);
    const externalAi = manifest.extraction?.external_ai === true ? SECURITY_PROFILES[profile].externalAi : null;
    if (externalAi === 'forbidden') return reply.code(422).send({ error: 'external_ai_forbidden' });
    // The other profiles let it in, saying so before it is loaded.
    if (externalAi) read.problems.push({ where: 'file', problem: externalAi === 'paid-only' ? 'external_ai_paid_only' : 'external_ai' });
    const existing = await pool.query('SELECT id, corrected_at IS NOT NULL AS corrected FROM electors WHERE election_id = $1', [election]);
    // Whoever asked to be erased is not loaded again, and what someone corrected stays corrected.
    const erased = new Set(existing.rows.filter((row) => isErasedId(row.id)).map((row) => row.id));
    const known = new Set(existing.rows.filter((row) => !isErasedId(row.id)).map((row) => row.id));
    const corrected = new Set(existing.rows.filter((row) => row.corrected).map((row) => row.id));
    const electors = read.padron.electors.filter((e) => erased.size === 0 || !erased.has(erasedId(e.id)));
    const incoming = new Set(electors.map((e) => e.id));
    const summary = {
      people: electors.length,
      added: electors.filter((e) => !known.has(e.id)).length,
      kept: electors.filter((e) => known.has(e.id)).length,
      missing: [...known].filter((id) => !incoming.has(id)).length,
      erased: read.padron.electors.length - electors.length,
      corrected: electors.filter((e) => corrected.has(e.id)).length,
      toReview: electors.filter((e) => e.review?.status === 'pending' && !corrected.has(e.id)).length,
      withoutTable: electors.filter((e) => !e.table).length,
      problems: read.problems,
    };
    if (request.query.preview === '1') return summary;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Tables named in the file are created as they come.
      const named = new Map<string, string>();
      const names = [...new Set(electors.map((e) => e.table).filter((t): t is string => Boolean(t)))];
      const declared = new Map(read.padron.units.map((u) => [u.id, u.name]));
      for (const [position, key] of names.entries()) {
        const found = await client.query('SELECT id FROM polling_tables WHERE election_id = $1 AND (id = $2 OR name = $3)', [election, `${election}:${key}`, declared.get(key) ?? `Mesa ${key}`]);
        const id = found.rows[0]?.id ?? randomUUID();
        if (!found.rows[0]) await client.query('INSERT INTO polling_tables (id, election_id, name, position) VALUES ($1, $2, $3, $4)', [id, election, declared.get(key) ?? `Mesa ${key}`, position]);
        named.set(key, id);
      }
      for (let i = 0; i < electors.length; i += 500) {
        const part = electors.slice(i, i + 500);
        const value = (fn: (e: (typeof part)[number]) => unknown) => part.map(fn);
        const documentOf = (e: (typeof part)[number]) => e.identifiers?.find((x) => x.type.toUpperCase() !== 'LEGAJO')?.value ?? null;
        await client.query(
          `INSERT INTO electors (election_id, id, table_id, order_number, full_name, search, document, file_number, address, extra, needs_review, review)
           SELECT $1, * FROM unnest($2::text[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::jsonb[], $11::boolean[], $12::jsonb[])
           ON CONFLICT (election_id, id) DO UPDATE SET
             table_id = COALESCE(EXCLUDED.table_id, electors.table_id), order_number = COALESCE(EXCLUDED.order_number, electors.order_number),
             full_name = CASE WHEN electors.corrected_at IS NULL THEN EXCLUDED.full_name ELSE electors.full_name END,
             search = CASE WHEN electors.corrected_at IS NULL THEN EXCLUDED.search ELSE electors.search END,
             document = CASE WHEN electors.corrected_at IS NULL THEN EXCLUDED.document ELSE electors.document END,
             needs_review = CASE WHEN electors.corrected_at IS NULL THEN EXCLUDED.needs_review ELSE electors.needs_review END,
             review = CASE WHEN electors.corrected_at IS NULL THEN EXCLUDED.review ELSE electors.review END,
             file_number = EXCLUDED.file_number, address = EXCLUDED.address, extra = EXCLUDED.extra`,
          [
            election,
            value((e) => e.id),
            value((e) => (e.table ? named.get(e.table) : null)),
            value((e) => e.order ?? null),
            value((e) => e.full_name),
            value((e) => foldText(`${e.full_name} ${documentOf(e) ?? ''}`)),
            value(documentOf),
            value((e) => e.identifiers?.find((x) => x.type.toUpperCase() === 'LEGAJO')?.value ?? null),
            value((e) => e.address ?? null),
            value((e) => JSON.stringify(e.extra ?? {})),
            value((e) => e.review?.status === 'pending'),
            value((e) => (e.review ? JSON.stringify(e.review) : null)),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await audit(pool, request.actor, 'roll.imported', election, { people: electors.length, added: summary.added, erased: summary.erased, corrected: summary.corrected });
    return summary;
  });

  app.get<{ Params: { id: string } }>('/api/elections/:id/review', { preHandler: manageElection }, async (request) => {
    const rows = await pool.query('SELECT id, full_name, document, file_number, review FROM electors WHERE election_id = $1 AND needs_review ORDER BY full_name LIMIT 200', [request.params.id]);
    await audit(pool, request.actor, 'roll.review_opened', request.params.id, { rows: rows.rowCount });
    return { rows: rows.rows };
  });

  app.put<{ Params: { id: string; elector: string }; Body: { full_name?: unknown; document?: unknown } }>('/api/elections/:id/electors/:elector', { preHandler: manageElection }, async (request, reply) => {
    const name = text(request.body?.full_name);
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    const closed = await closedElection(pool, request.params.id);
    if (closed) return reply.code(409).send({ error: 'election_closed' });
    const document = typeof request.body?.document === 'string' ? request.body.document.replace(/\D/g, '') || null : null;
    const corrected = await pool.query('UPDATE electors SET full_name = $3, document = COALESCE($4, document), search = $5, needs_review = false, corrected_at = now() WHERE election_id = $1 AND id = $2 RETURNING ref', [request.params.id, request.params.elector, name, document, foldText(`${name} ${document ?? ''}`)]);
    if (!corrected.rows[0]) return reply.code(404).send({ error: 'not_found' });
    await audit(pool, request.actor, 'elector.corrected', corrected.rows[0].ref);
    return { ok: true };
  });

  // ---------- Tables ----------
  app.get<{ Params: { id: string } }>('/api/elections/:id/tables', { preHandler: manageElection }, async (request) => {
    const rows = await pool.query(
      `SELECT t.id, t.name, t.place, t.unit_id, count(x.id)::int AS people,
              (SELECT min(x2.search) FROM electors x2 WHERE x2.table_id = t.id) AS first,
              (SELECT max(x2.search) FROM electors x2 WHERE x2.table_id = t.id) AS last,
              COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'days', a.days)) FROM role_assignments a JOIN users u ON u.id = a.user_id
               WHERE a.table_id = t.id AND a.role = 'fiscal' AND u.removed_at IS NULL), '[]') AS fiscales
       FROM polling_tables t LEFT JOIN electors x ON x.table_id = t.id
       WHERE t.election_id = $1 GROUP BY t.id ORDER BY t.position`,
      [request.params.id],
    );
    return { tables: rows.rows.map(({ first, last, ...row }) => ({ ...row, from: first?.slice(0, 1).toUpperCase() ?? '', to: last?.slice(0, 1).toUpperCase() ?? '' })) };
  });

  /** Proposes tables for whoever has none, by surname. The person only corrects if needed. */
  app.post<{ Params: { id: string }; Body: { size?: unknown } }>('/api/elections/:id/tables/propose', { preHandler: manageElection }, async (request, reply) => {
    const size = Math.max(10, Math.min(Number(request.body?.size) || 350, 2000));
    const election = request.params.id;
    if (await closedElection(pool, election)) return reply.code(409).send({ error: 'election_closed' });
    const people = await pool.query('SELECT id FROM electors WHERE election_id = $1 AND table_id IS NULL ORDER BY search', [election]);
    const already = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM polling_tables WHERE election_id = $1', [election]);
    const needed = Math.ceil(people.rows.length / size);
    for (let i = 0; i < needed; i += 1) {
      const id = randomUUID();
      const position = already.rows[0]!.n + i;
      await pool.query('INSERT INTO polling_tables (id, election_id, name, position) VALUES ($1, $2, $3, $4)', [id, election, `Mesa ${position + 1}`, position]);
      const part = people.rows.slice(i * size, (i + 1) * size).map((row) => row.id);
      await pool.query('UPDATE electors x SET table_id = $3, order_number = o.n FROM unnest($2::text[]) WITH ORDINALITY AS o(id, n) WHERE x.election_id = $1 AND x.id = o.id', [election, part, id]);
    }
    await audit(pool, request.actor, 'tables.proposed', election, { tables: needed });
    return { created: needed };
  });

  app.put<{ Params: { table: string }; Body: { name?: unknown; place?: unknown; unit?: unknown; fiscal?: unknown } }>('/api/tables/:table', { preHandler: manageElection }, async (request) => {
    const { place, unit, fiscal } = request.body ?? {};
    const name = text(request.body?.name, 80);
    await pool.query('UPDATE polling_tables SET name = COALESCE($2, name), place = COALESCE($3, place), unit_id = COALESCE($4, unit_id) WHERE id = $1', [request.params.table, name, typeof place === 'string' ? place : null, typeof unit === 'string' ? unit : null]);
    if (name || typeof place === 'string' || typeof unit === 'string') await audit(pool, request.actor, 'table.changed', request.params.table, { name: Boolean(name), place: typeof place === 'string', unit: typeof unit === 'string' ? unit : undefined });
    if (typeof fiscal === 'string') {
      await pool.query(`DELETE FROM role_assignments WHERE table_id = $1 AND role = 'fiscal'`, [request.params.table]);
      await pool.query(`INSERT INTO role_assignments (id, user_id, role, table_id) VALUES ($1, $2, 'fiscal', $3)`, [randomUUID(), fiscal, request.params.table]);
      forgetActors();
      await audit(pool, request.actor, 'fiscal.assigned', request.params.table, { user: fiscal });
    }
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/elections/:id/units', { preHandler: manageElection }, async (request) => {
    const rows = await pool.query(
      `SELECT n.id, n.name,
              (SELECT u.name FROM role_assignments a JOIN users u ON u.id = a.user_id WHERE a.unit_id = n.id AND a.role = 'jefe' AND u.removed_at IS NULL LIMIT 1) AS chief,
              (SELECT count(*)::int FROM polling_tables t WHERE t.unit_id = n.id) AS tables
       FROM units n WHERE n.election_id = $1 ORDER BY n.name`,
      [request.params.id],
    );
    return { units: rows.rows };
  });

  app.post<{ Params: { id: string }; Body: { name?: unknown } }>('/api/elections/:id/units', { preHandler: manageElection }, async (request, reply) => {
    const name = text(request.body?.name, 120);
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    const id = randomUUID();
    await pool.query('INSERT INTO units (id, election_id, name) VALUES ($1, $2, $3)', [id, request.params.id, name]);
    await audit(pool, request.actor, 'unit.created', id, { election: request.params.id });
    return { id };
  });

  /** One invitation for each poll watcher of the election who has not joined yet. */
  app.post<{ Params: { id: string } }>('/api/elections/:id/invitations', { preHandler: requires(pool, 'team.invite') }, async (request) => {
    const pending = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.phone, t.name AS table_name FROM role_assignments a
       JOIN polling_tables t ON t.id = a.table_id JOIN users u ON u.id = a.user_id
       WHERE t.election_id = $1 AND a.role = 'fiscal' AND u.removed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL)`,
      [request.params.id],
    );
    const invitations = [];
    for (const row of pending.rows) invitations.push({ name: row.name, phone: row.phone, table: row.table_name, invitation: await createInvitation(pool, row.id) });
    await audit(pool, request.actor, 'invitations.created', request.params.id, { people: invitations.length });
    return { invitations };
  });
}
