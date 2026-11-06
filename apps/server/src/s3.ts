import { createHash, createHmac } from 'node:crypto';

/**
 * Just enough of S3 to keep photos and backups in a bucket: put, get and delete one object, and list names, signed with
 * Signature Version 4. Path-style addresses, which AWS, Oracle's compatibility API, R2 and
 * MinIO all accept.
 */

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const sha256Hex = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();

/** S3's UriEncode: every byte except the unreserved characters, in uppercase hex; the slash only when asked. */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(char) || (char === '/' && !encodeSlash)) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** 20130524T000000Z */
export const amzDate = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '');

export interface S3Signing {
  method: string;
  /** What goes in the Host header: the name, and the port when it is not the usual one. */
  host: string;
  /** The path as it is, unencoded: S3 paths are never normalized. */
  path: string;
  query?: Record<string, string>;
  /** Signed along with host, x-amz-date, x-amz-content-sha256 and the session token. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body (of the empty string when there is none), or UNSIGNED-PAYLOAD. */
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** See amzDate. */
  date: string;
  service?: string;
}

export interface SignedRequest {
  /** Encoded, ready to go after the origin. */
  path: string;
  /** Encoded and sorted; empty when there is none. */
  query: string;
  /** Everything to send except Host, which fetch sets from the address. */
  headers: Record<string, string>;
  canonicalRequest: string;
}

export function signS3(request: S3Signing): SignedRequest {
  const { method, host, path, query = {}, payloadHash, region, accessKeyId, secretAccessKey, sessionToken, date, service = 's3' } = request;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) headers[name.toLowerCase()] = value;
  headers['x-amz-date'] = date;
  headers['x-amz-content-sha256'] = payloadHash;
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;
  const signed: Record<string, string> = { ...headers, host };
  const names = Object.keys(signed).sort();

  const canonicalPath = uriEncode(path, false);
  // By name, then by value, both already encoded.
  const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const canonicalQuery = Object.entries(query)
    .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
    .sort((a, b) => byCodePoint(a[0], b[0]) || byCodePoint(a[1], b[1]))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const canonicalHeaders = names.map((name) => `${name}:${signed[name]!.trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, names.join(';'), payloadHash].join('\n');

  const day = date.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha256Hex(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope},SignedHeaders=${names.join(';')},Signature=${signature}`;
  return { path: canonicalPath, query: canonicalQuery, headers, canonicalRequest };
}

export interface S3Config {
  /** Only the address, like https://s3.us-east-1.amazonaws.com: the bucket goes in the path. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

// Plain fields, not parameter properties: the server runs with Node's type stripping.
export class S3Error extends Error {
  readonly status?: number;
  readonly code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'S3Error';
    this.status = status;
    this.code = code;
  }
}

export interface S3ClientOptions {
  fetch?: typeof fetch;
  /** Including the first one. */
  attempts?: number;
  timeoutMs?: number;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
}

/**
 * fetch only says «fetch failed»; what happened is in its cause: the name that does not exist,
 * the closed port, the certificate. Only the cause's code and text, which carry neither the
 * keys nor the signature: those travel in the headers.
 */
function causeOf(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (!(cause instanceof Error)) return '';
  const code = (cause as NodeJS.ErrnoException).code;
  // Several addresses for one name (IPv6 and IPv4) fail together, each with its own text.
  const text = cause.message || (cause instanceof AggregateError ? cause.errors.map((each) => (each instanceof Error ? each.message : String(each))).join('; ') : '');
  const why = code && !text.includes(code) ? (text ? `${code}: ${text}` : code) : text;
  return why.slice(0, 300);
}

/** The provider is busy or the network blinked: worth a second try. */
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

export interface S3Client {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  /** Null when there is no such object. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Every name that starts with the prefix. It needs permission to list the bucket (s3:ListBucket). */
  list(prefix: string): Promise<string[]>;
}

export function s3Client(config: S3Config, options: S3ClientOptions = {}): S3Client {
  const { fetch: request = fetch, attempts = 3, timeoutMs = 20_000, now = () => new Date(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = options;
  const endpoint = new URL(config.endpoint);

  /** An empty key is the bucket itself, for listing. */
  async function send(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: Buffer, extra: Record<string, string> = {}, query: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) await wait(250 * 4 ** (attempt - 2));
      // Signed again on each try: the signature carries the time.
      const signed = signS3({
        method, host: endpoint.host, path: key ? `/${config.bucket}/${key}` : `/${config.bucket}`, query, headers: extra,
        payloadHash: body ? sha256Hex(body) : EMPTY_SHA256, region: config.region,
        accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, sessionToken: config.sessionToken, date: amzDate(now()),
      });
      try {
        const address = `${endpoint.origin}${signed.path}${signed.query ? `?${signed.query}` : ''}`;
        const response = await request(address, { method, headers: signed.headers, body, signal: AbortSignal.timeout(timeoutMs) });
        const answer = { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
        if (TRANSIENT.has(answer.status) && attempt < attempts) {
          lastError = failure(method, answer);
          continue;
        }
        return answer;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof S3Error) throw lastError;
    const why = causeOf(lastError);
    throw new S3Error(`${method}: ${lastError instanceof Error ? lastError.message : String(lastError)}${why ? ` (${why})` : ''}`);
  }

  function failure(method: string, answer: { status: number; body: Buffer }): S3Error {
    const text = answer.body.toString('utf8');
    const code = /<Code>([^<]*)<\/Code>/.exec(text)?.[1];
    const message = /<Message>([^<]*)<\/Message>/.exec(text)?.[1];
    return new S3Error(`${method}: ${answer.status}${code ? ` ${code}` : ''}${message ? ` (${message})` : ''}`, answer.status, code);
  }

  return {
    async put(key, body, contentType = 'application/octet-stream') {
      const answer = await send('PUT', key, body, { 'content-type': contentType });
      if (answer.status !== 200) throw failure('PUT', answer);
    },
    async get(key) {
      const answer = await send('GET', key);
      // A missing bucket is a broken setting, not a missing photo.
      if (answer.status === 404 && failure('GET', answer).code !== 'NoSuchBucket') return null;
      if (answer.status !== 200) throw failure('GET', answer);
      return answer.body;
    },
    async delete(key) {
      const answer = await send('DELETE', key);
      if (answer.status !== 204 && answer.status !== 200 && answer.status !== 404) throw failure('DELETE', answer);
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const answer = await send('GET', '', undefined, {}, { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) });
        if (answer.status !== 200) throw failure('LIST', answer);
        const text = answer.body.toString('utf8');
        for (const match of text.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(fromXml(match[1]!));
        const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(text)?.[1];
        token = /<IsTruncated>true<\/IsTruncated>/.test(text) && next ? fromXml(next) : undefined;
      } while (token);
      return keys;
    },
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const fromXml = (text: string) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]!);
