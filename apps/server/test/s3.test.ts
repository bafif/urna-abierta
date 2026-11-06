import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EMPTY_SHA256, s3Client, signS3, uriEncode, type S3Signing } from '../src/s3.ts';
import { fakeS3 } from './fake-s3.ts';

// The examples of AWS's page "Signature Calculations for the Authorization Header: Transferring
// Payload in a Single Chunk", with its example keys, which open nothing.
const example = {
  host: 'examplebucket.s3.amazonaws.com',
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  date: '20130524T000000Z',
};
const authorization = (signedHeaders: string, signature: string) =>
  `AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=${signedHeaders},Signature=${signature}`;
const sign = (request: Omit<S3Signing, keyof typeof example>) => signS3({ ...example, ...request });

describe('Signature Version 4 for S3', () => {
  it('GET Object, with a range', () => {
    const signed = sign({ method: 'GET', path: '/test.txt', headers: { Range: 'bytes=0-9' }, payloadHash: EMPTY_SHA256 });
    expect(signed.canonicalRequest).toBe(
      ['GET', '/test.txt', '', 'host:examplebucket.s3.amazonaws.com', 'range:bytes=0-9', `x-amz-content-sha256:${EMPTY_SHA256}`, 'x-amz-date:20130524T000000Z', '', 'host;range;x-amz-content-sha256;x-amz-date', EMPTY_SHA256].join('\n'),
    );
    expect(signed.headers.authorization).toBe(authorization('host;range;x-amz-content-sha256;x-amz-date', 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'));
    expect(signed.headers['x-amz-content-sha256']).toBe(EMPTY_SHA256);
    expect(signed.headers['x-amz-date']).toBe('20130524T000000Z');
  });

  it('PUT Object, with a name that needs encoding and a body', () => {
    const body = 'Welcome to Amazon S3.';
    const payloadHash = createHash('sha256').update(body).digest('hex');
    expect(payloadHash).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
    const signed = sign({ method: 'PUT', path: '/test$file.text', headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' }, payloadHash });
    expect(signed.path).toBe('/test%24file.text');
    expect(signed.headers.authorization).toBe(authorization('date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class', '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd'));
  });

  it('GET Bucket Lifecycle: a parameter without a value', () => {
    const signed = sign({ method: 'GET', path: '/', query: { lifecycle: '' }, payloadHash: EMPTY_SHA256 });
    expect(signed.query).toBe('lifecycle=');
    expect(signed.headers.authorization).toBe(authorization('host;x-amz-content-sha256;x-amz-date', 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543'));
  });

  it('GET Bucket (List Objects): parameters sorted by name', () => {
    const signed = sign({ method: 'GET', path: '/', query: { prefix: 'J', 'max-keys': '2' }, payloadHash: EMPTY_SHA256 });
    expect(signed.query).toBe('max-keys=2&prefix=J');
    expect(signed.headers.authorization).toBe(authorization('host;x-amz-content-sha256;x-amz-date', '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7'));
  });

  it('sorts by name before value, signs a session token, and encodes the way S3 asks', () => {
    expect(sign({ method: 'GET', path: '/', query: { 'a-b': '1', a: '2' }, payloadHash: EMPTY_SHA256 }).query).toBe('a=2&a-b=1');
    const withToken = sign({ method: 'GET', path: '/x', payloadHash: EMPTY_SHA256, sessionToken: 'token de prueba' });
    expect(withToken.headers['x-amz-security-token']).toBe('token de prueba');
    expect(withToken.headers.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token,');
    expect(uriEncode('fotos/año 2027+más~ok', false)).toBe('fotos/a%C3%B1o%202027%2Bm%C3%A1s~ok');
    expect(uriEncode('a/b')).toBe('a%2Fb');
    // Never normalized: two slashes are part of the name.
    expect(sign({ method: 'GET', path: '/b//x', payloadHash: EMPTY_SHA256 }).path).toBe('/b//x');
  });
});

describe('the S3 client', () => {
  const credentials = { region: 'us-east-1', accessKeyId: 'prueba', secretAccessKey: 'secreto de prueba' };

  it('puts, gets and deletes, signed, and tries again when the provider is busy', async () => {
    const server = await fakeS3(credentials);
    try {
      const client = s3Client({ ...credentials, endpoint: server.endpoint, bucket: 'fotos-prueba' }, { wait: async () => undefined });
      server.failNext(2, 503);
      await client.put('a/b', Buffer.from('hola'));
      expect(server.requests.filter((r) => r.method === 'PUT')).toHaveLength(3);
      expect(server.objects.get('/fotos-prueba/a/b')?.toString()).toBe('hola');
      expect((await client.get('a/b'))?.toString()).toBe('hola');
      expect(await client.get('no-existe')).toBeNull();
      await client.delete('a/b');
      expect(server.objects.size).toBe(0);
      expect(server.badSignatures).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('gives up after a few tries, and does not take a missing bucket for a missing photo', async () => {
    const server = await fakeS3(credentials);
    try {
      const client = s3Client({ ...credentials, endpoint: server.endpoint, bucket: 'fotos-prueba' }, { wait: async () => undefined });
      server.failNext(10, 500);
      await expect(client.put('x', Buffer.from('x'))).rejects.toThrow(/500/);
      expect(server.requests).toHaveLength(3);
      server.failNext(0);
      const otherBucket = s3Client({ ...credentials, endpoint: server.endpoint, bucket: 'no-existe' });
      await expect(otherBucket.get('x')).rejects.toThrow(/NoSuchBucket/);
      const wrongKey = s3Client({ ...credentials, secretAccessKey: 'otra', endpoint: server.endpoint, bucket: 'fotos-prueba' });
      await expect(wrongKey.put('x', Buffer.from('x'))).rejects.toThrow(/SignatureDoesNotMatch/);
    } finally {
      await server.close();
    }
  });

  it('when the request does not even get there, it says why, and never the keys or the signature', async () => {
    // A port that was just freed: nothing listens there.
    const closed = await fakeS3(credentials);
    const endpoint = closed.endpoint;
    await closed.close();
    const refused = s3Client({ ...credentials, endpoint, bucket: 'fotos-prueba' }, { attempts: 1 });
    const error = await refused.put('x', Buffer.from('x')).then(() => null, (failure: Error) => failure);
    expect(error?.message).toMatch(/^PUT: fetch failed \(.*ECONNREFUSED/);
    expect(error?.message).not.toContain(credentials.secretAccessKey);
    expect(error?.message).not.toContain('Signature');

    // What Node's fetch says for a name that does not exist, a certificate it does not trust, and two addresses that both refuse.
    const failing = (cause: Error) => s3Client({ ...credentials, endpoint: 'https://no-existe.invalid', bucket: 'fotos-prueba' }, {
      attempts: 1,
      fetch: async () => Promise.reject(new TypeError('fetch failed', { cause })),
    });
    const withCode = (error: Error, code: string) => Object.assign(error, { code });
    await expect(failing(withCode(new Error('getaddrinfo ENOTFOUND no-existe.invalid'), 'ENOTFOUND')).get('x')).rejects.toThrow('GET: fetch failed (getaddrinfo ENOTFOUND no-existe.invalid)');
    await expect(failing(withCode(new Error('self-signed certificate'), 'DEPTH_ZERO_SELF_SIGNED_CERT')).put('x', Buffer.from('x'))).rejects.toThrow('PUT: fetch failed (DEPTH_ZERO_SELF_SIGNED_CERT: self-signed certificate)');
    const both = withCode(new AggregateError([new Error('connect ECONNREFUSED ::1:9000'), new Error('connect ECONNREFUSED 127.0.0.1:9000')], ''), 'ECONNREFUSED');
    await expect(failing(both).delete('x')).rejects.toThrow('DELETE: fetch failed (connect ECONNREFUSED ::1:9000; connect ECONNREFUSED 127.0.0.1:9000)');
    await expect(failing(new Error('')).get('x')).rejects.toThrow(/^GET: fetch failed$/);
  });

  it('a provider that does not answer in time counts as a failure, not as a hang', async () => {
    const server = await fakeS3(credentials);
    try {
      server.hang(true);
      const client = s3Client({ ...credentials, endpoint: server.endpoint, bucket: 'fotos-prueba' }, { timeoutMs: 100, attempts: 2, wait: async () => undefined });
      await expect(client.get('x')).rejects.toThrow();
      expect(server.requests).toHaveLength(2);
    } finally {
      await server.close();
    }
  });
});
