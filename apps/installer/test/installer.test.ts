import { execFileSync } from 'node:child_process';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { awsCloud, signAws } from '../src/clouds/aws.ts';
import { googleCloud, signGoogleAssertion } from '../src/clouds/google.ts';
import { oracleCloud, signOracle } from '../src/clouds/oracle.ts';
import { uploadTheme, waitForHealth } from '../src/job.ts';
import { newSecrets, renderScript, siteFor, withoutComments } from '../src/settings.ts';

const noWait = async () => undefined;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

describe('the script that installs a server', () => {
  const settings = { secrets: newSecrets(), site: 'https://203.0.113.24', cert: 'ip' as const, theme: 'aula' };

  it('carries everything in one block, within what clouds accept', () => {
    const script = renderScript(settings);
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain('URNA_SITE=https://203.0.113.24');
    expect(script).toContain(settings.secrets.recoveryKey);
    expect(script).toContain('URNA_SCRIPT');
    expect(Buffer.byteLength(script)).toBeLessThan(16 * 1024);
  });

  it('leaves out comment lines, but keeps the help of urna and what goes inside files', () => {
    const script = withoutComments(['#!/bin/sh', '# help line', 'set -eu', '# a note', '  # an indented note', 'cat >f <<EOF', '# inside the file', 'EOF', 'echo ok # stays'].join('\n'));
    expect(script.split('\n')).toEqual(['#!/bin/sh', '# help line', 'set -eu', 'cat >f <<EOF', '# inside the file', 'EOF', 'echo ok # stays']);
    const block = renderScript(settings);
    expect(block).toContain('urna estado');
    expect(block).toContain('# Fotos en un almacenamiento S3');
    expect(execFileSync('sh', ['-n'], { input: block }).toString()).toBe('');
  });

  it('never lets a strange value into the script', () => {
    expect(() => renderScript({ ...settings, theme: 'aula; rm -rf /' })).toThrow(/unsafe/);
    expect(() => renderScript({ ...settings, site: 'https://x$(reboot)' })).toThrow(/unsafe/);
  });

  it('makes keys that are long and hard to confuse', () => {
    const a = newSecrets();
    expect(a.recoveryKey).toMatch(/^[A-HJKMNP-Z2-9]{5}(-[A-HJKMNP-Z2-9]{5}){4}$/);
    expect(a.recoveryKey).not.toBe(newSecrets().recoveryKey);
  });

  it('understands an address however a person writes it', () => {
    expect(siteFor(' 203.0.113.24 ')).toEqual({ site: 'https://203.0.113.24', cert: 'ip', url: 'https://203.0.113.24' });
    expect(siteFor('https://urna.example.org/')).toEqual({ site: 'urna.example.org', cert: 'auto', url: 'https://urna.example.org' });
    expect(() => siteFor('no es una dirección')).toThrow();
    expect(() => siteFor('203.0.113.24; reboot')).toThrow();
  });
});

describe('signatures of each cloud', () => {
  it('signs for AWS exactly like its published test suite', () => {
    // The "get-vanilla" case of the AWS Signature Version 4 test suite.
    const authorization = signAws({
      method: 'GET', host: 'example.amazonaws.com', path: '/', headers: {}, body: '', region: 'us-east-1', service: 'service',
      accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', amzDate: '20150830T123600Z',
    });
    expect(authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  it('signs for Oracle what its documentation asks for, and the signature checks out', () => {
    const credentials = { region: 'sa-saopaulo-1', tenancy: 'ocid1.tenancy', user: 'ocid1.user', fingerprint: 'aa:bb', privateKey };
    const url = new URL('https://iaas.sa-saopaulo-1.oraclecloud.com/20160918/vcns?x=1');
    const body = '{"a":1}';
    const headers = signOracle({ method: 'POST', url, body, date: 'Thu, 05 Nov 2026 12:00:00 GMT', credentials });
    expect(headers.authorization).toContain('keyId="ocid1.tenancy/ocid1.user/aa:bb"');
    expect(headers.authorization).toContain('headers="date (request-target) host content-length content-type x-content-sha256"');
    const signature = /signature="([^"]+)"/.exec(headers.authorization!)![1]!;
    const signed = [`date: ${headers.date}`, '(request-target): post /20160918/vcns?x=1', `host: ${url.host}`, 'content-length: 7', 'content-type: application/json', `x-content-sha256: ${headers['x-content-sha256']}`].join('\n');
    expect(createVerify('RSA-SHA256').update(signed).verify(publicKey, signature, 'base64')).toBe(true);
  });

  it('signs for Google a token that checks out', () => {
    const assertion = signGoogleAssertion({ client_email: 'a@b.iam', private_key: privateKey, project_id: 'p' }, 1_800_000_000);
    const [head, claims, signature] = assertion.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({ iss: 'a@b.iam', aud: 'https://oauth2.googleapis.com/token', exp: 1_800_003_600 });
    expect(createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });
});

/** A cloud that answers with what its documentation says, and remembers what it was asked. */
function fakeCloud(answer: (url: URL, method: string, body: string) => unknown) {
  const calls: { url: URL; method: string; body: string; headers: Headers }[] = [];
  const request = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const body = String(init.body ?? '');
    calls.push({ url, method: init.method ?? 'GET', body, headers: new Headers(init.headers) });
    const value = answer(url, init.method ?? 'GET', body);
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? {});
    return new Response(text, { status: 200 });
  }) as typeof fetch;
  return { request, calls };
}

describe('creating a server, against a fake of each cloud', () => {
  it('AWS: fixed address first, firewall, the newest Ubuntu, and then the address on the machine', async () => {
    const { request, calls } = fakeCloud((_url, _method, body) => {
      const action = new URLSearchParams(body).get('Action');
      const answers: Record<string, string> = {
        AllocateAddress: '<r><publicIp>203.0.113.9</publicIp><allocationId>eipalloc-1</allocationId></r>',
        DescribeVpcs: '<r><vpcId>vpc-1</vpcId></r>',
        DescribeSubnets: '<r><subnetId>subnet-1</subnetId></r>',
        CreateSecurityGroup: '<r><groupId>sg-1</groupId></r>',
        DescribeImages: '<r><item><imageId>ami-old</imageId><creationDate>2025-01-01</creationDate></item><item><imageId>ami-new</imageId><creationDate>2026-01-01</creationDate></item></r>',
        RunInstances: '<r><instanceId>i-1</instanceId></r>',
        DescribeInstances: '<r><instanceState><code>16</code><name>running</name></instanceState></r>',
      };
      return answers[action!] ?? '<r/>';
    });
    const cloud = awsCloud({ region: 'sa-east-1', accessKeyId: 'AK', secretAccessKey: 'SK' }, request, noWait);
    expect(await cloud.reserveAddress(() => undefined)).toBe('203.0.113.9');
    await cloud.createServer('#!/bin/sh\necho hola\n', () => undefined);
    const actions = calls.map((call) => new URLSearchParams(call.body).get('Action'));
    expect(actions).toEqual(['AllocateAddress', 'DescribeVpcs', 'DescribeSubnets', 'CreateSecurityGroup', 'AuthorizeSecurityGroupIngress', 'DescribeImages', 'RunInstances', 'DescribeInstances', 'AssociateAddress']);
    const run = new URLSearchParams(calls[6]!.body);
    expect(run.get('ImageId')).toBe('ami-new');
    expect(Buffer.from(run.get('UserData')!, 'base64').toString()).toContain('echo hola');
    expect(calls[0]!.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\//);
    expect(calls[0]!.url.host).toBe('ec2.sa-east-1.amazonaws.com');
  });

  it('Oracle: when a zone is out of stock it tries the next one, and ends with the fixed address on the machine', async () => {
    let attempts = 0;
    const answer = (url: URL, method: string) => {
      const last = url.pathname.split('/').pop()!;
      if (last === 'publicIps' && method === 'POST') return { id: 'ip-1', ipAddress: '203.0.113.7' };
      if (last === 'vcns') return { id: 'vcn-1', defaultRouteTableId: 'rt-1', defaultSecurityListId: 'sl-1' };
      if (last === 'internetGateways') return { id: 'igw-1' };
      if (last === 'subnets') return { id: 'subnet-1' };
      if (url.pathname.includes('/subnets/')) return { lifecycleState: 'AVAILABLE' };
      if (last === 'availabilityDomains') return [{ name: 'AD-1' }, { name: 'AD-2' }];
      if (last === 'images') return [{ id: 'image-1' }];
      if (last === 'instances' && method === 'POST') return { id: 'i-1' };
      if (url.pathname.includes('/instances/')) return { lifecycleState: 'RUNNING' };
      if (last === 'vnicAttachments') return [{ vnicId: 'vnic-1' }];
      if (last === 'privateIps') return [{ id: 'priv-1' }];
      return {};
    };
    const { request: plain, calls } = fakeCloud(answer);
    const request = (async (input: any, init: any = {}) => {
      if (String(input).endsWith('/instances') && init.method === 'POST') {
        attempts += 1;
        if (attempts === 1) {
          await plain(input, init);
          return new Response(JSON.stringify({ code: 'InternalError', message: 'Out of host capacity.' }), { status: 500 });
        }
      }
      return plain(input, init);
    }) as typeof fetch;
    const cloud = oracleCloud({ region: 'sa-saopaulo-1', tenancy: 'ocid1.tenancy', user: 'ocid1.user', fingerprint: 'aa', privateKey }, request, noWait);
    expect(await cloud.reserveAddress(() => undefined)).toBe('203.0.113.7');
    await cloud.createServer('#!/bin/sh\necho hola\n', () => undefined);
    const launches = calls.filter((call) => call.url.pathname.endsWith('/instances') && call.method === 'POST').map((call) => JSON.parse(call.body));
    expect(launches.map((item) => item.availabilityDomain)).toEqual(['AD-1', 'AD-2']);
    expect(Buffer.from(launches[1].metadata.user_data, 'base64').toString()).toContain('echo hola');
    const attach = calls.find((call) => call.url.pathname.endsWith('/publicIps/ip-1'))!;
    expect(JSON.parse(attach.body)).toEqual({ privateIpId: 'priv-1' });
    const rules = JSON.parse(calls.find((call) => call.url.pathname.includes('/securityLists/'))!.body).ingressSecurityRules;
    expect(rules.map((rule: any) => (rule.tcpOptions ?? rule.udpOptions).destinationPortRange.min)).toEqual([22, 80, 443, 443]);
  });

  it('Google: logs in, reserves, opens the firewall, and starts the machine with that address', async () => {
    const { request, calls } = fakeCloud((url) => {
      if (url.host === 'oauth2.googleapis.com') return { access_token: 'token-1' };
      if (url.pathname.includes('/operations/')) return { status: 'DONE' };
      if (url.pathname.includes('/addresses/')) return { address: '203.0.113.5' };
      return { selfLink: 'https://compute.googleapis.com/compute/v1/projects/p/operations/op-1' };
    });
    const cloud = googleCloud({ client_email: 'a@b.iam', private_key: privateKey, project_id: 'p' }, request, noWait);
    expect(await cloud.reserveAddress(() => undefined)).toBe('203.0.113.5');
    await cloud.createServer('#!/bin/sh\necho hola\n', () => undefined);
    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts.map((call) => call.url.pathname.split('/').pop())).toEqual(['token', 'addresses', 'firewalls', 'instances']);
    const instance = JSON.parse(posts[3]!.body);
    expect(instance.networkInterfaces[0].accessConfigs[0].natIP).toBe('203.0.113.5');
    expect(instance.metadata.items[0].value).toContain('echo hola');
    expect(posts[1]!.headers.get('authorization')).toBe('Bearer token-1');
  });
});

describe('sending the theme of a file', () => {
  it('goes with the installation code, and says when it could not', async () => {
    const { request, calls } = fakeCloud(() => ({ ok: true }));
    expect(await uploadTheme('https://203.0.113.9', 'codigo', { id: 'propio' }, request)).toBe(true);
    expect(calls[0]!.url.pathname).toBe('/api/setup/theme');
    expect(calls[0]!.method).toBe('PUT');
    expect(JSON.parse(calls[0]!.body)).toEqual({ code: 'codigo', theme: { id: 'propio' } });
    const refused = (async () => new Response('{}', { status: 409 })) as typeof fetch;
    expect(await uploadTheme('https://x', 'codigo', {}, refused)).toBe(false);
    const down = (async () => {
      throw new Error('no');
    }) as typeof fetch;
    expect(await uploadTheme('https://x', 'codigo', {}, down)).toBe(false);
  });
});

describe('waiting for the server', () => {
  it('waits until it answers, and gives up at the limit', async () => {
    let calls = 0;
    const answers = (async () => {
      calls += 1;
      if (calls === 1) return new Response('{}', { status: 200 });
      throw new Error('never');
    }) as typeof fetch;
    expect(await waitForHealth('https://x', () => undefined, 60_000, answers)).toBe(true);
    const never = (async () => {
      throw new Error('no');
    }) as typeof fetch;
    expect(await waitForHealth('https://x', () => undefined, 1, never)).toBe(false);
  }, 15_000);
});
