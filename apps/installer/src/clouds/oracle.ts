import { createHash, createSign, randomBytes } from 'node:crypto';
import { ALPINE, ALPINE_IMAGES, downloadAlpine } from './alpine.ts';
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

export function oracleCloud(credentials: OracleCredentials, request: typeof fetch = fetch, wait = sleep, download = downloadAlpine): Cloud {
  const { region, tenancy } = credentials;
  const core = `https://iaas.${region}.oraclecloud.com/20160918`;
  const identity = `https://identity.${region}.oraclecloud.com/20160918`;
  const storage = `https://objectstorage.${region}.oraclecloud.com`;
  let reservedId = '';
  const resources = createdResources();

  async function call(method: string, address: string, payload?: object): Promise<any> {
    const url = new URL(address);
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers = signOracle({ method, url, body, date: new Date().toUTCString(), credentials });
    const { host: _host, ...sent } = headers;
    const response = await request(url, { method, headers: sent, body });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`oracle_${method}_${url.pathname.split('/').pop()}: ${data.code ?? response.status} ${data.message ?? ''}`);
    return data;
  }

  /** Deletes, and waits until it is gone: the network cannot go while the machine or the subnet are still in it. */
  async function remove(address: string, options = ''): Promise<void> {
    await call('DELETE', `${address}${options}`);
    await until(async () => {
      try {
        return ['TERMINATED', 'DELETED'].includes((await call('GET', address)).lifecycleState);
      } catch (error) {
        if (/: (404|NotAuthorizedOrNotFound) /.test((error as Error).message)) return true;
        throw error;
      }
    }, wait, { tries: 120, every: 5_000, problem: 'oracle_delete_timeout' });
  }

  /** Deletes something of Object Storage. What is already gone counts as deleted. */
  async function removeStored(address: string): Promise<void> {
    try {
      await call('DELETE', address);
    } catch (error) {
      if (!/: (404|BucketNotFound|ObjectNotFound) /.test((error as Error).message)) throw error;
    }
  }

  /** The image file goes as it is: Object Storage does not ask for the body in the signature of an upload. */
  async function upload(address: string, data: Buffer): Promise<void> {
    const url = new URL(address);
    const { host: _host, ...sent } = signOracle({ method: 'PUT', url, date: new Date().toUTCString(), credentials });
    const response = await request(url, { method: 'PUT', headers: { ...sent, 'content-type': 'application/octet-stream' }, body: data });
    if (!response.ok) {
      const data: any = await response.json().catch(() => ({}));
      throw new Error(`oracle_PUT_upload: ${data.code ?? response.status} ${data.message ?? ''}`);
    }
  }

  /** Imported images, one per kind of machine, deleted once the machine runs: its boot volume is a copy. */
  const imported = new Map<string, string>();

  /**
   * Oracle has no Alpine of its own: Alpine's image file for that kind of machine goes to a bucket of this attempt and
   * becomes an image of the account. Oracle takes from a few minutes to more than half an hour to import it.
   */
  async function imageFor(shape: string, log: Log): Promise<string> {
    const arm = shape === FREE_ARM.shape;
    const known = imported.get(shape);
    if (known) return known;
    log('image');
    const file = arm ? ALPINE_IMAGES.oracleArm : ALPINE_IMAGES.oracleX86;
    const data = await download(file, request);
    const namespace: string = await call('GET', `${storage}/n/`);
    const bucket = `urna-abierta-${randomBytes(4).toString('hex')}`;
    await call('POST', `${storage}/n/${namespace}/b/`, { name: bucket, compartmentId: tenancy });
    const bucketAddress = `${storage}/n/${namespace}/b/${bucket}`;
    resources.add(`bucket ${bucket}`, () => removeStored(bucketAddress));
    const objectAddress = `${bucketAddress}/o/${encodeURIComponent(file.file)}`;
    resources.add(`object ${bucket}/${file.file}`, () => removeStored(objectAddress));
    await upload(objectAddress, data);
    const image = await call('POST', `${core}/images`, {
      compartmentId: tenancy,
      displayName: `urna-abierta-alpine-${ALPINE.release}-${arm ? 'arm' : 'x86'}`,
      launchMode: 'PARAVIRTUALIZED',
      imageSourceDetails: { sourceType: 'objectStorageTuple', namespaceName: namespace, bucketName: bucket, objectName: file.file, sourceImageType: 'QCOW2', operatingSystem: 'Alpine Linux', operatingSystemVersion: ALPINE.release },
    });
    resources.add(`image ${image.id}`, () => remove(`${core}/images/${image.id}`));
    await until(async () => (await call('GET', `${core}/images/${image.id}`)).lifecycleState === 'AVAILABLE', wait, { tries: 360, every: 10_000, problem: 'oracle_image_timeout' });
    // An imported image is not marked for every kind of machine: this one has to be.
    await call('PUT', `${core}/images/${image.id}/shapes/${shape}`, {});
    // Once imported, the file is not needed.
    await removeStored(objectAddress).catch(() => undefined);
    await removeStored(bucketAddress).catch(() => undefined);
    imported.set(shape, image.id);
    return image.id;
  }

  /** Free machines are often out of stock: it tries each zone with the better one, and then with the smaller. */
  async function launch(script: string, subnetId: string, log: Log): Promise<string> {
    const zones: { name: string }[] = await call('GET', `${identity}/availabilityDomains?compartmentId=${encodeURIComponent(tenancy)}`);
    let lastProblem = '';
    for (const kind of [FREE_ARM, FREE_X86]) {
      const imageId = await imageFor(kind.shape, log);
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
      // If deleting an image fails, the server stays: it costs cents a month, and the servers' guide says where it is.
      for (const id of imported.values()) await call('DELETE', `${core}/images/${id}`).catch(() => undefined);
    },

    cleanUp: (log: Log) => resources.cleanUp(log),
  };
}
