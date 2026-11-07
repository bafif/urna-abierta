import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { asset } from './assets.ts';
import { themeProblems } from '../../../packages/domain/src/theme-check.ts';
import { CloudFailure, install, uploadTheme, waitForHealth, type InstallRequest, type InstallResult } from './job.ts';
import { findEngine } from './local.ts';
import { siteFor, VERSION } from './settings.ts';
import { checkSsh } from './ssh.ts';
import { accessFile } from './access.ts';

/**
 * The installer is a small server that only this computer can reach, and its screens open in the
 * browser. The token in the address keeps other pages or programs from using it.
 */
const token = randomBytes(18).toString('base64url');
/** A theme with all its fonts inside fits. */
const MAX_BODY = 32 * 1024 * 1024;

interface Job {
  lines: string[];
  result: InstallResult | null;
  problem: string | null;
  /** After a failure in a cloud: what could not be deleted there. Null when nothing was created in one. */
  left: string[] | null;
  finished: boolean;
}
let job: Job | null = null;
/** For the option of pasting a text: the theme waits here until the server answers. */
let themeToSend: object | null = null;

const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', woff2: 'font/woff2' };

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function bodyOf(request: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** The browser of this computer, as a plain window when it can be. */
function openBrowser(url: string): void {
  if (process.env.URNA_NO_BROWSER) return;
  const commands: Record<string, [string, string[]]> = {
    win32: ['cmd', ['/c', 'start', '', url]],
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]],
  };
  const [command, args] = commands[process.platform] ?? commands.linux!;
  spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
}

async function api(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (path === 'state') return send(response, 200, { version: VERSION, engine: await findEngine() });
  if (path === 'job') {
    if (!job) return send(response, 200, { lines: [], result: null, problem: null, left: null, finished: false });
    const access = job.result?.access;
    return send(response, 200, access ? { ...job, result: { ...job.result, access: { ...access, key: undefined } } } : job);
  }
  if (path === 'access') {
    // A pasted server says its address after the installation: the screen passes it, checked like any other.
    const access = job?.result?.access;
    if (!access) return send(response, 404, { error: 'no_access' });
    const query = new URL(request.url ?? '', 'http://127.0.0.1').searchParams;
    let address = access.address;
    try {
      if (!address && query.get('address')) address = siteFor(query.get('address')!).url;
    } catch {
      // Without an address, the file says where it goes.
    }
    const language = query.get('lang') === 'en' ? 'en' : 'es';
    const file = accessFile({ ...access, address, setupLink: access.setupLink || (address ? `${address}/#setup=${job!.result!.setupCode}` : '') }, language);
    response.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="urna-abierta-acceso.zip"', 'cache-control': 'no-store' });
    response.end(file);
    return;
  }

  if (request.method !== 'POST') return send(response, 405, { error: 'post_only' });
  const body = await bodyOf(request);

  if (path === 'check-theme') return send(response, 200, { problems: themeProblems(body.theme) });

  if (path === 'check-ssh') {
    try {
      siteFor(body.address);
    } catch {
      return send(response, 200, { result: 'bad_address' });
    }
    try {
      return send(response, 200, { result: await checkSsh(body.target) });
    } catch (error) {
      const { message } = error as Error;
      return send(response, 200, { result: message === 'host_changed' ? 'host_changed' : 'cannot_connect', detail: message });
    }
  }
  if (path === 'install') {
    if (job && !job.finished) return send(response, 409, { error: 'already_running' });
    const current: Job = { lines: [], result: null, problem: null, left: null, finished: false };
    job = current;
    themeToSend = body.where?.kind === 'text' ? (body.customTheme ?? null) : null;
    install(body as InstallRequest, (line) => current.lines.push(line))
      .then((result) => {
        current.result = result;
      })
      .catch((error: Error) => {
        current.problem = error.message;
        if (error instanceof CloudFailure) current.left = error.left;
      })
      .finally(() => {
        current.finished = true;
      });
    return send(response, 202, { ok: true });
  }
  if (path === 'wait-address') {
    // For the option of pasting a text: the person says which address the server got.
    let place;
    try {
      place = siteFor(body.address);
    } catch {
      return send(response, 200, { result: 'bad_address' });
    }
    const alive = await waitForHealth(place.url, () => undefined, 8_000);
    if (!alive) return send(response, 200, { result: 'not_yet', url: place.url });
    const sent = !themeToSend || (await uploadTheme(place.url, job?.result?.setupCode ?? '', themeToSend));
    themeToSend = null;
    return send(response, 200, { result: 'ok', url: place.url, themeFailed: !sent });
  }
  if (path === 'check-again') {
    // The address that did not answer in time: once more, briefly.
    const address = job?.result?.address;
    if (!address) return send(response, 404, { error: 'no_address' });
    const answered = await waitForHealth(address, () => undefined, 8_000);
    if (answered && job?.result) job.result.answered = true;
    return send(response, 200, { answered });
  }
  if (path === 'open') {
    if (typeof body.url !== 'string' || !/^https?:\/\//.test(body.url)) return send(response, 400, { error: 'bad_url' });
    openBrowser(body.url);
    return send(response, 200, { ok: true });
  }
  if (path === 'quit') {
    send(response, 200, { ok: true });
    setTimeout(() => process.exit(0), 200);
    return;
  }
  send(response, 404, { error: 'not_found' });
}

const server = createServer((request, response) => {
  void (async () => {
    const { port } = server.address() as { port: number };
    // Another site cannot point its address at this port and talk to it.
    if (request.headers.host !== `127.0.0.1:${port}`) return send(response, 403, { error: 'forbidden' });
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const [, given, ...rest] = url.pathname.split('/');
    if (given !== token) return send(response, 403, { error: 'forbidden' });
    const path = rest.join('/');
    if (path.startsWith('api/')) return api(path.slice(4), request, response);
    const name = path === '' ? 'index.html' : path;
    const content = asset(name);
    if (!content || !/^[\w./-]+$/.test(name) || name.includes('..') || name === 'instalar.sh') return send(response, 404, { error: 'not_found' });
    response.writeHead(200, { 'content-type': TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:" });
    response.end(content);
  })().catch((error) => {
    send(response, 500, { error: (error as Error).message });
  });
});

server.listen(Number(process.env.URNA_INSTALLER_PORT ?? 0), '127.0.0.1', () => {
  const { port } = server.address() as { port: number };
  const url = `http://127.0.0.1:${port}/${token}/`;
  console.log(`Urna Abierta: abrí esta dirección en tu navegador, si no se abrió sola:\n${url}`);
  openBrowser(url);
});
