import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { awsCloud } from './clouds/aws.ts';
import { sleep, type Cloud } from './clouds/common.ts';
import { googleCloud } from './clouds/google.ts';
import { oracleCloud } from './clouds/oracle.ts';
import { startLocal } from './local.ts';
import { newSecrets, renderScript, siteFor } from './settings.ts';
import { runScript, type SshTarget } from './ssh.ts';

export type Where =
  | { kind: 'cloud'; provider: 'aws' | 'oracle' | 'google'; credentials: any }
  | { kind: 'ssh'; address: string; target: SshTarget }
  | { kind: 'text' }
  | { kind: 'local' };

export interface InstallRequest {
  where: Where;
  theme: string;
  /** How rolls get read. It stays on this computer, for the roll reader. */
  vision: 'local' | 'later';
}

export interface InstallResult {
  /** Where the app lives. Empty when the person still has to paste the text. */
  address: string;
  recoveryKey: string;
  setupLink: string;
  /** The block to paste, for that option. */
  text?: string;
  setupCode: string;
}

const HEALTH_LIMIT_MS = 20 * 60_000;

/** A machine takes minutes to install itself, and the certificate comes after that. */
export async function waitForHealth(address: string, log: (line: string) => void, limitMs = HEALTH_LIMIT_MS, request: typeof fetch = fetch): Promise<boolean> {
  const until = Date.now() + limitMs;
  log('waiting');
  while (Date.now() < until) {
    try {
      const response = await request(`${address}/api/health`, { signal: AbortSignal.timeout(8_000) });
      if (response.ok) return true;
    } catch {
      // Not yet.
    }
    await sleep(5_000);
  }
  return false;
}

function cloudFor(where: Extract<Where, { kind: 'cloud' }>): Cloud {
  if (where.provider === 'aws') return awsCloud(where.credentials);
  if (where.provider === 'oracle') return oracleCloud(where.credentials);
  return googleCloud(where.credentials);
}

function rememberPreferences(request: InstallRequest): void {
  try {
    const folder = process.env.URNA_CONFIG_DIR ?? join(homedir(), '.urna-abierta');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileSync(join(folder, 'preferencias.json'), JSON.stringify({ vision: request.vision }), { mode: 0o600 });
  } catch {
    // Only a preference: it is asked again when reading the first roll.
  }
}

export async function install(request: InstallRequest, log: (line: string) => void): Promise<InstallResult> {
  rememberPreferences(request);
  const { where, theme } = request;

  if (where.kind === 'local') {
    const { secrets, url } = await startLocal(theme, log);
    await waitForHealth(url, log, 3 * 60_000);
    return { address: url, recoveryKey: secrets.recoveryKey, setupCode: secrets.setupCode, setupLink: `${url}/#setup=${secrets.setupCode}` };
  }

  const secrets = newSecrets();
  if (where.kind === 'text') {
    const text = renderScript({ secrets, site: 'auto', cert: 'ip', theme });
    return { address: '', recoveryKey: secrets.recoveryKey, setupCode: secrets.setupCode, setupLink: '', text };
  }

  let url: string;
  if (where.kind === 'ssh') {
    const place = siteFor(where.address);
    url = place.url;
    const script = renderScript({ secrets, site: place.site, cert: place.cert, theme });
    log('connecting');
    await runScript(where.target, script, (line) => {
      if (line.startsWith('urna-abierta: ')) log(`server:${line.slice('urna-abierta: '.length)}`);
    });
  } else {
    const cloud = cloudFor(where);
    const address = await cloud.reserveAddress(log);
    const place = siteFor(address);
    url = place.url;
    await cloud.createServer(renderScript({ secrets, site: place.site, cert: place.cert, theme }), log);
  }
  const healthy = await waitForHealth(url, log);
  if (!healthy) log('slow');
  return { address: url, recoveryKey: secrets.recoveryKey, setupCode: secrets.setupCode, setupLink: `${url}/#setup=${secrets.setupCode}` };
}
