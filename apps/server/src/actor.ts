import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { isRole, permissionsOf, SECURITY_PROFILES, type Permission, type Role, type RoleOverrides, type SecurityProfile } from '@urna-abierta/domain';

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
export const forgetActors = () => actors.clear();

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
  const permissions = permissionsOf(unique, await getSetting<RoleOverrides>(pool, 'role_permissions', {}));
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

/** Poll watchers never need it: they get in with their link, and only ever see their own table. */
export async function needsSecondFactor(pool: pg.Pool, actor: Actor): Promise<boolean> {
  if (actor.verified || actor.roles.every((role) => role === 'fiscal')) return false;
  const profile = await getSetting<SecurityProfile>(pool, 'security_profile', 'estudiantil');
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
  if (actor.roles.includes('coordinacion')) return true;
  if (actor.assignments.some((a) => a.role === 'fiscal' && a.table_id === tableId)) return true;
  const units = actor.assignments.filter((a) => a.role === 'jefe').map((a) => a.unit_id);
  if (units.length === 0) return false;
  const table = await pool.query('SELECT unit_id FROM polling_tables WHERE id = $1', [tableId]);
  return units.includes(table.rows[0]?.unit_id) || units.includes(null);
}

export async function audit(pool: pg.Pool, actor: Actor | null, action: string, target?: string, detail: object = {}) {
  await pool.query('INSERT INTO audit_log (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [actor?.userId ?? null, action, target ?? null, JSON.stringify(detail)]);
}

export async function getSetting<T>(pool: pg.Pool, key: string, fallback: T): Promise<T> {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows[0]?.value ?? fallback;
}

export async function setSetting(pool: pg.Pool, key: string, value: unknown) {
  await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, JSON.stringify(value)]);
}

/**
 * Sensitive traffic light categories are sealed with a key from the environment. That protects
 * disk copies and backups. It does not protect a running server, where the key is.
 */
function sealingKey(): Buffer {
  const secret = process.env.URNA_FIELD_KEY;
  if (!secret) throw new Error('URNA_FIELD_KEY is required to store sensitive categories');
  return createHash('sha256').update(secret).digest();
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
