import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { isRole, isSecurityProfile, permissionsOf, SECURITY_PROFILES, stricterProfile, type Permission, type Role, type RoleOverrides, type SecurityProfile } from '@urna-abierta/domain';

export interface Assignment {
  role: Role;
  election_id: string | null;
  unit_id: string | null;
  table_id: string | null;
  days: Date[] | null;
}

export interface Actor {
  userId: string;
  deviceId: string;
  name: string;
  roles: Role[];
  permissions: Permission[];
  assignments: Assignment[];
  /** This device already proved the second step. */
  verified: boolean;
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Who each credential belongs to, remembered for a moment: phones ask all day, and a small server
 * should not read the same rows each time. There is one process, so whatever changes people, roles
 * or devices clears it right away. The limit only covers roles that expire by themselves.
 */
const ACTOR_MEMORY_MS = 30_000;
const actors = new Map<string, { until: number; actor: Actor }>();
let edited: RoleOverrides | null = null;
export const forgetActors = () => {
  actors.clear();
  edited = null;
};

export async function loadActor(pool: pg.Pool, token: string): Promise<Actor | null> {
  const key = hashToken(token);
  const known = actors.get(key);
  if (known && known.until > Date.now()) return known.actor;
  const found = await pool.query(
    `SELECT d.id AS device_id, d.second_factor_at, u.id AS user_id, u.name
     FROM devices d JOIN users u ON u.id = d.user_id
     WHERE d.token_hash = $1 AND d.revoked_at IS NULL AND u.removed_at IS NULL`,
    [hashToken(token)],
  );
  const row = found.rows[0];
  if (!row) return null;
  const roles = await pool.query(
    `SELECT role, election_id, unit_id, table_id, days FROM role_assignments
     WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [row.user_id],
  );
  const assignments = roles.rows.filter((r) => isRole(r.role)) as Assignment[];
  const unique = [...new Set(assignments.map((a) => a.role))];
  edited ??= await getSetting<RoleOverrides>(pool, 'role_permissions', {});
  const permissions = permissionsOf(unique, edited);
  const actor: Actor = { userId: row.user_id, deviceId: row.device_id, name: row.name, verified: row.second_factor_at !== null, assignments, roles: unique, permissions };
  if (actors.size > 5_000) actors.clear();
  actors.set(key, { until: Date.now() + ACTOR_MEMORY_MS, actor });
  return actor;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}

export interface ProfileInForce {
  /** What applies now. */
  profile: SecurityProfile;
  /** What the party chose. */
  chosen: SecurityProfile;
  /** The least an open election asks for, by its kind. */
  minimum: SecurityProfile | null;
}

/** The profile in force: the one the party chose, or the one an open election asks for when it is stricter. */
export async function securityProfile(pool: pg.Pool): Promise<ProfileInForce> {
  const found = await pool.query(
    `SELECT (SELECT value FROM settings WHERE key = 'security_profile') AS chosen,
            ARRAY(SELECT DISTINCT kind FROM elections WHERE status NOT IN ('cerrada', 'purgada')) AS kinds`,
  );
  const chosen: SecurityProfile = isSecurityProfile(found.rows[0].chosen) ? found.rows[0].chosen : 'estudiantil';
  const minimum = (found.rows[0].kinds as string[]).filter(isSecurityProfile).reduce<SecurityProfile | null>((most, kind) => stricterProfile(kind, most), null);
  return { profile: stricterProfile(chosen, minimum), chosen, minimum };
}

/** Poll watchers never need it: they get in with their link, and only ever see their own table. */
export async function needsSecondFactor(pool: pg.Pool, actor: Actor): Promise<boolean> {
  if (actor.verified || actor.roles.every((role) => role === 'fiscal')) return false;
  const { profile } = await securityProfile(pool);
  return SECURITY_PROFILES[profile].secondFactor;
}

/** Every protected route goes through here: without a valid device, nothing. */
export function authenticated(pool: pg.Pool, { beforeSecondFactor = false } = {}) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const actor = header?.startsWith('Bearer ') ? await loadActor(pool, header.slice(7)) : null;
    if (!actor) return reply.code(401).send({ error: 'not_authenticated' });
    if (!beforeSecondFactor && (await needsSecondFactor(pool, actor))) return reply.code(403).send({ error: 'second_factor_needed' });
    request.actor = actor;
  };
}

export function requires(pool: pg.Pool, permission: Permission) {
  const check = authenticated(pool);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await check(request, reply);
    if (reply.sent) return;
    if (!request.actor.permissions.includes(permission)) return reply.code(403).send({ error: 'forbidden' });
  };
}

export const can = (actor: Actor, permission: Permission) => actor.permissions.includes(permission);

/** Whether this person may work on a table: their own, one in their district, or all if they run the election. */
export async function canReachTable(pool: pg.Pool, actor: Actor, tableId: string): Promise<boolean> {
  if (can(actor, 'election.manage')) return true;
  if (can(actor, 'table.work') && actor.assignments.some((a) => a.role === 'fiscal' && a.table_id === tableId)) return true;
  const units = can(actor, 'district.watch') ? actor.assignments.filter((a) => a.role === 'jefe').map((a) => a.unit_id) : [];
  if (units.length === 0) return false;
  const table = await pool.query('SELECT unit_id FROM polling_tables WHERE id = $1', [tableId]);
  return units.includes(table.rows[0]?.unit_id) || units.includes(null);
}

/** The tables of an election this person looks after: all, if they run the election, or else those of their districts. */
export async function tablesInScope(pool: pg.Pool, actor: Actor, election: string): Promise<string[]> {
  if (can(actor, 'election.manage')) {
    return (await pool.query('SELECT id FROM polling_tables WHERE election_id = $1', [election])).rows.map((r) => r.id);
  }
  const units = actor.assignments.filter((a) => a.role === 'jefe').map((a) => a.unit_id);
  const everything = units.includes(null);
  return (await pool.query('SELECT id FROM polling_tables WHERE election_id = $1 AND ($2 OR unit_id = ANY($3))', [election, everything, units])).rows.map((r) => r.id);
}

export async function audit(pool: pg.Pool, actor: Actor | null, action: string, target?: string, detail: object = {}) {
  await pool.query('INSERT INTO audit_log (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [actor?.userId ?? null, action, target ?? null, JSON.stringify(detail)]);
}

/**
 * For views that are looked at again and again, such as a panel that refreshes by itself: one entry per
 * person, thing and few minutes says who looked, without burying everything else in the log.
 */
const AUDIT_AGAIN_MS = 5 * 60_000;
const lastAudited = new Map<string, number>();
export async function auditView(pool: pg.Pool, actor: Actor, action: string, target?: string): Promise<void> {
  const key = `${actor.userId}\n${action}\n${target ?? ''}`;
  const now = Date.now();
  if (now - (lastAudited.get(key) ?? 0) < AUDIT_AGAIN_MS) return;
  if (lastAudited.size > 10_000) lastAudited.clear();
  lastAudited.set(key, now);
  await audit(pool, actor, action, target);
}

export async function getSetting<T>(pool: pg.Pool, key: string, fallback: T): Promise<T> {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows[0]?.value ?? fallback;
}

export async function setSetting(pool: pg.Pool, key: string, value: unknown) {
  await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, JSON.stringify(value)]);
}

/**
 * Sensitive traffic light categories are sealed with a key from the environment. That protects a dump of
 * the database taken without the .env. It does not protect a copy of the whole disk or a backup, which
 * carry the key, nor a running server.
 */
function sealingKey(): Buffer {
  const secret = process.env.URNA_FIELD_KEY;
  if (!secret) throw new Error('URNA_FIELD_KEY is required to store sensitive categories');
  return createHash('sha256').update(secret).digest();
}

/**
 * What an erased person's row is called from then on, since a roll id is often the DNI. It cannot be turned back
 * into that id without the field key, and it is always the same for the same id: a phone that still has the old
 * id can still mark the person, and the same roll uploaded again knows they asked to be erased. Whoever has the
 * key can try every DNI until one matches, in minutes: until the purge, the erasure is as safe as the key.
 */
export function erasedId(id: string): string {
  return `x-${createHmac('sha256', sealingKey()).update(`erased:${id}`).digest('hex').slice(0, 32)}`;
}

/**
 * Who a person was in the file they came from, as their name and document read for search: enough to know them in
 * the next file when their id is only a position, not to read it back without the field key.
 */
export function rollKey(search: string): string {
  return createHmac('sha256', sealingKey()).update(`roll:${search}`).digest('hex').slice(0, 32);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): string {
  let bits = '';
  for (const byte of randomBytes(20)) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g)!.map((chunk) => BASE32[parseInt(chunk, 2)]).join('');
}

/** The six digits of an authenticator app (RFC 6238). */
export function totpCode(secret: string, step: number): string {
  let bits = '';
  for (const letter of secret) bits += BASE32.indexOf(letter).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((chunk) => parseInt(chunk, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[19]! & 0xf;
  return String(digest.readUInt32BE(offset) & 0x7fffffff).padStart(6, '0').slice(-6);
}

/** Allows for a phone whose clock is half a minute off. */
export function totpMatches(secret: string, code: string, now = Date.now()): boolean {
  const step = Math.floor(now / 30_000);
  return [-1, 0, 1].some((offset) => totpCode(secret, step + offset) === code);
}

/** Slows down whoever keeps guessing a code. Kept per address, in memory: one small server, one process. */
export function attemptLimiter(max: number, windowMs: number) {
  const seen = new Map<string, { count: number; until: number }>();
  return {
    blocked(key: string): boolean {
      const entry = seen.get(key);
      return Boolean(entry && entry.until > Date.now() && entry.count >= max);
    },
    failed(key: string): void {
      const now = Date.now();
      for (const [other, entry] of seen) if (entry.until <= now) seen.delete(other);
      const entry = seen.get(key);
      seen.set(key, entry && entry.until > now ? { ...entry, count: entry.count + 1 } : { count: 1, until: now + windowMs });
    },
  };
}

export function seal(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealingKey(), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function unseal(value: string): string {
  const raw = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', sealingKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
