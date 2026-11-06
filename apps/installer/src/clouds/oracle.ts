import { createHash, createSign } from 'node:crypto';
import { createdResources, sleep, until, type Cloud, type Log } from './common.ts';

export interface OracleCredentials {
  region: string;
  tenancy: string;
  user: string;
  fingerprint: string;
  privateKey: string;
}

/** Oracle's request signature: an HTTP signature over the date, the target and, when sending, the body. */
export function signOracle(options: { method: string; url: URL; body?: string; date: string; credentials: OracleCredentials }): Record<string, string> {
  const { method, url, body, date, credentials } = options;
  const headers: Record<string, string> = { date, host: url.host };
  const names = ['date', '(request-target)', 'host'];
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(body));
    headers['x-content-sha256'] = createHash('sha256').update(body).digest('base64');
    names.push('content-length', 'content-type', 'x-content-sha256');
  }
  const line = (name: string) => (name === '(request-target)' ? `(request-target): ${method.toLowerCase()} ${url.pathname}${url.search}` : `${name}: ${headers[name]}`);
  const signature = createSign('RSA-SHA256').update(names.map(line).join('\n')).sign(credentials.privateKey, 'base64');
  const keyId = `${credentials.tenancy}/${credentials.user}/${credentials.fingerprint}`;
  headers.authorization = `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",headers="${names.join(' ')}",signature="${signature}"`;
  return headers;
}

const FREE_ARM = { shape: 'VM.Standard.A1.Flex', shapeConfig: { ocpus: 1, memoryInGBs: 6 } };
const FREE_X86 = { shape: 'VM.Standard.E2.1.Micro' };

export function oracleCloud(credentials: OracleCredentials, request: typeof fetch = fetch, wait = sleep): Cloud {
  const { region, tenancy } = credentials;
  const core = `https://iaas.${region}.oraclecloud.com/20160918`;
  const identity = `https://identity.${region}.oraclecloud.com/20160918`;
  let reservedId = '';
  const resources = createdResources();

  async function call(method: string, address: string, payload?: object): Promise<any> {
    const url = new URL(address);
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers = signOracle({ method, url, body, date: new Date().toUTCString(), credentials });
    const { host: _host, ...sent } = headers;
    const response = await request(url, { method, headers: sent, body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`oracle_${method}_${url.pathname.split('/').pop()}: ${data.code ?? response.status} ${data.message ?? ''}`);
    return data;
  }

  /** Deletes, and waits until it is gone: the network cannot go while the machine or the subnet are still in it. */
  async function remove(address: string, options = ''): Promise<void> {
    await call('DELETE', `${address}${options}`);
    await until(async () => {
      try {
        return (await call('GET', address)).lifecycleState === 'TERMINATED';
      } catch (error) {
        if (/: (404|NotAuthorizedOrNotFound) /.test((error as Error).message)) return true;
        throw error;
      }
    }, wait, { tries: 120, every: 5_000, problem: 'oracle_delete_timeout' });
  }

  async function imageFor(shape: string): Promise<string> {
    const query = new URLSearchParams({ compartmentId: tenancy, operatingSystem: 'Canonical Ubuntu', operatingSystemVersion: '24.04', shape, sortBy: 'TIMECREATED', sortOrder: 'DESC', limit: '1' });
    const [image] = await call('GET', `${core}/images?${query}`);
    if (!image) throw new Error('oracle_no_image');
    return image.id;
  }

  /** Free machines are often out of stock: it tries each zone with the better one, and then with the smaller. */
  async function launch(script: string, subnetId: string, log: Log): Promise<string> {
    const zones: { name: string }[] = await call('GET', `${identity}/availabilityDomains?compartmentId=${encodeURIComponent(tenancy)}`);
    let lastProblem = '';
    for (const kind of [FREE_ARM, FREE_X86]) {
      const imageId = await imageFor(kind.shape);
      for (const zone of zones) {
        log(`try:${kind.shape}:${zone.name}`);
        try {
          const instance = await call('POST', `${core}/instances`, {
            availabilityDomain: zone.name,
            compartmentId: tenancy,
            displayName: 'urna-abierta',
            ...kind,
            sourceDetails: { sourceType: 'image', imageId, bootVolumeSizeInGBs: 50 },
            createVnicDetails: { subnetId, assignPublicIp: false },
            metadata: { user_data: Buffer.from(script).toString('base64') },
          });
          resources.add(`instance ${instance.id}`, () => remove(`${core}/instances/${instance.id}`, '?preserveBootVolume=false'));
          return instance.id;
        } catch (error) {
          lastProblem = String((error as Error).message);
          if (!/capacity|LimitExceeded/i.test(lastProblem)) throw error;
        }
      }
    }
    throw new Error(`oracle_no_capacity: ${lastProblem}`);
  }

  return {
    async reserveAddress(log: Log) {
      log('address');
      const address = await call('POST', `${core}/publicIps`, { compartmentId: tenancy, lifetime: 'RESERVED', displayName: 'urna-abierta' });
      reservedId = address.id;
      resources.add(`publicIp ${address.ipAddress} ${address.id}`, () => call('DELETE', `${core}/publicIps/${address.id}`));
      return address.ipAddress;
    },

    async createServer(script: string, log: Log) {
      log('network');
      const vcn = await call('POST', `${core}/vcns`, { compartmentId: tenancy, cidrBlock: '10.0.0.0/16', displayName: 'urna-abierta' });
      resources.add(`vcn ${vcn.id}`, () => remove(`${core}/vcns/${vcn.id}`));
      const gateway = await call('POST', `${core}/internetGateways`, { compartmentId: tenancy, vcnId: vcn.id, isEnabled: true, displayName: 'urna-abierta' });
      // The route to it has to go first, or Oracle does not let it go.
      resources.add(`internetGateway ${gateway.id}`, async () => {
        await call('PUT', `${core}/routeTables/${vcn.defaultRouteTableId}`, { routeRules: [] });
        await remove(`${core}/internetGateways/${gateway.id}`);
      });
      await call('PUT', `${core}/routeTables/${vcn.defaultRouteTableId}`, { routeRules: [{ destination: '0.0.0.0/0', destinationType: 'CIDR_BLOCK', networkEntityId: gateway.id }] });
      const open = (protocol: string, port: number) => ({
        protocol,
        source: '0.0.0.0/0',
        [protocol === '6' ? 'tcpOptions' : 'udpOptions']: { destinationPortRange: { min: port, max: port } },
      });
      await call('PUT', `${core}/securityLists/${vcn.defaultSecurityListId}`, {
        ingressSecurityRules: [open('6', 22), open('6', 80), open('6', 443), open('17', 443)],
        egressSecurityRules: [{ protocol: 'all', destination: '0.0.0.0/0' }],
      });
      const subnet = await call('POST', `${core}/subnets`, { compartmentId: tenancy, vcnId: vcn.id, cidrBlock: '10.0.0.0/24', displayName: 'urna-abierta' });
      resources.add(`subnet ${subnet.id}`, () => remove(`${core}/subnets/${subnet.id}`));
      for (let attempt = 0; (await call('GET', `${core}/subnets/${subnet.id}`)).lifecycleState !== 'AVAILABLE'; attempt += 1) {
        if (attempt > 30) throw new Error('oracle_network_did_not_start');
        await wait(3_000);
      }

      log('server');
      const instanceId = await launch(script, subnet.id, log);
      for (let attempt = 0; (await call('GET', `${core}/instances/${instanceId}`)).lifecycleState !== 'RUNNING'; attempt += 1) {
        if (attempt > 90) throw new Error('oracle_server_did_not_start');
        await wait(5_000);
      }

      const attachments = await call('GET', `${core}/vnicAttachments?compartmentId=${encodeURIComponent(tenancy)}&instanceId=${encodeURIComponent(instanceId)}`);
      const addresses = await call('GET', `${core}/privateIps?vnicId=${encodeURIComponent(attachments[0].vnicId)}`);
      await call('PUT', `${core}/publicIps/${reservedId}`, { privateIpId: addresses[0].id });
    },

    cleanUp: (log: Log) => resources.cleanUp(log),
  };
}
