import { Client } from 'ssh2';

export interface SshTarget {
  host: string;
  port?: number;
  user: string;
  privateKey: string;
  passphrase?: string;
}

function connect(target: SshTarget): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => resolve(client));
    client.on('error', reject);
    client.connect({
      host: target.host,
      port: target.port ?? 22,
      username: target.user,
      privateKey: target.privateKey,
      passphrase: target.passphrase || undefined,
      readyTimeout: 20_000,
    });
  });
}

/** Whether it can get in and act as root, before asking the person anything else. */
export async function checkSsh(target: SshTarget): Promise<'ok' | 'no_sudo'> {
  const client = await connect(target);
  try {
    const whoami = await run(client, target.user === 'root' ? 'id -u' : 'sudo -n id -u');
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
export async function runScript(target: SshTarget, script: string, onLine: (line: string) => void): Promise<void> {
  const client = await connect(target);
  try {
    const { code, output } = await run(client, target.user === 'root' ? 'sh -s' : 'sudo -n sh -s', script, onLine);
    if (code !== 0) throw new Error(`script_failed: ${output.split('\n').slice(-6).join(' | ')}`);
  } finally {
    client.end();
  }
}
