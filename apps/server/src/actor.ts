import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { isRole, rolesCan, type Permission, type Role } from '@urna-abierta/domain';

export interface Assignment {
  role: Role;
  election_id: string | null;
  unit_id: string | null;
  table_id: string | null;
}

export interface Actor {
  userId: string;
  deviceId: string;
  name: string;
  roles: Role[];
  assignments: Assignment[];
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function loadActor(pool: pg.Pool, token: string): Promise<Actor | null> {
  const found = await pool.query(
    `SELECT d.id AS device_id, u.id AS user_id, u.name
     FROM devices d JOIN users u ON u.id = d.user_id
     WHERE d.token_hash = $1 AND d.revoked_at IS NULL AND u.removed_at IS NULL`,
    [hashToken(token)],
  );
  const row = found.rows[0];
  if (!row) return null;
  const roles = await pool.query(
    `SELECT role, election_id, unit_id, table_id FROM role_assignments
     WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [row.user_id],
  );
  const assignments = roles.rows.filter((r) => isRole(r.role)) as Assignment[];
  return { userId: row.user_id, deviceId: row.device_id, name: row.name, assignments, roles: [...new Set(assignments.map((a) => a.role))] };
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}

/** Every protected route goes through here: without a valid device, nothing. */
export function authenticated(pool: pg.Pool) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const actor = header?.startsWith('Bearer ') ? await loadActor(pool, header.slice(7)) : null;
    if (!actor) return reply.code(401).send({ error: 'not_authenticated' });
    request.actor = actor;
  };
}

export function requires(pool: pg.Pool, permission: Permission) {
  const check = authenticated(pool);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await check(request, reply);
    if (reply.sent) return;
    if (!rolesCan(request.actor.roles, permission)) return reply.code(403).send({ error: 'forbidden' });
  };
}

export const can = (actor: Actor, permission: Permission) => rolesCan(actor.roles, permission);

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
