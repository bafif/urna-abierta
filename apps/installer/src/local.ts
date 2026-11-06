import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { images, newSecrets, type Secrets } from './settings.ts';

const exec = promisify(execFile);
const PORT = process.env.URNA_LOCAL_PORT ?? '8090';
const NAME = process.env.URNA_LOCAL_NAME ?? 'urna-local';
const S3_SETTINGS = ['URNA_S3_ENDPOINT', 'URNA_S3_BUCKET', 'URNA_S3_REGION', 'URNA_S3_PREFIX', 'URNA_S3_ACCESS_KEY_ID', 'URNA_S3_SECRET_ACCESS_KEY'];

/** Podman or Docker, whichever this computer has. On a server it is always Podman; here it is up to the person. */
export async function findEngine(): Promise<string | null> {
  for (const engine of ['podman', 'docker']) {
    try {
      await exec(engine, ['info'], { timeout: 30_000 });
      return engine;
    } catch {
      // Missing, or installed and not running.
    }
  }
  return null;
}

/** Here the containers start from this computer, so it makes the keys a server would make for itself. */
type LocalSecrets = Secrets & { postgresPassword: string; fieldKey: string };

/** Trying it again keeps the same data and the same keys. */
function savedSecrets(): LocalSecrets {
  const folder = process.env.URNA_CONFIG_DIR ?? join(homedir(), '.urna-abierta');
  const file = join(folder, 'prueba-local.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    const secrets = { ...newSecrets(), postgresPassword: randomBytes(24).toString('hex'), fieldKey: randomBytes(32).toString('hex') };
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    return secrets;
  }
}

/** Starts everything on this computer. It is only reachable from here, and it does not need a certificate. */
export async function startLocal(theme: string, log: (line: string) => void): Promise<{ secrets: Secrets; url: string }> {
  const engine = await findEngine();
  if (!engine) throw new Error('no_engine');
  const secrets = savedSecrets();
  const chosen = images();
  const run = (...args: string[]) => exec(engine, args, { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
  const remove = (...names: string[]) => run('rm', '-f', ...names).catch(() => undefined);

  for (const image of [chosen.db, chosen.server, chosen.web]) {
    log(`pull:${image}`);
    await run('image', 'exists', image).catch(() => run('pull', image));
  }
  await run('network', 'create', NAME).catch(() => undefined);
  await remove(`${NAME}-web`, `${NAME}-server`, `${NAME}-db`);

  log('start');
  await run('run', '-d', '--name', `${NAME}-db`, '--network', NAME, '--restart=unless-stopped', '-e', 'POSTGRES_USER=urna', '-e', 'POSTGRES_DB=urna', '-e', `POSTGRES_PASSWORD=${secrets.postgresPassword}`, '-v', `${NAME}-database:/var/lib/postgresql`, chosen.db);
  // The photos live in a volume, like the database, so that trying it again keeps them. A new
  // volume belongs to root under Docker, and the server runs as `node`.
  const photos = `${NAME}-fotos:/fotos`;
  await run('run', '--rm', '--user', '0', '-v', photos, chosen.server, 'chown', 'node', '/fotos');
  // Whoever wants to try photos in a bucket from here sets the same variables as on a server.
  const bucket = S3_SETTINGS.flatMap((name) => (process.env[name] ? ['-e', `${name}=${process.env[name]}`] : []));
  await run(
    'run', '-d', '--name', `${NAME}-server`, '--network', NAME, '--restart=unless-stopped', '-e', 'URNA_ACEPTO_RESPONSABILIDAD=si',
    '-e', `URNA_SETUP_CODE=${secrets.setupCode}`, '-e', `URNA_FIELD_KEY=${secrets.fieldKey}`, '-e', `URNA_TEMA=${theme}`,
    '-e', `DATABASE_URL=postgres://urna:${secrets.postgresPassword}@${NAME}-db:5432/urna`, '-e', 'URNA_PHOTOS_DIR=/fotos', '-v', photos, ...bucket, chosen.server,
  );
  await run('run', '-d', '--name', `${NAME}-web`, '--network', NAME, '--restart=unless-stopped', '-p', `127.0.0.1:${PORT}:80`, '-e', 'URNA_SITE=:80', '-e', `URNA_API=${NAME}-server:3000`, chosen.web);
  return { secrets, url: `http://localhost:${PORT}` };
}
