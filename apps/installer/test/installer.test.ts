import { execFileSync } from 'node:child_process';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { awsCloud, signAws } from '../src/clouds/aws.ts';
import { googleCloud, signGoogleAssertion } from '../src/clouds/google.ts';
import { oracleCloud, signOracle } from '../src/clouds/oracle.ts';
import { CloudFailure, createInCloud, uploadTheme, waitForHealth } from '../src/job.ts';
import { newSecrets, renderScript, siteFor, withoutComments } from '../src/settings.ts';
import { installerTexts } from './texts.ts';

const noWait = async () => undefined;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

describe('the script that installs a server', () => {
  const settings = { secrets: newSecrets(), site: 'https://203.0.113.24', cert: 'ip' as const, theme: 'aula' };

  it('carries everything in one block, within what clouds accept', () => {
    const script = renderScript(settings);
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain('URNA_SITE=https://203.0.113.24');
    expect(script).toContain(settings.secrets.recoveryKey);
    expect(Buffer.byteLength(script)).toBeLessThan(16 * 1024);
  });

  it('tells the server the language of the screens, which its commands answer in', () => {
    expect(renderScript({ ...settings, language: 'en' }).split('\n')).toContain('URNA_IDIOMA=en');
    expect(renderScript({ ...settings, language: 'es' }).split('\n')).toContain('URNA_IDIOMA=es');
    // Without one, the server follows its own system.
    expect(renderScript(settings).split('\n').filter((line) => line.startsWith('URNA_IDIOMA=') && line !== 'URNA_IDIOMA=$URNA_IDIOMA')).toEqual([]);
  });

  it('takes the commands of the server from the server image, where its build puts them', () => {
    const script = renderScript(settings);
    expect(script).not.toContain('URNA_SCRIPT');
    expect(script).toContain('"$URNA_IMAGE_SERVER" /app/urna');
    const containerfile = readFileSync(new URL('../../../deploy/server.Containerfile', import.meta.url), 'utf8');
    expect(containerfile).toMatch(/^WORKDIR \/app$/m);
    expect(containerfile).toMatch(/^COPY deploy\/server\/urna urna$/m);
  });

  it('asks the server by the address of its site, the one its certificate is for, also when nobody names it', () => {
    const urna = readFileSync(new URL('../../../deploy/server/urna', import.meta.url), 'utf8');
    const siteAddress = /^site_address\(\) \{.*\}$/m.exec(urna)?.[0] ?? '';
    const address = (site: string) => execFileSync('sh', ['-c', `${siteAddress}\nsite_address`], { env: { URNA_SITE: site } }).toString();
    expect(address('https://203.0.113.24')).toBe('203.0.113.24');
    expect(address('urna.example.org')).toBe('urna.example.org');
    expect(address('https://localhost')).toBe('localhost');
    // Its health and «urna estado» ask this machine, but by that address: Caddy answers no other.
    expect(urna).toMatch(/^health=\$\{URNA_HEALTH_URL:-https:\/\/\$\(site_address\)\/api\/health\}$/m);
    expect(urna).toMatch(/^ask_here\(\) \{ curl -fsk --connect-to ::localhost: "\$@"; \}$/m);
    expect(urna.match(/curl -fsk[^\n]*\$health/g)).toBeNull();
    // A browser that opens a bare IP address sends no name: Caddy answers it as that address.
    expect(urna).toContain('-e URNA_SNI="$(site_address)"');
    const caddyfile = readFileSync(new URL('../../../deploy/Caddyfile', import.meta.url), 'utf8');
    expect(caddyfile).toMatch(/^\tdefault_sni \{\$URNA_SNI:localhost\}$/m);
  });

  it('starts through systemd without waiting for the certificate, and waits and makes the first backup apart', () => {
    const installer = readFileSync(new URL('../../../deploy/server/instalar.sh', import.meta.url), 'utf8');
    const urna = readFileSync(new URL('../../../deploy/server/urna', import.meta.url), 'utf8');
    // A wait inside the unit would make systemd stop every container when the certificate is slow.
    expect(installer).toContain('ExecStart=$home/urna arrancar sin-esperar\n');
    expect(urna).toContain('[ "${2:-}" = sin-esperar ] && exit 0');
    // Slow is not broken: the installer says it is still waiting, and only a server that stops right away fails it.
    expect(installer).toMatch(/run_as_urna "\$home\/urna" arrancar \|\| answered=\$\?\ncase "\$answered" in\n  0\) say "ready \$URNA_SITE" ;;\n  3\) say "still_waiting \$URNA_SITE" ;;\n  \*\) exit 1 ;;\n/);
    expect(urna).toMatch(/\[ "\$answered" = 2 \] \|\| first_backup\n/);
    // A backup is only one under its own name once it is whole.
    expect(urna).toContain('mv "$partial" "$home/copias/urna-$stamp.tar.gpg"');
  });

  it('leaves out comment lines, but keeps the top block and what goes inside files', () => {
    const script = withoutComments(['#!/bin/sh', '# help line', 'set -eu', '# a note', '  # an indented note', 'cat >f <<EOF', '# inside the file', 'EOF', 'echo ok # stays'].join('\n'));
    expect(script.split('\n')).toEqual(['#!/bin/sh', '# help line', 'set -eu', 'cat >f <<EOF', '# inside the file', 'EOF', 'echo ok # stays']);
    const block = renderScript(settings);
    expect(block).toContain('# Fotos en un almacenamiento S3');
    expect(execFileSync('sh', ['-n'], { input: block }).toString()).toBe('');
  });

  it('carries no key that opens data, and the setup code only as its hash: a cloud keeps the block where its console shows it', () => {
    const local = { ...settings.secrets, postgresPassword: 'f'.repeat(48), fieldKey: 'e'.repeat(64) };
    const script = renderScript({ ...settings, secrets: local });
    // The database password and the field key are made on the server.
    expect(script.split('\n').filter((line) => /^(POSTGRES_PASSWORD|URNA_FIELD_KEY|URNA_SETUP_CODE)=[^$]/.test(line))).toEqual([]);
    for (const value of [local.postgresPassword, local.fieldKey, local.setupCode]) expect(script).not.toContain(value);
    expect(script).toContain(`URNA_SETUP_CODE_HASH=${createHash('sha256').update(settings.secrets.setupCode).digest('hex')}\n`);
    expect(script).toMatch(/openssl rand -hex 24/);
    expect(script).toMatch(/openssl rand -hex 32/);
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
    // An answer can carry its status, for errors.
    const failed = value instanceof Failure ? value : null;
    const shown = failed ? failed.body : value;
    const text = typeof shown === 'string' ? shown : JSON.stringify(shown ?? {});
    return new Response(text, { status: failed?.status ?? 200 });
  }) as typeof fetch;
  return { request, calls };
}

class Failure {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    this.status = status;
    this.body = body;
  }
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

describe('when creating a server fails, nothing is left charging', () => {
  const secrets = newSecrets();
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as CloudFailure;
    }
    throw new Error('it did not fail');
  };

  it('Oracle: without capacity anywhere, deletes the network and the address, newest first', async () => {
    const deleted = new Set<string>();
    const { request, calls } = fakeCloud((url, method) => {
      const last = url.pathname.split('/').pop()!;
      if (method === 'DELETE') {
        deleted.add(url.pathname);
        return {};
      }
      if (method === 'GET' && deleted.has(url.pathname)) return { lifecycleState: 'TERMINATED' };
      if (last === 'publicIps' && method === 'POST') return { id: 'ip-1', ipAddress: '203.0.113.7' };
      if (last === 'vcns') return { id: 'vcn-1', defaultRouteTableId: 'rt-1', defaultSecurityListId: 'sl-1' };
      if (last === 'internetGateways') return { id: 'igw-1' };
      if (last === 'subnets') return { id: 'subnet-1' };
      if (url.pathname.includes('/subnets/')) return { lifecycleState: 'AVAILABLE' };
      if (last === 'availabilityDomains') return [{ name: 'AD-1' }];
      if (last === 'images') return [{ id: 'image-1' }];
      if (last === 'instances' && method === 'POST') return new Failure(500, { code: 'InternalError', message: 'Out of host capacity.' });
      return {};
    });
    const cloud = oracleCloud({ region: 'sa-saopaulo-1', tenancy: 'ocid1.tenancy', user: 'ocid1.user', fingerprint: 'aa', privateKey }, request, noWait);
    const lines: string[] = [];
    const error = await failure(createInCloud(cloud, secrets, 'aula', (line) => lines.push(line)));
    expect(error).toBeInstanceOf(CloudFailure);
    expect(error.message).toMatch(/^oracle_no_capacity/);
    expect(error.left).toEqual([]);
    expect(lines).toContain('cleanup');
    const undone = calls.filter((call) => call.method === 'DELETE' || (call.method === 'PUT' && call.url.pathname.includes('/routeTables/') && JSON.parse(call.body).routeRules.length === 0));
    expect(undone.map((call) => `${call.method} ${call.url.pathname.split('/').slice(-2).join('/')}`)).toEqual([
      'DELETE subnets/subnet-1', 'PUT routeTables/rt-1', 'DELETE internetGateways/igw-1', 'DELETE vcns/vcn-1', 'DELETE publicIps/ip-1',
    ]);
  });

  it('AWS: a machine that never starts is terminated before its firewall goes, and what does not go is reported', async () => {
    const { request, calls } = fakeCloud((_url, _method, body) => {
      const action = new URLSearchParams(body).get('Action');
      const terminated = calls.some((call) => new URLSearchParams(call.body).get('Action') === 'TerminateInstances');
      const answers: Record<string, string | Failure> = {
        AllocateAddress: '<r><publicIp>203.0.113.9</publicIp><allocationId>eipalloc-1</allocationId></r>',
        DescribeVpcs: '<r><vpcId>vpc-1</vpcId></r>',
        DescribeSubnets: '<r><subnetId>subnet-1</subnetId></r>',
        CreateSecurityGroup: '<r><groupId>sg-1</groupId></r>',
        DescribeImages: '<r><item><imageId>ami-1</imageId><creationDate>2026-01-01</creationDate></item></r>',
        RunInstances: '<r><instanceId>i-1</instanceId></r>',
        DescribeInstances: terminated ? '<r><instanceState><code>48</code><name>terminated</name></instanceState></r>' : '<r><instanceState><code>0</code><name>pending</name></instanceState></r>',
        DeleteSecurityGroup: new Failure(400, '<r><Code>DependencyViolation</Code><Message>in use</Message></r>'),
      };
      return answers[action!] ?? '<r/>';
    });
    const cloud = awsCloud({ region: 'sa-east-1', accessKeyId: 'AK', secretAccessKey: 'SK' }, request, noWait);
    const error = await failure(createInCloud(cloud, secrets, 'aula', () => undefined));
    expect(error.message).toBe('aws_server_did_not_start');
    const after = calls.map((call) => new URLSearchParams(call.body).get('Action')).slice(calls.findIndex((call) => new URLSearchParams(call.body).get('Action') === 'TerminateInstances'));
    expect(after).toEqual(['TerminateInstances', 'DescribeInstances', 'DeleteSecurityGroup', 'ReleaseAddress']);
    expect(error.left).toEqual(['security-group sg-1']);
  });

  it('Google: deletes the machine, the firewall and the address; when it could not even log in, there is nothing to delete', async () => {
    const { request, calls } = fakeCloud((url, method) => {
      if (url.host === 'oauth2.googleapis.com') return { access_token: 'token-1' };
      if (url.pathname.includes('/operations/op-instance')) return { status: 'DONE', error: { errors: [{ message: 'ZONE_RESOURCE_POOL_EXHAUSTED' }] } };
      if (url.pathname.includes('/operations/')) return { status: 'DONE' };
      if (url.pathname.includes('/addresses/') && method === 'GET') return { address: '203.0.113.5' };
      const operation = method === 'POST' && url.pathname.endsWith('/instances') ? 'op-instance' : 'op-1';
      return { selfLink: `https://compute.googleapis.com/compute/v1/projects/p/operations/${operation}` };
    });
    const cloud = googleCloud({ client_email: 'a@b.iam', private_key: privateKey, project_id: 'p' }, request, noWait);
    const error = await failure(createInCloud(cloud, secrets, 'aula', () => undefined));
    expect(error.message).toMatch(/ZONE_RESOURCE_POOL_EXHAUSTED/);
    expect(error.left).toEqual([]);
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url.pathname.split('/').slice(-2).join('/'))).toEqual([
      expect.stringMatching(/^instances\/urna-abierta-/), expect.stringMatching(/^firewalls\/urna-abierta-/), expect.stringMatching(/^addresses\/urna-abierta-/),
    ]);

    const refused = fakeCloud(() => new Failure(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }));
    const login = await failure(createInCloud(googleCloud({ client_email: 'a@b.iam', private_key: privateKey, project_id: 'p' }, refused.request, noWait), secrets, 'aula', () => undefined));
    expect(login.message).toMatch(/^google_login/);
    // Null, not empty: the failure screen says that what was created got deleted only when something was.
    expect(login.left).toBeNull();
    expect(refused.calls.filter((call) => call.method === 'DELETE')).toEqual([]);
  });

  it('wrong keys create nothing, so there is nothing to delete or to report', async () => {
    const refused = fakeCloud(() => new Failure(401, { code: 'NotAuthenticated', message: 'The required information to complete authentication was not provided.' }));
    const lines: string[] = [];
    const cloud = oracleCloud({ region: 'sa-saopaulo-1', tenancy: 'ocid1.tenancy', user: 'ocid1.user', fingerprint: 'aa', privateKey }, refused.request, noWait);
    const error = await failure(createInCloud(cloud, secrets, 'aula', (line) => lines.push(line)));
    expect(error.message).toMatch(/NotAuthenticated/);
    expect(error.left).toBeNull();
    expect(lines).not.toContain('cleanup');
    expect(refused.calls.filter((call) => call.method === 'DELETE')).toEqual([]);
  });
});

describe('what the failure screen says', () => {
  const ui = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  const patterns = new Function(`return ${/const WHY = (\[[\s\S]*?\n {2}\]);/.exec(ui)![1]}`)() as [RegExp, string][];
  const why = (problem: string) => patterns.find(([pattern]) => pattern.test(problem))?.[1] ?? 'unknown';
  const texts = installerTexts();
  const keys = (language: 'es' | 'en') => new Set(Object.keys(texts[language]));

  it('explains the usual failures from what the clouds, SSH and the server say', () => {
    expect(why('oracle_no_capacity: oracle_POST_instances: InternalError Out of host capacity.')).toBe('oracle_capacity');
    expect(why('oracle_POST_vcns: NotAuthenticated The required information to complete authentication was not provided.')).toBe('oracle_auth');
    expect(why('oracle_POST_publicIps: NotAuthorizedOrNotFound Authorization failed or requested resource not found.')).toBe('oracle_region');
    expect(why('aws_AllocateAddress: AuthFailure AWS was not able to validate the provided access credentials')).toBe('aws_auth');
    expect(why('aws_RunInstances: UnauthorizedOperation You are not authorized to perform this operation.')).toBe('aws_permission');
    expect(why('aws_AllocateAddress: AddressLimitExceeded The maximum number of addresses has been reached.')).toBe('aws_limit');
    expect(why('aws_no_default_network')).toBe('aws_network');
    expect(why('google_login: Invalid JWT Signature.')).toBe('google_auth');
    expect(why('google_POST: Compute Engine API has not been used in project 123 before or it is disabled.')).toBe('google_api');
    expect(why('google_POST: This API method requires billing to be enabled.')).toBe('google_billing');
    expect(why('google_operation: ZONE_RESOURCE_POOL_EXHAUSTED')).toBe('google_capacity');
    expect(why('aws_server_did_not_start')).toBe('slow_cloud');
    expect(why('script_failed: urna-abierta: needs_supported_linux')).toBe('needs_supported_linux');
    expect(why('script_failed: E: Could not get lock /var/lib/dpkg/lock-frontend')).toBe('apt');
    expect(why('script_failed: Error: something else | exit')).toBe('script');
    expect(why('All configured authentication methods failed')).toBe('ssh');
    expect(why('connect ECONNREFUSED 203.0.113.24:22')).toBe('ssh');
    expect(why('Command failed: podman pull ghcr.io/bafif/urna-abierta-server:latest\nError: unauthorized')).toBe('pull');
    expect(why('no_engine')).toBe('no_engine');
    expect(why('algo que nadie esperaba')).toBe('unknown');
  });

  it('has every explanation and every server step in both languages', () => {
    const es = keys('es');
    const en = keys('en');
    for (const name of [...new Set(patterns.map(([, key]) => key)), 'unknown']) {
      expect(es.has(`why.${name}`), `why.${name} en castellano`).toBe(true);
      expect(en.has(`why.${name}`), `why.${name} in English`).toBe(true);
    }
    const steps = [...readFileSync(new URL('../../../deploy/server/instalar.sh', import.meta.url), 'utf8').matchAll(/\bsay '(\w+)'|\bsay "(\w+) /g)].map((match) => match[1] ?? match[2]);
    expect(steps.length).toBeGreaterThan(5);
    for (const step of steps.filter((each) => each !== 'needs_supported_linux')) {
      expect(es.has(`server.${step}`), `server.${step} en castellano`).toBe(true);
      expect(en.has(`server.${step}`), `server.${step} in English`).toBe(true);
    }
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

describe('the files a release publishes', () => {
  it('every installer file that a doc or a page names is one that the build publishes', () => {
    const root = new URL('../../../', import.meta.url);
    const build = readFileSync(new URL('apps/installer/build.mjs', root), 'utf8');
    const friendly = new Function(`return ${/const FRIENDLY = (\{[^}]*\});/.exec(build)![1]}`)() as Record<string, string>;
    // As build.mjs packs each one: Windows as it is, macOS in a .zip and Linux in a .tar.gz. Each one with its SHA-256 next to it.
    const published = Object.entries(friendly).map(([platform, name]) => `urna-abierta-instalador-${name}${platform.startsWith('win32') ? '.exe' : platform.startsWith('darwin') ? '.zip' : '.tar.gz'}`);
    const allowed = new Set(published.flatMap((name) => [name, `${name}.sha256`]));
    expect(published).toContain('urna-abierta-instalador-windows.exe');
    const named: string[] = [];
    for (const folder of ['docs', 'landing']) {
      for (const file of readdirSync(new URL(`${folder}/`, root), { recursive: true }) as string[]) {
        if (!/\.(md|html)$/.test(file)) continue;
        const text = readFileSync(new URL(`${folder}/${file}`, root), 'utf8');
        for (const [name] of text.matchAll(/urna-abierta-instalador-[\w.-]*[A-Za-z0-9]/g)) named.push(`${folder}/${file}: ${name}`);
      }
    }
    for (const file of ['README.md', 'README.en.md']) {
      for (const [name] of readFileSync(new URL(file, root), 'utf8').matchAll(/urna-abierta-instalador-[\w.-]*[A-Za-z0-9]/g)) named.push(`${file}: ${name}`);
    }
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((each) => !allowed.has(each.split(': ')[1]!))).toEqual([]);
  });
});
