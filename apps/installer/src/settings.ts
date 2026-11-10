import { createHash, randomBytes } from 'node:crypto';
import ssh2 from 'ssh2';
import { assetText } from './assets.ts';

export const VERSION = process.env.URNA_VERSION ?? 'latest';

export interface Images {
  db: string;
  server: string;
  web: string;
}

export const images = (): Images => ({
  db: process.env.URNA_IMAGE_DB ?? 'docker.io/library/postgres:18-alpine',
  server: process.env.URNA_IMAGE_SERVER ?? `ghcr.io/bafif/urna-abierta-server:${VERSION}`,
  web: process.env.URNA_IMAGE_WEB ?? `ghcr.io/bafif/urna-abierta-web:${VERSION}`,
});

/**
 * What the installer shows. The database password and the field key are not here: the server makes them, so that they
 * never travel in the block that installs, which a cloud keeps where its console shows it.
 */
export interface Secrets {
  /** Shown once, to create the first administrator. The server keeps only its hash. */
  setupCode: string;
  /** Opens the backups. It is shown once, and the party keeps it. */
  recoveryKey: string;
  /**
   * To get into the server later, to update it or restore a copy, as `urna-admin`. The private half only goes in the
   * access file; the server gets the public one.
   */
  adminKey?: { private: string; public: string };
}

/** Without letters that get mixed up when someone copies it by hand. */
const READABLE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function readable(length: number): string {
  const bytes = randomBytes(length * 2);
  let out = '';
  for (const byte of bytes) {
    // Rejecting the top of the range keeps every character equally likely.
    if (byte < 248 && out.length < length) out += READABLE[byte % READABLE.length];
  }
  return out;
}

export function newSecrets(): Secrets {
  const group = () => readable(5);
  return {
    setupCode: readable(12),
    recoveryKey: [group(), group(), group(), group(), group()].join('-'),
    // Without a passphrase, as approved: one thing less to keep, and the access file says to guard it.
    adminKey: ssh2.utils.generateKeyPairSync('ed25519', { comment: 'urna-abierta' }),
  };
}

/** The base64 part of a public key: the script spells out the rest, so that nothing with spaces goes in it. */
const publicKeyBody = (key: string) => key.split(' ')[1] ?? '';

export type Cert = 'ip' | 'auto' | 'internal';

const IP = /^\d{1,3}(\.\d{1,3}){3}$/;
const DOMAIN = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

/** An address as a person writes it, into what the server needs. */
export function siteFor(address: string): { site: string; cert: Cert; url: string } {
  const clean = address.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (IP.test(clean)) return { site: `https://${clean}`, cert: 'ip', url: `https://${clean}` };
  if (DOMAIN.test(clean)) return { site: clean, cert: 'auto', url: `https://${clean}` };
  throw new Error('invalid_address');
}

export interface ScriptSettings {
  secrets: Secrets;
  /** `auto` lets the machine ask what its public address is. */
  site: string;
  cert: Cert;
  theme: string;
  images?: Images;
  /** Only for tests: images loaded from a file instead of downloaded. */
  imagesTar?: string;
  extraEnv?: string[];
  /** The person came in with a password the first time: from then on the server takes only keys. */
  keysOnly?: boolean;
  /** The language of the installer's screens: «urna» answers in it on the server. Without it, it follows the server's system. */
  language?: 'es' | 'en';
}

const SAFE_VALUE = /^[\w@%+=:,./-]*$/;

function assign(name: string, value: string): string {
  // Everything here is generated or validated: this only catches a mistake, and it must not get into a script.
  if (!SAFE_VALUE.test(value)) throw new Error(`unsafe value for ${name}`);
  return `${name}=${value}`;
}

/**
 * A script without its comment lines, so that the whole block fits in what clouds accept. The block at the top stays,
 * because it says what the script is, and so does every here-document, because those lines are a file's content.
 */
export function withoutComments(script: string): string {
  const kept: string[] = [];
  let hereEnd: string | null = null;
  let top = true;
  for (const line of script.split('\n')) {
    if (hereEnd !== null) {
      kept.push(line);
      if (line.trim() === hereEnd) hereEnd = null;
      continue;
    }
    const comment = /^\s*#/.test(line);
    if (top && comment) { kept.push(line); continue; }
    top = false;
    if (comment) continue;
    kept.push(line);
    const here = /<<-?\s*['"]?(\w+)['"]?/.exec(line);
    if (here) hereEnd = here[1]!;
  }
  return kept.join('\n');
}

/** One block that does the whole installation: what runs over SSH, and what gets pasted when creating a server. */
export function renderScript({ secrets, site, cert, theme, images: chosen = images(), imagesTar, extraEnv = [], keysOnly = false, language }: ScriptSettings): string {
  if (extraEnv.some((line) => !/^[A-Z_]+=/.test(line) || !SAFE_VALUE.test(line.slice(line.indexOf('=') + 1)))) throw new Error('unsafe extra setting');
  // The recovery key goes as it is: the server encrypts each backup with it. The servers' guide says what that means.
  const settings = [
    assign('URNA_BACKUP_KEY', secrets.recoveryKey),
    assign('URNA_SETUP_CODE_HASH', createHash('sha256').update(secrets.setupCode).digest('hex')),
    assign('URNA_TEMA', theme),
    assign('URNA_SITE', site),
    assign('URNA_CERT', cert),
    assign('URNA_IMAGE_DB', chosen.db),
    assign('URNA_IMAGE_SERVER', chosen.server),
    assign('URNA_IMAGE_WEB', chosen.web),
    ...(imagesTar ? [assign('URNA_IMAGES_TAR', imagesTar)] : []),
    ...(secrets.adminKey ? [assign('URNA_ADMIN_KEY', publicKeyBody(secrets.adminKey.public))] : []),
    ...(keysOnly && secrets.adminKey ? [assign('URNA_SOLO_LLAVES', 'si')] : []),
    ...(language === 'es' || language === 'en' ? [assign('URNA_IDIOMA', language)] : []),
    ...(extraEnv.length ? [`URNA_EXTRA_ENV='${extraEnv.join('\n')}'`] : []),
  ];
  // The `urna` script does not go here: it comes in the server image, so that each version brings its own.
  return [
    '#!/bin/sh',
    '# Urna Abierta: installs everything on an Ubuntu or Debian server.',
    ...settings,
    withoutComments(assetText('instalar.sh')).trimEnd(),
    '',
  ].join('\n');
}
