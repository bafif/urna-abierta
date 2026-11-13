import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { audit, inTransaction } from './actor.ts';
import { createInvitation, INVITATION_DAYS } from './routes-auth.ts';

/**
 * The way back in when nobody with «Coordinar conmigo» can get in: whoever can enter the server already can read the
 * whole database, so this gives them nothing new. «urna invitar» runs it inside the server container:
 *
 *   node apps/server/src/invite-from-server.ts                 who has the task now
 *   node apps/server/src/invite-from-server.ts "Laura Méndez"  a new invitation for her, or for someone new with that name
 *
 * To someone who already had the task it closes every other access, the lost phone included, and lets them set up
 * the second step again: the code app may have gone with the phone. It prints the invitation on the last line.
 */
const say = (es: string, en: string): string => (process.env.URNA_IDIOMA === 'en' ? en : es);

export type FromServer =
  | { kind: 'list'; names: string[] }
  | { kind: 'again' | 'new'; name: string; token: string; days: number }
  | { kind: 'ambiguous'; name: string };

export async function inviteFromServer(pool: pg.Pool, name?: string): Promise<FromServer> {
  const coordination = await pool.query<{ id: string; name: string }>(
    `SELECT DISTINCT u.id, u.name FROM users u JOIN role_assignments a ON a.user_id = u.id
     WHERE a.role = 'coordinacion' AND u.removed_at IS NULL ORDER BY u.name`,
  );
  const wanted = name?.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!wanted) return { kind: 'list', names: coordination.rows.map((row) => row.name) };
  const same = coordination.rows.filter((row) => row.name.toLocaleLowerCase('es') === wanted.toLocaleLowerCase('es'));
  if (same.length > 1) return { kind: 'ambiguous', name: wanted };
  const found = same[0];
  if (found) {
    await inTransaction(pool, async (client) => {
      await client.query('UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [found.id]);
      await client.query('UPDATE invitations SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [found.id]);
      await client.query('UPDATE users SET totp_sealed = NULL WHERE id = $1', [found.id]);
      await client.query('DELETE FROM settings WHERE key = $1', [`totp_pending_${found.id}`]);
    });
    await audit(pool, null, 'server.invited_again', found.id);
    return { kind: 'again', name: found.name, token: await createInvitation(pool, found.id, null), days: INVITATION_DAYS };
  }
  const id = randomUUID();
  await inTransaction(pool, async (client) => {
    await client.query('INSERT INTO users (id, name, phone) VALUES ($1, $2, NULL)', [id, wanted]);
    await client.query(`INSERT INTO role_assignments (id, user_id, role) VALUES ($1, $2, 'coordinacion')`, [randomUUID(), id]);
  });
  await audit(pool, null, 'server.invited_new', id);
  return { kind: 'new', name: wanted, token: await createInvitation(pool, id, null), days: INVITATION_DAYS };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await inviteFromServer(pool, process.argv.slice(2).join(' '));
    if (result.kind === 'list') {
      console.log(result.names.length
        ? say(`Con «Coordinar conmigo»: ${result.names.join(', ')}.`, `With “Coordinate with me”: ${result.names.join(', ')}.`)
        : say('Nadie tiene «Coordinar conmigo».', 'Nobody has “Coordinate with me”.'));
      process.exitCode = 3;
    } else if (result.kind === 'ambiguous') {
      console.error(say(
        `Hay más de una persona de coordinación que se llama ${result.name}. Desde la app, cambiale el nombre a una.`,
        `More than one person in coordination is called ${result.name}. From the app, rename one of them.`,
      ));
      process.exitCode = 1;
    } else {
      console.log(result.kind === 'again'
        ? say(`Una invitación nueva para ${result.name}. Sus otros accesos se cerraron, también el del teléfono perdido, y puede volver a configurar el segundo paso.`,
          `A new invitation for ${result.name}. Their other accesses were closed, the lost phone's too, and they can set up the second step again.`)
        : say(`${result.name} ahora tiene «Coordinar conmigo». Esta es su invitación.`, `${result.name} now has “Coordinate with me”. This is their invitation.`));
      console.log(say(`Sirve una sola vez y vence en ${result.days} días. Queda en el registro.`, `It works only once and expires in ${result.days} days. It goes in the log.`));
      console.log(result.token);
    }
  } finally {
    await pool.end();
  }
}
