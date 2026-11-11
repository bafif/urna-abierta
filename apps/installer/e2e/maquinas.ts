/**
 * What the installations on Alpine machines in containers share: Podman, the images of this checkout,
 * and the list of what passed. servidor.ts installs over SSH and texto.ts pastes the block as user data.
 */
import { execFileSync } from 'node:child_process';

export const root = new URL('../../../', import.meta.url).pathname;

export const podman = (...args: string[]) => execFileSync('podman', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/** For what has to fail: whether it did, and everything it said. */
export function attempt(...args: string[]): { ok: boolean; said: string } {
  try {
    return { ok: true, said: execFileSync('podman', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    return { ok: false, said: `${stdout}${stderr}` };
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const results: { step: string; ok: boolean; detail?: unknown }[] = [];

export function record(step: string, ok: boolean, detail?: unknown): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

/** The server and web images of this checkout, and the machine: Alpine with OpenRC and SSH. */
export function buildImages({ server, web, machine }: { server: string; web: string; machine: string }): void {
  execFileSync('bash', ['-c', `podman build -q -t ${server} -f deploy/server.Containerfile . >/dev/null && podman build -q -t ${web} -f deploy/web.Containerfile . >/dev/null && podman build -q -t ${machine} -f deploy/maquina-prueba.Containerfile deploy >/dev/null`], { cwd: root, stdio: 'inherit' });
}

/** Removes what it made, unless URNA_DEJAR_MAQUINAS asks to keep it, and ends saying how many failed. */
export function finish(cleanup: () => void): never {
  if (!process.env.URNA_DEJAR_MAQUINAS) cleanup();
  const failed = results.filter((item) => !item.ok);
  console.log(failed.length ? `Fallaron ${failed.length} de ${results.length}.` : `Pasaron las ${results.length}.`);
  process.exit(failed.length ? 1 : 0);
}
