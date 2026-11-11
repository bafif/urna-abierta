import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'ssh2';

export interface SshTarget {
  host: string;
  port?: number;
  user: string;
  privateKey?: string;
  passphrase?: string;
  /** Only to get in the first time: the installer leaves its own key, and the server stops taking passwords. */
  password?: string;
}

/** As `ssh` shows it: SHA256, and the hash in base64 without its padding. */
export const fingerprintOf = (key: Buffer) => `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

const knownFile = () => join(process.env.URNA_CONFIG_DIR ?? join(homedir(), '.urna-abierta'), 'huellas.json');

function known(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(knownFile(), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Like `ssh` the first time: the server's fingerprint is shown and kept, and only a different one later stops
 * everything, before any password or script goes out.
 */
function connect(target: SshTarget, seen?: (fingerprint: string) => void): Promise<Client> {
  const place = `${target.host}:${target.port ?? 22}`;
  let changed = false;
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => resolve(client));
    client.on('error', (error) => reject(changed ? new Error('host_changed') : error));
    client.connect({
      host: target.host,
      port: target.port ?? 22,
      username: target.user,
      privateKey: target.privateKey || undefined,
      passphrase: target.passphrase || undefined,
      password: target.password || undefined,
      readyTimeout: 20_000,
      hostVerifier: (key: Buffer) => {
        const fingerprint = fingerprintOf(key);
        const all = known();
        if (all[place] && all[place] !== fingerprint) {
          changed = true;
          return false;
        }
        if (!all[place]) {
          mkdirSync(join(knownFile(), '..'), { recursive: true, mode: 0o700 });
          writeFileSync(knownFile(), JSON.stringify({ ...all, [place]: fingerprint }), { mode: 0o600 });
        }
        seen?.(fingerprint);
        return true;
      },
    });
  });
}

/**
 * How a user that is not root acts as root without a password: sudo, or doas where there is no sudo, as Alpine's cloud
 * images leave their user. Inside sh, whatever shell the user logs in with.
 */
const asRoot = (command: string) => `sh -c 'if command -v sudo >/dev/null 2>&1; then exec sudo -n ${command}; else exec doas -n ${command}; fi'`;

/** Whether it can get in and act as root, before asking the person anything else. */
export async function checkSsh(target: SshTarget): Promise<'ok' | 'no_sudo'> {
  const client = await connect(target);
  try {
    const whoami = await run(client, target.user === 'root' ? 'id -u' : asRoot('id -u'));
    return whoami.code === 0 && whoami.output.trim() === '0' ? 'ok' : 'no_sudo';
  } finally {
    client.end();
  }
}

function run(client: Client, command: string, input?: string, onLine?: (line: string) => void): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let output = '';
      let partial = '';
      const take = (chunk: Buffer) => {
        output += chunk.toString();
        partial += chunk.toString();
        const lines = partial.split('\n');
        partial = lines.pop() ?? '';
        for (const line of lines) onLine?.(line);
      };
      stream.on('data', take);
      stream.stderr.on('data', take);
      stream.on('close', (code: number | null) => resolve({ code: code ?? 1, output }));
      if (input !== undefined) stream.end(input);
    });
  });
}

/** Sends the whole script over standard input: nothing stays in a file or in the list of processes. */
export async function runScript(target: SshTarget, script: string, onLine: (line: string) => void, onFingerprint?: (fingerprint: string) => void): Promise<void> {
  const client = await connect(target, onFingerprint);
  try {
    const { code, output } = await run(client, target.user === 'root' ? 'sh -s' : asRoot('sh -s'), script, onLine);
    if (code !== 0) throw new Error(`script_failed: ${output.split('\n').slice(-6).join(' | ')}`);
  } finally {
    client.end();
  }
}
