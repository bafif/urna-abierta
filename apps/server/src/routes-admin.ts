import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { BUILT_IN_THEMES, DEFAULT_TIME_ZONE, foldText, MAX_PARTY_THEMES, THEME_ID, isRole, isSecurityProfile, isTimeZone, storedPhone, MAX_ROLL_BYTES, PERMISSIONS, PERMISSIONS_KEPT, readCsvRoll, readPadron, ROLES, SECURITY_PROFILES, stricterProfile, themeProblems, type PadronElector, type PadronRead, type Permission, type Role, type RoleOverrides } from '@urna-abierta/domain';
import { audit, auditView, authenticated, can, erasedId, FISCAL_READY, forgetActors, getSetting, inTransaction, mayInvite, requires, rollKey, securityProfile, setSetting, tablesInScope, type Actor } from './actor.ts';
import { forgetStatuses } from './routes-sync.ts';
import { addTheme, createInvitation, MAX_THEME_BYTES, themeFits } from './routes-auth.ts';

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
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** «08:00» to «18:00» by day, or null when it is not that. */
function hoursOf(value: unknown): Record<string, { open: string; close: string }> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  const valid = entries.every(([day, times]) => DAY.test(day) && times && typeof times === 'object'
    && TIME.test((times as { open?: string }).open ?? '') && TIME.test((times as { close?: string }).close ?? '') && (times as { open: string }).open < (times as { close: string }).close);
  return valid ? Object.fromEntries(entries.map(([day, times]) => [day, { open: (times as { open: string }).open, close: (times as { close: string }).close }])) : null;
}

/** A poll watcher's own times; an empty one clears them. Null when something in it is not a time or a short text. */
function scheduleOf(value: unknown): { from?: string; to?: string; arrive?: string; meet?: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { from, to, arrive, meet } = value as Record<string, unknown>;
  const time = (item: unknown) => item === undefined || item === '' || (typeof item === 'string' && TIME.test(item));
  if (![from, to, arrive].every(time) || (meet !== undefined && (typeof meet !== 'string' || meet.length > 120))) return null;
  if (typeof from === 'string' && typeof to === 'string' && from && to && from >= to) return null;
  return Object.fromEntries(Object.entries({ from, to, arrive, meet: typeof meet === 'string' ? meet.trim() : meet }).filter(([, item]) => typeof item === 'string' && item !== ''));
}

const text = (value: unknown, max = 200) => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The categories of an election and their lists, as counts and results read them. Null when something in it is not that. */
function categoriesOf(value: unknown): { id: string; name: string; lists: { id: string; name: string }[] }[] | null {
  const named = (item: unknown): item is { id: string; name: string } => {
    const { id, name } = (item ?? {}) as Record<string, unknown>;
    return typeof id === 'string' && /^[\w-]{1,64}$/.test(id) && typeof name === 'string' && name.trim().length > 0 && name.length <= 120;
  };
  const unique = (items: { id: string }[]) => new Set(items.map((item) => item.id)).size === items.length;
  if (!Array.isArray(value) || value.length > 30 || !value.every(named) || !unique(value)) return null;
  const valid = value.every((category) => {
    const { lists } = category as { lists?: unknown };
    return Array.isArray(lists) && lists.length <= 100 && lists.every(named) && unique(lists);
  });
  if (!valid) return null;
  return value.map((category) => ({
    id: category.id,
    name: category.name.trim(),
    lists: (category as unknown as { lists: { id: string; name: string }[] }).lists.map((list) => ({ id: list.id, name: list.name.trim() })),
  }));
}

/** A day that exists: «2027-02-31» has the shape of one, and would stop the whole request in Postgres. */
const realDay = (day: unknown): day is string => typeof day === 'string' && DAY.test(day) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);

/** The days of a shift: none means all of them. Null when something in it is not a day. */
function shiftOf(value: unknown): string[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 60 || !value.every(realDay)) return null;
  return [...new Set(value)].sort();
}

/**
 * Where a task goes, as asked: a table or a district that exists, of an election not closed yet. Checked before
 * anything is written, so that a wrong id is a wrong request, and not someone left half created.
 */
async function placeOf(pool: pg.Pool, table: unknown, unit: unknown): Promise<{ table: string | null; unit: string | null } | 'invalid' | 'closed'> {
  const given = (value: unknown) => value !== undefined && value !== null;
  if ((given(table) && typeof table !== 'string') || (given(unit) && typeof unit !== 'string') || (given(table) && given(unit))) return 'invalid';
  const found = typeof table === 'string'
    ? await pool.query('SELECT e.status FROM polling_tables t JOIN elections e ON e.id = t.election_id WHERE t.id = $1', [table])
    : typeof unit === 'string'
      ? await pool.query('SELECT e.status FROM units n JOIN elections e ON e.id = n.election_id WHERE n.id = $1', [unit])
      : null;
  if (found && !found.rows[0]) return 'invalid';
  if (found && ['cerrada', 'purgada'].includes(found.rows[0].status)) return 'closed';
  return { table: typeof table === 'string' ? table : null, unit: typeof unit === 'string' ? unit : null };
}

/** A name or document someone corrected, from the review or from a person's request. Uploading the roll again does not undo it. */
export async function correctElector(pool: pg.Pool, actor: Actor, election: string, elector: string, body: { full_name?: unknown; document?: unknown } | undefined): Promise<'invalid_name' | 'not_found' | 'ok'> {
  const name = text(body?.full_name);
  if (!name) return 'invalid_name';
  const document = typeof body?.document === 'string' ? body.document.replace(/\D/g, '') || null : null;
  // A row loaded before what the file said was kept keyed still says it, until this correction: it is kept now, so
  // that the same file loaded again knows them, even by a position id. Only if nobody changed the row meanwhile.
  const before = await pool.query('SELECT search FROM electors WHERE election_id = $1 AND id = $2 AND erased_at IS NULL AND corrected_at IS NULL AND source_key IS NULL', [election, elector]);
  const search: string | null = before.rows[0]?.search || null;
  const corrected = await pool.query(
    `UPDATE electors SET full_name = $3, document = COALESCE($4, document), search = $5 || COALESCE(' ' || COALESCE($4, document), ''), needs_review = false, corrected_at = now(),
       source_key = COALESCE(source_key, CASE WHEN corrected_at IS NULL AND search = $6 THEN $7 END)
     WHERE election_id = $1 AND id = $2 AND erased_at IS NULL RETURNING ref`,
    [election, elector, name, document, foldText(name), search, search ? rollKey(search) : null],
  );
  if (!corrected.rows[0]) return 'not_found';
  await audit(pool, actor, 'elector.corrected', corrected.rows[0].ref);
  return 'ok';
}

const POSITION_ID = /^f-(\d+)$/;
const documentOf = (e: PadronElector) => e.identifiers?.find((x) => x.type.toUpperCase() !== 'LEGAJO')?.value ?? null;
const searchOf = (e: PadronElector) => foldText(`${e.full_name} ${documentOf(e) ?? ''}`);

interface LoadedElector {
  id: string;
  corrected: boolean;
  erased: boolean;
  source_key: string | null;
  search: string;
}

/**
 * Who in a new file is who in the roll already loaded. Most ids say it by themselves: d-<DNI>, l-<legajo>, a scanner's.
 * A position id, f-<row>, does not: one row added at the top moves everyone below it. Those people are matched by what
 * the file said about them, kept keyed in source_key, so that an erasure or a correction stays with its person and
 * someone new never takes the id of someone already loaded. Rows loaded before that key was kept, and erased or
 * corrected without it, have only their id left: a row of the file that matches nobody else by what it says, and has
 * that id, is them.
 */
function matchRoll(incoming: PadronElector[], loaded: LoadedElector[]): { electors: PadronElector[]; erased: number } {
  const erasedIds = new Set(loaded.filter((row) => row.erased).map((row) => row.id));
  const erasedKeys = new Map<string, number>();
  const sameKey = new Map<string, string[]>();
  const erasedUnkeyed = new Set<string>();
  const correctedUnkeyed = new Set<string>();
  for (const row of loaded) {
    if (row.erased) {
      if (row.source_key) erasedKeys.set(row.source_key, (erasedKeys.get(row.source_key) ?? 0) + 1);
      else erasedUnkeyed.add(row.id);
    } else if (POSITION_ID.test(row.id)) {
      // Loaded before the key was kept: what the row says is what the file said, unless someone corrected it.
      const key = row.source_key ?? (row.corrected ? null : rollKey(row.search));
      if (key) sameKey.set(key, [...(sameKey.get(key) ?? []), row.id]);
      else correctedUnkeyed.add(row.id);
    }
  }
  const taken = new Set(loaded.map((row) => row.id));
  let next = [...taken, ...incoming.map((e) => e.id)].reduce((most, id) => Math.max(most, Number(POSITION_ID.exec(id)?.[1] ?? 0)), 0) + 1;
  let erased = 0;
  const electors: PadronElector[] = [];
  for (const elector of incoming) {
    if (!POSITION_ID.test(elector.id)) {
      if (erasedIds.size > 0 && erasedIds.has(erasedId(elector.id))) erased += 1;
      else electors.push(elector);
      continue;
    }
    const key = rollKey(searchOf(elector));
    const left = erasedKeys.get(key) ?? 0;
    if (left > 0) {
      erasedKeys.set(key, left - 1);
      erased += 1;
      continue;
    }
    const same = sameKey.get(key) ?? [];
    if (same.length === 0 && erasedUnkeyed.size > 0 && erasedUnkeyed.delete(erasedId(elector.id))) {
      erased += 1;
      continue;
    }
    const own = same.length === 0 && correctedUnkeyed.delete(elector.id);
    const id = own || same.includes(elector.id) ? elector.id : (same[0] ?? (taken.has(elector.id) ? `f-${next++}` : elector.id));
    sameKey.set(key, same.filter((other) => other !== id));
    electors.push(id === elector.id ? elector : { ...elector, id });
  }
  return { electors, erased };
}

/** Once an election closes, its roll and its tables stay as they are: what remains is reviewing it and purging it. */
export async function closedElection(pool: pg.Pool, election: string): Promise<boolean | null> {
  const found = await pool.query('SELECT status FROM elections WHERE id = $1', [election]);
  return found.rows[0] ? ['cerrada', 'purgada'].includes(found.rows[0].status) : null;
}

/** The election of a table, if it is still being prepared: tables are only corrected then. */
async function preparingTable(pool: pg.Pool, table: string): Promise<{ election: string; position: number } | null> {
  const found = await pool.query(`SELECT t.election_id, t.position FROM polling_tables t JOIN elections e ON e.id = t.election_id WHERE t.id = $1 AND e.status = 'preparacion'`, [table]);
  return found.rows[0] ? { election: found.rows[0].election_id, position: found.rows[0].position } : null;
}

/** Numbers each table's people again, in the order of their surnames. */
async function renumber(client: pg.Pool | pg.PoolClient, election: string, tables: string[]): Promise<void> {
  await client.query(
    `UPDATE electors x SET order_number = o.n FROM (
       SELECT id, row_number() OVER (PARTITION BY table_id ORDER BY search, id) AS n FROM electors WHERE election_id = $1 AND table_id = ANY($2)
     ) o WHERE x.election_id = $1 AND x.id = o.id`,
    [election, tables],
  );
}

export function adminRoutes(app: FastifyInstance, pool: pg.Pool) {
  const manageElection = requires(pool, 'election.manage');
  const manageUsers = requires(pool, 'users.manage');

  // ---------- The party ----------
  app.put<{ Body: { name?: unknown; theme?: unknown } }>('/api/party', { preHandler: manageElection }, async (request, reply) => {
    const name = text(request.body?.name, 120);
    const theme = text(request.body?.theme, 40) ?? 'aula';
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    // Only a theme every phone can find: one that comes with the app, or one the party added.
    const added = await getSetting<{ id: string }[]>(pool, 'themes', []);
    if (!THEME_ID.test(theme) || !(BUILT_IN_THEMES.includes(theme) || added.some((other) => other.id === theme))) return reply.code(400).send({ error: 'unknown_theme' });
    await setSetting(pool, 'party', { name, theme });
    await audit(pool, request.actor, 'party.changed');
    return { name, theme };
  });

  /** Themes a party adds. Each has to pass the same reading check as the ones that come with the app. */
  app.put<{ Body: { theme?: unknown } }>('/api/themes', { onRequest: manageElection, bodyLimit: MAX_THEME_BYTES }, async (request, reply) => {
    const { theme } = request.body ?? {};
    const problems = themeProblems(theme);
    if (problems.length > 0) return reply.code(422).send({ error: 'theme_not_usable', problems });
    if (!(await themeFits(pool, (theme as { id: string }).id))) return reply.code(409).send({ error: 'too_many_themes', max: MAX_PARTY_THEMES });
    await addTheme(pool, theme as { id: string });
    await audit(pool, request.actor, 'theme.added', (theme as { id: string }).id);
    return { ok: true };
  });

  app.put<{ Body: { profile?: unknown } }>('/api/security', { preHandler: requires(pool, 'security.manage') }, async (request, reply) => {
    const { profile } = request.body ?? {};
    if (!isSecurityProfile(profile)) return reply.code(400).send({ error: 'invalid_profile' });
    // An open election holds the level its kind asks for, whoever wants to lower it. Keeping what the party had chosen lowers nothing.
    const { chosen, minimum } = await securityProfile(pool);
    if (profile !== chosen && stricterProfile(profile, minimum) !== profile) return reply.code(409).send({ error: 'election_needs_more', minimum });
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
              COALESCE(json_agg(json_build_object('id', a.id, 'role', a.role, 'table', a.table_id, 'tableName', t.name, 'unit', a.unit_id, 'unitName', un.name,
                'election', COALESCE(t.election_id, un.election_id, a.election_id), 'days', a.days, 'schedule', a.schedule) ORDER BY a.created_at) FILTER (WHERE a.id IS NOT NULL), '[]') AS roles,
              EXISTS (SELECT 1 FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL) AS joined,
              (SELECT min(d.created_at) FROM devices d WHERE d.user_id = u.id) AS joined_at
       FROM users u LEFT JOIN role_assignments a ON a.user_id = u.id LEFT JOIN polling_tables t ON t.id = a.table_id LEFT JOIN units un ON un.id = a.unit_id
       WHERE u.removed_at IS NULL GROUP BY u.id ORDER BY u.created_at`,
    );
    return { users: users.rows };
  });

  app.post<{ Body: { name?: unknown; phone?: unknown; role?: unknown; table?: unknown; unit?: unknown; expiresAt?: unknown; days?: unknown } }>('/api/users', { preHandler: manageUsers }, async (request, reply) => {
    const { role, phone, table, unit, expiresAt, days } = request.body ?? {};
    const name = text(request.body?.name, 120);
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    if (!isRole(role)) return reply.code(400).send({ error: 'invalid_role' });
    const place = await placeOf(pool, table, unit);
    if (place === 'invalid') return reply.code(400).send({ error: 'invalid_place' });
    if (place === 'closed') return reply.code(409).send({ error: 'election_closed' });
    const shift = shiftOf(days);
    if (shift === null) return reply.code(400).send({ error: 'invalid_days' });
    if (expiresAt !== undefined && (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt)))) return reply.code(400).send({ error: 'invalid_expiry' });
    // Whoever only looks at the numbers does not keep access for good.
    const expires = typeof expiresAt === 'string' ? new Date(expiresAt).toISOString() : role === 'estadistico' ? new Date(Date.now() + STATS_ROLE_DAYS * 86_400_000).toISOString() : null;
    const userId = randomUUID();
    await inTransaction(pool, async (client) => {
      await client.query('INSERT INTO users (id, name, phone) VALUES ($1, $2, $3)', [userId, name, storedPhone(phone)]);
      // A district has one chief: someone new takes the place of the one it had, who stays in the team.
      if (role === 'jefe' && place.unit) await client.query(`DELETE FROM role_assignments WHERE unit_id = $1 AND role = 'jefe'`, [place.unit]);
      await client.query('INSERT INTO role_assignments (id, user_id, role, table_id, unit_id, expires_at, days) VALUES ($1, $2, $3, $4, $5, $6, $7::date[])', [randomUUID(), userId, role, place.table, place.unit, expires, shift ?? null]);
    });
    if (role === 'jefe' && place.unit) forgetActors();
    await audit(pool, request.actor, 'user.created', userId, { role });
    return { id: userId, invitation: await createInvitation(pool, userId, request.actor) };
  });

  /**
   * Another task for someone already in the team, with the days of their shift if not all. A poll watcher still
   * without a table who gets one has it written on that task, instead of a second one.
   */
  app.post<{ Params: { id: string }; Body: { role?: unknown; table?: unknown; unit?: unknown; days?: unknown } }>('/api/users/:id/roles', { preHandler: manageUsers }, async (request, reply) => {
    const { role, table, unit, days } = request.body ?? {};
    if (!isRole(role)) return reply.code(400).send({ error: 'invalid_role' });
    const id = request.params.id;
    if (!UUID.test(id) || !(await pool.query('SELECT 1 FROM users WHERE id = $1 AND removed_at IS NULL', [id])).rowCount) return reply.code(404).send({ error: 'not_found' });
    const place = await placeOf(pool, table, unit);
    if (place === 'invalid') return reply.code(400).send({ error: 'invalid_place' });
    if (place === 'closed') return reply.code(409).send({ error: 'election_closed' });
    const shift = shiftOf(days);
    if (shift === null) return reply.code(400).send({ error: 'invalid_days' });
    const filled = role === 'fiscal' && place.table
      ? await pool.query(
        `UPDATE role_assignments SET table_id = $2, days = $3::date[]
         WHERE id = (SELECT id FROM role_assignments WHERE user_id = $1 AND role = 'fiscal' AND table_id IS NULL ORDER BY created_at LIMIT 1)`,
        [id, place.table, shift ?? null],
      )
      : null;
    if (!filled?.rowCount) await pool.query('INSERT INTO role_assignments (id, user_id, role, table_id, unit_id, days) VALUES ($1, $2, $3, $4, $5, $6::date[])', [randomUUID(), id, role, place.table, place.unit, shift ?? null]);
    forgetActors();
    await audit(pool, request.actor, filled?.rowCount ? 'role.changed' : 'role.added', id, { role, table: place.table ?? undefined, unit: place.unit ?? undefined });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/invitation', { preHandler: requires(pool, 'team.invite') }, async (request, reply) => {
    const allowed = await mayInvite(pool, request.actor, request.params.id);
    if (allowed === null) return reply.code(404).send({ error: 'not_found' });
    if (!allowed) return reply.code(403).send({ error: 'forbidden' });
    await audit(pool, request.actor, 'invitation.created', request.params.id);
    return { invitation: await createInvitation(pool, request.params.id, request.actor) };
  });

  /** Their name or their phone, as the team knows them. */
  app.put<{ Params: { id: string }; Body: { name?: unknown; phone?: unknown } }>('/api/users/:id', { preHandler: manageUsers }, async (request, reply) => {
    if (!UUID.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const name = text(request.body?.name, 120);
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    const changed = await pool.query('UPDATE users SET name = $2, phone = $3 WHERE id = $1 AND removed_at IS NULL', [request.params.id, name, storedPhone(request.body?.phone)]);
    if (!changed.rowCount) return reply.code(404).send({ error: 'not_found' });
    forgetActors();
    await audit(pool, request.actor, 'user.changed', request.params.id);
    return { ok: true };
  });

  /** Another table or district for one of their tasks. A phone that had the old table prepares the new one by itself. */
  app.put<{ Params: { id: string; assignment: string }; Body: { table?: unknown; unit?: unknown; schedule?: unknown } }>('/api/users/:id/roles/:assignment', { preHandler: manageUsers }, async (request, reply) => {
    const { table, unit } = request.body ?? {};
    if (request.body?.schedule !== undefined) {
      const schedule = scheduleOf(request.body.schedule);
      if (!schedule) return reply.code(400).send({ error: 'invalid_schedule' });
      const set = await pool.query('UPDATE role_assignments SET schedule = $3 WHERE id::text = $2 AND user_id::text = $1', [request.params.id, request.params.assignment, Object.keys(schedule).length ? JSON.stringify(schedule) : null]);
      if (!set.rowCount) return reply.code(404).send({ error: 'not_found' });
      forgetActors();
      await audit(pool, request.actor, 'role.scheduled', request.params.id);
      if (typeof table !== 'string' && typeof unit !== 'string') return { ok: true };
    }
    if (typeof table !== 'string' && typeof unit !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    const place = await placeOf(pool, table, unit);
    if (place === 'invalid') return reply.code(400).send({ error: 'invalid_place' });
    if (place === 'closed') return reply.code(409).send({ error: 'election_closed' });
    const changed = await pool.query(
      `UPDATE role_assignments SET table_id = COALESCE($3, table_id), unit_id = COALESCE($4, unit_id) WHERE id::text = $2 AND user_id::text = $1`,
      [request.params.id, request.params.assignment, place.table, place.unit],
    );
    if (!changed.rowCount) return reply.code(404).send({ error: 'not_found' });
    forgetActors();
    await audit(pool, request.actor, 'role.changed', request.params.id, { table: typeof table === 'string' ? table : undefined, unit: typeof unit === 'string' ? unit : undefined });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; assignment: string } }>('/api/users/:id/roles/:assignment', { preHandler: manageUsers }, async (request, reply) => {
    const removed = await pool.query('DELETE FROM role_assignments WHERE id::text = $2 AND user_id::text = $1 RETURNING role', [request.params.id, request.params.assignment]);
    if (!removed.rowCount) return reply.code(404).send({ error: 'not_found' });
    forgetActors();
    await audit(pool, request.actor, 'role.removed', request.params.id, { role: removed.rows[0].role });
    return { ok: true };
  });

  /** A lost phone stops working the next time it connects, and the person stays in the team, with a new invitation if this one may give it. */
  app.post<{ Params: { id: string } }>('/api/users/:id/lost-phone', { preHandler: manageUsers }, async (request, reply) => {
    const found = await pool.query('SELECT 1 FROM users WHERE id::text = $1 AND removed_at IS NULL', [request.params.id]);
    if (!found.rowCount) return reply.code(404).send({ error: 'not_found' });
    await pool.query('UPDATE devices SET revoked_at = now() WHERE user_id::text = $1 AND revoked_at IS NULL', [request.params.id]);
    // A link or code not used yet would get whoever has the phone in again.
    await pool.query('UPDATE invitations SET used_at = now() WHERE user_id::text = $1 AND used_at IS NULL', [request.params.id]);
    forgetActors();
    await audit(pool, request.actor, 'user.phone_lost', request.params.id);
    const invite = can(request.actor, 'team.invite') && (await mayInvite(pool, request.actor, request.params.id));
    return invite ? { invitation: await createInvitation(pool, request.params.id, request.actor) } : {};
  });

  /** Takes someone out: their phones stop working the next time they connect. */
  app.delete<{ Params: { id: string } }>('/api/users/:id', { preHandler: manageUsers }, async (request, reply) => {
    if (!UUID.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    await pool.query('UPDATE users SET removed_at = now() WHERE id = $1', [request.params.id]);
    await pool.query('UPDATE invitations SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [request.params.id]);
    await pool.query('UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [request.params.id]);
    await pool.query('DELETE FROM role_assignments WHERE user_id = $1', [request.params.id]);
    forgetActors();
    await audit(pool, request.actor, 'user.removed', request.params.id);
    return { ok: true };
  });

  // ---------- Elections ----------
  app.get('/api/elections', { preHandler: manageElection }, async () => {
    const rows = await pool.query(
      `SELECT e.id, e.name, e.kind, e.days, e.status, e.categories, e.hours, to_char(e.purge_by, 'YYYY-MM-DD') AS purge_by,
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

  app.post<{ Body: { name?: unknown; kind?: unknown; days?: unknown; categories?: unknown; timeZone?: unknown; purgeBy?: unknown } }>('/api/elections', { preHandler: manageElection }, async (request, reply) => {
    const { kind, days, categories, timeZone, purgeBy } = request.body ?? {};
    const name = text(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    if (typeof kind !== 'string' || !KINDS.includes(kind)) return reply.code(400).send({ error: 'invalid_kind' });
    if (!Array.isArray(days) || days.length === 0) return reply.code(400).send({ error: 'no_days' });
    if (days.length > 60 || !days.every(realDay)) return reply.code(400).send({ error: 'invalid_days' });
    const dates = [...new Set(days)].sort();
    const lists = categoriesOf(categories ?? []);
    if (!lists) return reply.code(400).send({ error: 'invalid_categories' });
    // Postgres has to know it too: the panel works out the day there, and a zone it lacks would break it for the whole election.
    const zoneKnown = async (zone: string) => (await pool.query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [zone])).rowCount !== 0;
    if (timeZone !== undefined && !(isTimeZone(timeZone) && (await zoneKnown(timeZone)))) return reply.code(400).send({ error: 'invalid_time_zone' });
    if (purgeBy !== undefined && (!realDay(purgeBy) || purgeBy < dates.at(-1)!)) return reply.code(400).send({ error: 'invalid_purge_by' });
    const id = randomUUID();
    await pool.query('INSERT INTO elections (id, name, kind, days, categories, time_zone) VALUES ($1, $2, $3, $4::date[], $5, $6)', [id, name, kind, dates, JSON.stringify(lists), timeZone ?? DEFAULT_TIME_ZONE]);
    if (typeof purgeBy === 'string') await pool.query('UPDATE elections SET purge_by = $2 WHERE id = $1', [id, purgeBy]);
    await audit(pool, request.actor, 'election.created', id);
    return { id };
  });

  /**
   * The lists change only while it is prepared: after that, counts name them. The days, until it closes: a day that
   * gets suspended moves, and the screen asks first. The name, always.
   */
  app.put<{ Params: { id: string }; Body: { categories?: unknown; days?: unknown; name?: unknown; hours?: unknown; purgeBy?: unknown } }>('/api/elections/:id', { preHandler: manageElection }, async (request, reply) => {
    const { categories, days, name, hours, purgeBy } = request.body ?? {};
    const status = (await pool.query('SELECT status FROM elections WHERE id = $1', [request.params.id])).rows[0]?.status;
    if (!status) return reply.code(404).send({ error: 'not_found' });
    const closed = ['cerrada', 'purgada'].includes(status);
    if (categories !== undefined && status !== 'preparacion') return reply.code(409).send({ error: 'lists_locked' });
    const lists = categories === undefined ? null : categoriesOf(categories);
    if (categories !== undefined && !lists) return reply.code(400).send({ error: 'invalid_categories' });
    if (days !== undefined && closed) return reply.code(409).send({ error: 'days_locked' });
    if (days !== undefined && (!Array.isArray(days) || days.length === 0 || days.length > 60 || !days.every(realDay))) return reply.code(400).send({ error: 'invalid_days' });
    if (purgeBy !== undefined && !realDay(purgeBy)) return reply.code(400).send({ error: 'invalid_purge_by' });
    if (purgeBy !== undefined && status === 'purgada') return reply.code(409).send({ error: 'already_purged' });
    const valid = hours === undefined ? null : hoursOf(hours);
    if (hours !== undefined && !valid) return reply.code(400).send({ error: 'invalid_hours' });
    if (hours !== undefined && closed) return reply.code(409).send({ error: 'days_locked' });
    if (name !== undefined && !text(name)) return reply.code(400).send({ error: 'invalid_name' });
    await pool.query(
      `UPDATE elections SET categories = COALESCE($2, categories), days = COALESCE($3::date[], days), name = COALESCE($4, name),
         purge_by = COALESCE($5::date, purge_by), hours = COALESCE($6, hours) WHERE id = $1`,
      [request.params.id, lists ? JSON.stringify(lists) : null, Array.isArray(days) ? [...new Set(days)].sort() : null, text(name), purgeBy ?? null, valid ? JSON.stringify(valid) : null],
    );
    await audit(pool, request.actor, 'election.changed', request.params.id, { name: name !== undefined, days: days !== undefined, lists: categories !== undefined, hours: hours !== undefined, purgeBy: purgeBy !== undefined });
    forgetStatuses();
    return { ok: true };
  });

  /**
   * Only while it is prepared, and with its name written: its roll, its tables and who goes where go. The team stays,
   * and whoever had a table in it is told so on their phone for a week.
   */
  app.delete<{ Params: { id: string }; Body: { name?: unknown } }>('/api/elections/:id', { preHandler: manageElection }, async (request, reply) => {
    if (!UUID.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const found = (await pool.query('SELECT name, status FROM elections WHERE id = $1', [request.params.id])).rows[0];
    if (!found) return reply.code(404).send({ error: 'not_found' });
    if (found.status !== 'preparacion') return reply.code(409).send({ error: 'only_while_preparing' });
    if (request.body?.name !== found.name) return reply.code(400).send({ error: 'name_does_not_match' });
    await inTransaction(pool, async (client) => {
      await client.query(`DELETE FROM deleted_tables WHERE deleted_at < now() - interval '7 days'`);
      await client.query(
        `INSERT INTO deleted_tables (user_id, table_id, election)
         SELECT DISTINCT a.user_id, a.table_id, $2 FROM role_assignments a JOIN polling_tables t ON t.id = a.table_id
         WHERE t.election_id = $1 AND a.role = 'fiscal' ON CONFLICT DO NOTHING`,
        [request.params.id, found.name],
      );
      await client.query('DELETE FROM elections WHERE id = $1', [request.params.id]);
    });
    forgetActors();
    forgetStatuses();
    await audit(pool, request.actor, 'election.deleted', request.params.id, { name: found.name });
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
  app.post<{ Params: { id: string }; Querystring: { preview?: string }; Body: Buffer }>('/api/elections/:id/roll', { onRequest: manageElection, bodyLimit: MAX_ROLL_BYTES }, async (request, reply) => {
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
    const existing = await pool.query<LoadedElector>('SELECT id, corrected_at IS NOT NULL AS corrected, erased_at IS NOT NULL AS erased, source_key, search FROM electors WHERE election_id = $1', [election]);
    // Whoever asked to be erased is not loaded again, and what someone corrected stays corrected.
    const { electors, erased } = matchRoll(read.padron.electors, existing.rows);
    const known = new Set(existing.rows.filter((row) => !row.erased).map((row) => row.id));
    const corrected = new Set(existing.rows.filter((row) => row.corrected && !row.erased).map((row) => row.id));
    const incoming = new Set(electors.map((e) => e.id));
    const summary = {
      people: electors.length,
      added: electors.filter((e) => !known.has(e.id)).length,
      kept: electors.filter((e) => known.has(e.id)).length,
      missing: [...known].filter((id) => !incoming.has(id)).length,
      erased,
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
        await client.query(
          `INSERT INTO electors (election_id, id, table_id, order_number, full_name, search, document, file_number, address, extra, needs_review, review, source_key)
           SELECT $1, * FROM unnest($2::text[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::jsonb[], $11::boolean[], $12::jsonb[], $13::text[])
           ON CONFLICT (election_id, id) DO UPDATE SET source_key = EXCLUDED.source_key,
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
            value(searchOf),
            value(documentOf),
            value((e) => e.identifiers?.find((x) => x.type.toUpperCase() === 'LEGAJO')?.value ?? null),
            value((e) => e.address ?? null),
            value((e) => JSON.stringify(e.extra ?? {})),
            value((e) => e.review?.status === 'pending'),
            value((e) => (e.review ? JSON.stringify(e.review) : null)),
            value((e) => rollKey(searchOf(e))),
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
    // A row with the document of another one comes with it, to look at both side by side.
    const rows = await pool.query(
      `SELECT x.id, x.full_name, x.document, x.file_number, x.review, t.name AS table_name,
              (SELECT json_build_object('id', y.id, 'full_name', y.full_name, 'document', y.document, 'file_number', y.file_number, 'table_name', ty.name)
               FROM electors y LEFT JOIN polling_tables ty ON ty.id = y.table_id
               WHERE y.election_id = x.election_id AND y.id <> x.id AND y.document IS NOT NULL AND y.document = x.document AND y.erased_at IS NULL LIMIT 1) AS twin
       FROM electors x LEFT JOIN polling_tables t ON t.id = x.table_id
       WHERE x.election_id = $1 AND x.needs_review ORDER BY x.full_name LIMIT 200`,
      [request.params.id],
    );
    const total = (await pool.query('SELECT count(*)::int AS n FROM electors WHERE election_id = $1 AND needs_review', [request.params.id])).rows[0].n;
    const status = (await pool.query('SELECT status FROM elections WHERE id = $1', [request.params.id])).rows[0]?.status ?? null;
    await audit(pool, request.actor, 'roll.review_opened', request.params.id, { rows: rows.rowCount });
    return { rows: rows.rows, total, status };
  });

  /** A repeated row, or one that is not a person, leaves the roll: only while the election is prepared, and it is logged. */
  app.delete<{ Params: { id: string; elector: string } }>('/api/elections/:id/electors/:elector', { preHandler: manageElection }, async (request, reply) => {
    const status = (await pool.query('SELECT status FROM elections WHERE id = $1', [request.params.id])).rows[0]?.status;
    if (status !== 'preparacion') return reply.code(409).send({ error: 'only_while_preparing' });
    await pool.query('DELETE FROM semaphore_marks WHERE election_id = $1 AND elector_id = $2', [request.params.id, request.params.elector]);
    const removed = await pool.query('DELETE FROM electors WHERE election_id = $1 AND id = $2 RETURNING ref, table_id', [request.params.id, request.params.elector]);
    if (!removed.rowCount) return reply.code(404).send({ error: 'not_found' });
    if (removed.rows[0].table_id) await renumber(pool, request.params.id, [removed.rows[0].table_id]);
    await audit(pool, request.actor, 'elector.removed', removed.rows[0].ref);
    return { ok: true };
  });

  app.put<{ Params: { id: string; elector: string }; Body: { full_name?: unknown; document?: unknown } }>('/api/elections/:id/electors/:elector', { preHandler: manageElection }, async (request, reply) => {
    if (await closedElection(pool, request.params.id)) return reply.code(409).send({ error: 'election_closed' });
    const result = await correctElector(pool, request.actor, request.params.id, request.params.elector, request.body);
    if (result === 'invalid_name') return reply.code(400).send({ error: 'invalid_name' });
    if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ---------- Tables ----------
  app.get<{ Params: { id: string } }>('/api/elections/:id/tables', { preHandler: manageElection }, async (request) => {
    const rows = await pool.query(
      `SELECT t.id, t.name, t.place, t.unit_id, count(x.id)::int AS people,
              (SELECT min(x2.search) FROM electors x2 WHERE x2.table_id = t.id) AS first,
              (SELECT max(x2.search) FROM electors x2 WHERE x2.table_id = t.id) AS last,
              COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'days', a.days, 'assignment', a.id, ${FISCAL_READY}) ORDER BY a.created_at) FROM role_assignments a JOIN users u ON u.id = a.user_id
               WHERE a.table_id = t.id AND a.role = 'fiscal' AND u.removed_at IS NULL), '[]') AS fiscales
       FROM polling_tables t LEFT JOIN electors x ON x.table_id = t.id
       WHERE t.election_id = $1 GROUP BY t.id ORDER BY t.position`,
      [request.params.id],
    );
    return { tables: rows.rows.map(({ first, last, ...row }) => ({ ...row, from: first?.slice(0, 1).toUpperCase() ?? '', to: last?.slice(0, 1).toUpperCase() ?? '' })) };
  });

  /** Who is at a table, to move one of them alone. */
  app.get<{ Params: { table: string } }>('/api/tables/:table/people', { preHandler: manageElection }, async (request) => {
    const rows = await pool.query('SELECT id, full_name AS name, order_number AS "order" FROM electors WHERE table_id = $1 ORDER BY order_number, search', [request.params.table]);
    await auditView(pool, request.actor, 'table.people.viewed', request.params.table);
    return { people: rows.rows };
  });

  /**
   * Where a table ends, by surname, against the next one: whoever is up to that surname stays here, the rest goes there.
   * With ?preview=1 it only says how many would be in each.
   */
  app.post<{ Params: { table: string }; Querystring: { preview?: string }; Body: { last?: unknown } }>('/api/tables/:table/cut', { preHandler: manageElection }, async (request, reply) => {
    const last = text(request.body?.last, 120);
    if (!last) return reply.code(400).send({ error: 'invalid_surname' });
    const here = await preparingTable(pool, request.params.table);
    if (!here) return reply.code(409).send({ error: 'only_while_preparing' });
    const next = (await pool.query('SELECT id FROM polling_tables WHERE election_id = $1 AND position > $2 ORDER BY position LIMIT 1', [here.election, here.position])).rows[0]?.id;
    if (!next) return reply.code(409).send({ error: 'no_next_table' });
    const key = foldText(last);
    const people = await pool.query<{ id: string; search: string }>('SELECT id, search FROM electors WHERE election_id = $1 AND table_id = ANY($2)', [here.election, [request.params.table, next]]);
    const stays = people.rows.filter((person) => person.search < key || person.search.startsWith(key)).map((person) => person.id);
    const counts = { here: stays.length, next: people.rows.length - stays.length };
    if (request.query.preview === '1') return counts;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE electors SET table_id = CASE WHEN id = ANY($3) THEN $2 ELSE $4 END WHERE election_id = $1 AND table_id = ANY(ARRAY[$2, $4])', [here.election, request.params.table, stays, next]);
      await renumber(client, here.election, [request.params.table, next]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await audit(pool, request.actor, 'tables.cut', request.params.table, counts);
    return counts;
  });

  /** One person alone to another table, for rolls that do not go by surname. */
  app.put<{ Params: { table: string; elector: string }; Body: { to?: unknown } }>('/api/tables/:table/people/:elector', { preHandler: manageElection }, async (request, reply) => {
    const { to } = request.body ?? {};
    const here = await preparingTable(pool, request.params.table);
    if (!here) return reply.code(409).send({ error: 'only_while_preparing' });
    if (typeof to !== 'string' || !(await pool.query('SELECT 1 FROM polling_tables WHERE id = $1 AND election_id = $2', [to, here.election])).rowCount) return reply.code(400).send({ error: 'invalid_table' });
    const moved = await pool.query(
      'UPDATE electors SET table_id = $4, order_number = (SELECT COALESCE(max(order_number), 0) + 1 FROM electors WHERE table_id = $4) WHERE election_id = $1 AND id = $2 AND table_id = $3',
      [here.election, request.params.elector, request.params.table, to],
    );
    if (!moved.rowCount) return reply.code(404).send({ error: 'not_found' });
    await renumber(pool, here.election, [request.params.table]);
    await audit(pool, request.actor, 'elector.moved', request.params.table, { to });
    return { ok: true };
  });

  /** Only an empty table, while it is prepared. */
  app.delete<{ Params: { table: string } }>('/api/tables/:table', { preHandler: manageElection }, async (request, reply) => {
    const here = await preparingTable(pool, request.params.table);
    if (!here) return reply.code(409).send({ error: 'only_while_preparing' });
    const removed = await pool.query('DELETE FROM polling_tables t WHERE t.id = $1 AND NOT EXISTS (SELECT 1 FROM electors x WHERE x.table_id = t.id)', [request.params.table]);
    if (!removed.rowCount) return reply.code(409).send({ error: 'not_empty' });
    await audit(pool, request.actor, 'table.deleted', request.params.table);
    return { ok: true };
  });

  /** Starts the tables over: they go, and so does who goes to each one. Only while it is prepared. */
  app.post<{ Params: { id: string } }>('/api/elections/:id/tables/reset', { preHandler: manageElection }, async (request, reply) => {
    const status = (await pool.query('SELECT status FROM elections WHERE id = $1', [request.params.id])).rows[0]?.status;
    if (status !== 'preparacion') return reply.code(409).send({ error: 'only_while_preparing' });
    await pool.query('UPDATE electors SET table_id = NULL, order_number = NULL WHERE election_id = $1', [request.params.id]);
    const removed = await pool.query('DELETE FROM polling_tables WHERE election_id = $1', [request.params.id]);
    forgetActors();
    await audit(pool, request.actor, 'tables.reset', request.params.id, { tables: removed.rowCount });
    return { ok: true };
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

  /** Its name, its place, its district (null takes it out of the one it had) or its only poll watcher, until it closes. */
  app.put<{ Params: { table: string }; Body: { name?: unknown; place?: unknown; unit?: unknown; fiscal?: unknown } }>('/api/tables/:table', { preHandler: manageElection }, async (request, reply) => {
    const { place, unit, fiscal } = request.body ?? {};
    const election = (await pool.query('SELECT election_id FROM polling_tables WHERE id = $1', [request.params.table])).rows[0]?.election_id;
    if (!election) return reply.code(404).send({ error: 'not_found' });
    if (await closedElection(pool, election)) return reply.code(409).send({ error: 'election_closed' });
    if (place !== undefined && (typeof place !== 'string' || place.length > 200)) return reply.code(400).send({ error: 'invalid_place' });
    if (unit !== undefined && unit !== null && (typeof unit !== 'string' || !(await pool.query('SELECT 1 FROM units WHERE id = $1 AND election_id = $2', [unit, election])).rowCount)) return reply.code(400).send({ error: 'invalid_unit' });
    if (fiscal !== undefined && (typeof fiscal !== 'string' || !UUID.test(fiscal) || !(await pool.query('SELECT 1 FROM users WHERE id = $1 AND removed_at IS NULL', [fiscal])).rowCount)) return reply.code(400).send({ error: 'invalid_user' });
    const name = text(request.body?.name, 80);
    await pool.query(
      'UPDATE polling_tables SET name = COALESCE($2, name), place = COALESCE($3, place), unit_id = CASE WHEN $5 THEN $4 ELSE unit_id END WHERE id = $1',
      [request.params.table, name, typeof place === 'string' ? place.trim() : null, typeof unit === 'string' ? unit : null, unit !== undefined],
    );
    if (unit !== undefined) forgetActors();
    if (name || typeof place === 'string' || unit !== undefined) await audit(pool, request.actor, 'table.changed', request.params.table, { name: Boolean(name), place: typeof place === 'string', unit: unit === undefined ? undefined : unit });
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
      `SELECT n.id, n.name, c.id AS chief_id, c.name AS chief,
              (SELECT count(*)::int FROM polling_tables t WHERE t.unit_id = n.id) AS tables
       FROM units n LEFT JOIN LATERAL (
         SELECT u.id, u.name FROM role_assignments a JOIN users u ON u.id = a.user_id
         WHERE a.unit_id = n.id AND a.role = 'jefe' AND u.removed_at IS NULL ORDER BY a.created_at LIMIT 1
       ) c ON true
       WHERE n.election_id = $1 ORDER BY n.name`,
      [request.params.id],
    );
    const status = (await pool.query('SELECT status FROM elections WHERE id::text = $1', [request.params.id])).rows[0]?.status ?? null;
    return { units: rows.rows, status };
  });

  /**
   * A district's name, or its chief: the one it had stops being its chief, and stays in the team. Until the election
   * closes, since a chief who cannot go is replaced on the day too.
   */
  app.put<{ Params: { unit: string }; Body: { name?: unknown; chief?: unknown } }>('/api/units/:unit', { preHandler: manageElection }, async (request, reply) => {
    const { chief } = request.body ?? {};
    const name = request.body?.name === undefined ? null : text(request.body.name, 120);
    if (request.body?.name !== undefined && !name) return reply.code(400).send({ error: 'invalid_name' });
    if (chief !== undefined && (typeof chief !== 'string' || !UUID.test(chief) || !(await pool.query('SELECT 1 FROM users WHERE id = $1 AND removed_at IS NULL', [chief])).rowCount)) return reply.code(400).send({ error: 'invalid_user' });
    const election = (await pool.query('SELECT election_id FROM units WHERE id = $1', [request.params.unit])).rows[0]?.election_id;
    if (!election) return reply.code(404).send({ error: 'not_found' });
    if (await closedElection(pool, election)) return reply.code(409).send({ error: 'election_closed' });
    const before = await inTransaction(pool, async (client) => {
      if (name) await client.query('UPDATE units SET name = $2 WHERE id = $1', [request.params.unit, name]);
      if (typeof chief !== 'string') return [];
      const removed = await client.query(`DELETE FROM role_assignments WHERE unit_id = $1 AND role = 'jefe' AND user_id <> $2 RETURNING user_id`, [request.params.unit, chief]);
      await client.query(
        `INSERT INTO role_assignments (id, user_id, role, unit_id) SELECT $1, $2, 'jefe', $3
         WHERE NOT EXISTS (SELECT 1 FROM role_assignments WHERE unit_id = $3 AND role = 'jefe' AND user_id = $2)`,
        [randomUUID(), chief, request.params.unit],
      );
      return removed.rows.map((row) => row.user_id as string);
    });
    if (typeof chief === 'string') forgetActors();
    await audit(pool, request.actor, 'unit.changed', request.params.unit, { name: Boolean(name), chief: typeof chief === 'string' ? chief : undefined, before: before.length ? before : undefined });
    return { ok: true };
  });

  /** Only while the election is prepared: its tables stay, with no district, and its chief stays in the team without that task. */
  app.delete<{ Params: { unit: string } }>('/api/units/:unit', { preHandler: manageElection }, async (request, reply) => {
    const found = (await pool.query('SELECT n.name, e.status FROM units n JOIN elections e ON e.id = n.election_id WHERE n.id = $1', [request.params.unit])).rows[0];
    if (!found) return reply.code(404).send({ error: 'not_found' });
    if (found.status !== 'preparacion') return reply.code(409).send({ error: 'only_while_preparing' });
    await pool.query('DELETE FROM units WHERE id = $1', [request.params.unit]);
    forgetActors();
    await audit(pool, request.actor, 'unit.deleted', request.params.unit, { name: found.name });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { name?: unknown } }>('/api/elections/:id/units', { preHandler: manageElection }, async (request, reply) => {
    const name = text(request.body?.name, 120);
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    const closed = await closedElection(pool, request.params.id);
    if (closed === null) return reply.code(404).send({ error: 'not_found' });
    if (closed) return reply.code(409).send({ error: 'election_closed' });
    const id = randomUUID();
    await pool.query('INSERT INTO units (id, election_id, name) VALUES ($1, $2, $3)', [id, request.params.id, name]);
    await audit(pool, request.actor, 'unit.created', id, { election: request.params.id });
    return { id };
  });

  /** One invitation for each poll watcher who has not joined yet, of the tables this person looks after. */
  app.post<{ Params: { id: string } }>('/api/elections/:id/invitations', { preHandler: requires(pool, 'team.invite') }, async (request) => {
    const scope = await tablesInScope(pool, request.actor, request.params.id);
    const pending = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.phone, t.name AS table_name FROM role_assignments a
       JOIN polling_tables t ON t.id = a.table_id JOIN users u ON u.id = a.user_id
       WHERE t.election_id = $1 AND t.id = ANY($2) AND a.role = 'fiscal' AND u.removed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL)`,
      [request.params.id, scope],
    );
    const invitations = [];
    for (const row of pending.rows) {
      // A poll watcher who also does more, or works a table this person does not reach, is someone else's to invite.
      if (!(await mayInvite(pool, request.actor, row.id))) continue;
      invitations.push({ name: row.name, phone: row.phone, table: row.table_name, invitation: await createInvitation(pool, row.id, request.actor) });
    }
    await audit(pool, request.actor, 'invitations.created', request.params.id, { people: invitations.length });
    return { invitations };
  });
}
