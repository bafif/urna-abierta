import { createHash } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { signS3 } from '../src/s3.ts';

/**
 * A tiny S3 for tests: path-style objects in memory, and it checks every signature the way S3
 * does, from what actually arrived (the Host header included).
 */
export interface FakeS3 {
  endpoint: string;
  objects: Map<string, Buffer>;
  requests: { method: string; path: string; headers: IncomingHttpHeaders }[];
  badSignatures: number;
  /** The next `count` requests get this status, as a busy provider would answer. */
  failNext(count: number, status?: number): void;
  /** Takes requests and never answers them. */
  hang(on: boolean): void;
  /** A missing object gets 403 AccessDenied, as AWS answers when the key cannot list the bucket. */
  denyListing(on: boolean): void;
  close(): Promise<void>;
}

const xmlError = (code: string) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;

export async function fakeS3(credentials: { region: string; accessKeyId: string; secretAccessKey: string }, buckets = ['fotos-prueba']): Promise<FakeS3> {
  const objects = new Map<string, Buffer>();
  const requests: FakeS3['requests'] = [];
  let failures = 0;
  let failStatus = 503;
  let hanging = false;
  let listing = true;
  const state = { badSignatures: 0 };

  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url ?? '/', 'http://fake');
    const method = request.method ?? 'GET';
    requests.push({ method, path: url.pathname, headers: request.headers });
    const answer = (status: number, code?: string, payload?: Buffer) => {
      response.writeHead(status, code ? { 'content-type': 'application/xml' } : {});
      response.end(code ? xmlError(code) : payload);
    };

    if (hanging) return;
    if (failures > 0) {
      failures -= 1;
      return answer(failStatus, failStatus === 503 ? 'SlowDown' : 'InternalError');
    }

    const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request,SignedHeaders=([a-z0-9;-]+),Signature=([0-9a-f]{64})$/.exec(String(request.headers.authorization ?? ''));
    if (!auth || auth[1] !== credentials.accessKeyId || auth[3] !== credentials.region) return answer(403, 'AccessDenied');
    const names = auth[4]!.split(';');
    if (!['host', 'x-amz-content-sha256', 'x-amz-date'].every((name) => names.includes(name))) return answer(403, 'AccessDenied');
    const payloadHash = String(request.headers['x-amz-content-sha256']);
    if (payloadHash !== createHash('sha256').update(body).digest('hex')) return answer(400, 'XAmzContentSHA256Mismatch');
    const others = Object.fromEntries(names.filter((name) => !['host', 'x-amz-content-sha256', 'x-amz-date', 'x-amz-security-token'].includes(name)).map((name) => [name, String(request.headers[name] ?? '')]));
    const expected = signS3({
      method, host: String(request.headers.host), path: decodeURIComponent(url.pathname), query: Object.fromEntries(url.searchParams), headers: others, payloadHash,
      region: credentials.region, accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, date: String(request.headers['x-amz-date']),
    });
    if (expected.headers.authorization !== request.headers.authorization) {
      state.badSignatures += 1;
      return answer(403, 'SignatureDoesNotMatch');
    }

    const bucket = url.pathname.split('/')[1] ?? '';
    if (!buckets.includes(bucket)) return answer(404, 'NoSuchBucket');
    const key = decodeURIComponent(url.pathname);
    if (method === 'PUT') {
      objects.set(key, body);
      return answer(200);
    }
    if (method === 'GET') {
      const found = objects.get(key);
      if (found) return answer(200, undefined, found);
      return listing ? answer(404, 'NoSuchKey') : answer(403, 'AccessDenied');
    }
    if (method === 'DELETE') {
      objects.delete(key);
      return answer(204);
    }
    return answer(405, 'MethodNotAllowed');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    requests,
    get badSignatures() {
      return state.badSignatures;
    },
    failNext(count, status = 503) {
      failures = count;
      failStatus = status;
    },
    hang(on) {
      hanging = on;
    },
    denyListing(on) {
      listing = !on;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
