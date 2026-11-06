import { createSign, randomBytes } from 'node:crypto';
import { createdResources, sleep, type Cloud, type Log } from './common.ts';

/** The JSON file of a service account, as Google hands it over. */
export interface GoogleCredentials {
  client_email: string;
  private_key: string;
  project_id: string;
}

const REGION = 'us-central1';
const ZONE = `${REGION}-a`;
const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** The token that this account signs for itself, valid for one hour. */
export function signGoogleAssertion(credentials: GoogleCredentials, nowSeconds: number): string {
  const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/compute', aud: 'https://oauth2.googleapis.com/token', iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(credentials.private_key);
  return `${head}.${claims}.${base64url(signature)}`;
}

export function googleCloud(credentials: GoogleCredentials, request: typeof fetch = fetch, wait = sleep): Cloud {
  const project = `https://compute.googleapis.com/compute/v1/projects/${credentials.project_id}`;
  const suffix = randomBytes(3).toString('hex');
  let token = '';
  let reserved = '';
  const resources = createdResources();

  async function authorize(): Promise<void> {
    if (token) return;
    const assertion = signGoogleAssertion(credentials, Math.floor(Date.now() / 1000));
    const response = await request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`google_login: ${data.error_description ?? response.status}`);
    token = data.access_token;
  }

  async function call(method: string, address: string, payload?: object): Promise<any> {
    await authorize();
    const response = await request(address, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`google_${method}: ${data.error?.message ?? response.status}`);
    return data;
  }

  /** Every change returns an operation that has to end before the next one can use it. */
  async function finished(operation: { selfLink: string }): Promise<void> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const state = await call('GET', operation.selfLink);
      if (state.status === 'DONE') {
        if (state.error) throw new Error(`google_operation: ${state.error.errors?.[0]?.message ?? 'failed'}`);
        return;
      }
      await wait(3_000);
    }
    throw new Error('google_operation_timeout');
  }

  /** Deletes and waits for it. What is already gone counts as deleted. */
  async function remove(address: string): Promise<void> {
    try {
      await finished(await call('DELETE', address));
    } catch (error) {
      if (!/not found/i.test((error as Error).message)) throw error;
    }
  }

  return {
    async reserveAddress(log: Log) {
      log('address');
      reserved = `urna-abierta-${suffix}`;
      const name = reserved;
      const creating = await call('POST', `${project}/regions/${REGION}/addresses`, { name });
      // From here on it may exist even if the operation fails. It is charged by the hour, used or not.
      resources.add(`address ${name}`, () => remove(`${project}/regions/${REGION}/addresses/${name}`));
      await finished(creating);
      return (await call('GET', `${project}/regions/${REGION}/addresses/${reserved}`)).address;
    },

    async createServer(script: string, log: Log) {
      log('network');
      const firewall = await call('POST', `${project}/global/firewalls`, {
        name: `urna-abierta-${suffix}`,
        network: 'global/networks/default',
        allowed: [{ IPProtocol: 'tcp', ports: ['22', '80', '443'] }, { IPProtocol: 'udp', ports: ['443'] }],
        sourceRanges: ['0.0.0.0/0'],
        targetTags: ['urna-abierta'],
      });
      resources.add(`firewall urna-abierta-${suffix}`, () => remove(`${project}/global/firewalls/urna-abierta-${suffix}`));
      await finished(firewall);
      log('server');
      const address = (await call('GET', `${project}/regions/${REGION}/addresses/${reserved}`)).address;
      const instance = await call('POST', `${project}/zones/${ZONE}/instances`, {
        name: `urna-abierta-${suffix}`,
        machineType: `zones/${ZONE}/machineTypes/e2-micro`,
        tags: { items: ['urna-abierta'] },
        disks: [{ boot: true, autoDelete: true, initializeParams: { sourceImage: 'projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64', diskSizeGb: '30', diskType: `zones/${ZONE}/diskTypes/pd-standard` } }],
        networkInterfaces: [{ network: 'global/networks/default', accessConfigs: [{ type: 'ONE_TO_ONE_NAT', natIP: address }] }],
        metadata: { items: [{ key: 'user-data', value: script }] },
      });
      resources.add(`instance urna-abierta-${suffix}`, () => remove(`${project}/zones/${ZONE}/instances/urna-abierta-${suffix}`));
      await finished(instance);
    },

    cleanUp: (log: Log) => resources.cleanUp(log),
  };
}
