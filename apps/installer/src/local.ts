import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { images, newSecrets, type Secrets } from './settings.ts';

const exec = promisify(execFile);
const PORT = process.env.URNA_LOCAL_PORT ?? '8090';
const NAME = process.env.URNA_LOCAL_NAME ?? 'urna-local';

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

/** Trying it again keeps the same data and the same keys. */
function savedSecrets(): Secrets {
  const folder = process.env.URNA_CONFIG_DIR ?? join(homedir(), '.urna-abierta');
  const file = join(folder, 'prueba-local.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    const secrets = newSecrets();
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
  await run(
    'run', '-d', '--name', `${NAME}-server`, '--network', NAME, '--restart=unless-stopped', '-e', 'URNA_ACEPTO_RESPONSABILIDAD=si',
    '-e', `URNA_SETUP_CODE=${secrets.setupCode}`, '-e', `URNA_FIELD_KEY=${secrets.fieldKey}`, '-e', `URNA_TEMA=${theme}`,
    '-e', `DATABASE_URL=postgres://urna:${secrets.postgresPassword}@${NAME}-db:5432/urna`, '-e', 'URNA_PHOTOS_DIR=/tmp/fotos', chosen.server,
  );
  await run('run', '-d', '--name', `${NAME}-web`, '--network', NAME, '--restart=unless-stopped', '-p', `127.0.0.1:${PORT}:80`, '-e', 'URNA_SITE=:80', '-e', `URNA_API=${NAME}-server:3000`, chosen.web);
  return { secrets, url: `http://localhost:${PORT}` };
}
