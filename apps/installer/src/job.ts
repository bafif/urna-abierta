import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { awsCloud } from './clouds/aws.ts';
import { sleep, type Cloud } from './clouds/common.ts';
import { googleCloud } from './clouds/google.ts';
import { oracleCloud } from './clouds/oracle.ts';
import { startLocal } from './local.ts';
import { newSecrets, renderScript, siteFor, type Secrets } from './settings.ts';
import { runScript, type SshTarget } from './ssh.ts';

export type Where =
  | { kind: 'cloud'; provider: 'aws' | 'oracle' | 'google'; credentials: any }
  | { kind: 'ssh'; address: string; target: SshTarget }
  | { kind: 'text' }
  /** `phones` opens a temporary tunnel, so that phones on any network can reach this computer. */
  | { kind: 'local'; phones?: boolean };

export interface InstallRequest {
  where: Where;
  theme: string;
  /** How rolls get read. It stays on this computer, for the roll reader. */
  vision: 'local' | 'later';
  /** A theme from a file of the person's. It travels on its own: it may not fit in the block that installs. */
  customTheme?: object;
}

export interface InstallResult {
  /** Where the app lives. Empty when the person still has to paste the text. */
  address: string;
  recoveryKey: string;
  setupLink: string;
  /** The block to paste, for that option. */
  text?: string;
  setupCode: string;
  /** Their own theme could not be sent. It can still be added from the app. */
  themeFailed?: boolean;
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

/** Sends the person's theme to their server, with the installation code, as soon as it answers. */
export async function uploadTheme(address: string, code: string, theme: object, request: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await request(`${address}/api/setup/theme`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, theme }),
      // It may carry its fonts, over whatever connection this computer has.
      signal: AbortSignal.timeout(180_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function cloudFor(where: Extract<Where, { kind: 'cloud' }>): Cloud {
  if (where.provider === 'aws') return awsCloud(where.credentials);
  if (where.provider === 'oracle') return oracleCloud(where.credentials);
  return googleCloud(where.credentials);
}

/** A cloud installation that failed. `left` is what could not be deleted afterwards: empty when nothing stays charging, null when nothing had been created. */
export class CloudFailure extends Error {
  readonly left: string[] | null;
  constructor(message: string, left: string[] | null) {
    super(message);
    this.left = left;
  }
}

/** Creates the server, and if any step fails, deletes what was created, so that trying again starts clean. */
export async function createInCloud(cloud: Cloud, secrets: Secrets, theme: string, log: (line: string) => void): Promise<string> {
  try {
    const place = siteFor(await cloud.reserveAddress(log));
    await cloud.createServer(renderScript({ secrets, site: place.site, cert: place.cert, theme }), log);
    return place.url;
  } catch (error) {
    throw new CloudFailure((error as Error).message, await cloud.cleanUp(log));
  }
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

async function sendCustomTheme(request: InstallRequest, url: string, code: string, alive: boolean, log: (line: string) => void): Promise<{ themeFailed?: boolean }> {
  if (!request.customTheme) return {};
  log('theme');
  return alive && (await uploadTheme(url, code, request.customTheme)) ? {} : { themeFailed: true };
}

export async function install(request: InstallRequest, log: (line: string) => void): Promise<InstallResult> {
  rememberPreferences(request);
  const { where, theme } = request;

  if (where.kind === 'local') {
    const { secrets, url, phonesUrl } = await startLocal(theme, log, where.phones === true);
    const alive = await waitForHealth(url, log, 3 * 60_000);
    // Invitations carry the address the app is open at: with phones, everything is set up from the tunnel's.
    const address = phonesUrl ?? url;
    if (phonesUrl && alive) await waitForHealth(phonesUrl, log, 60_000);
    return { address, recoveryKey: secrets.recoveryKey, setupCode: secrets.setupCode, setupLink: `${address}/#setup=${secrets.setupCode}`, ...(await sendCustomTheme(request, url, secrets.setupCode, alive, log)) };
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
    url = await createInCloud(cloudFor(where), secrets, theme, log);
  }
  const healthy = await waitForHealth(url, log);
  if (!healthy) log('slow');
  return { address: url, recoveryKey: secrets.recoveryKey, setupCode: secrets.setupCode, setupLink: `${url}/#setup=${secrets.setupCode}`, ...(await sendCustomTheme(request, url, secrets.setupCode, healthy, log)) };
}
