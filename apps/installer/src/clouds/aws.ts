import { createHash, createHmac, randomBytes } from 'node:crypto';
import { sleep, type Cloud, type Log } from './common.ts';

export interface AwsCredentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();

/** Signature version 4, by hand: this is the only AWS request the installer ever needs to sign. */
export function signAws(options: { method: string; host: string; path: string; query?: string; headers: Record<string, string>; body: string; region: string; service: string; accessKeyId: string; secretAccessKey: string; amzDate: string }): string {
  const { method, host, path, query = '', body, region, service, accessKeyId, secretAccessKey, amzDate } = options;
  const headers: Record<string, string> = { ...options.headers, host, 'x-amz-date': amzDate };
  const names = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim()]));
  const canonical = [method, path, query, names.map((name) => `${name}:${lower[name]}\n`).join(''), names.join(';'), sha256(body)].join('\n');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}

const first = (xml: string, tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];

const CANONICAL_ACCOUNT = '099720109477';

export function awsCloud(credentials: AwsCredentials, request: typeof fetch = fetch, wait = sleep): Cloud {
  const { region } = credentials;
  const host = `ec2.${region}.amazonaws.com`;
  let allocationId = '';

  async function call(action: string, params: Record<string, string> = {}): Promise<string> {
    const body = new URLSearchParams({ Action: action, Version: '2016-11-15', ...params }).toString();
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
    const headers = { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' };
    const authorization = signAws({ method: 'POST', host, path: '/', headers, body, region, service: 'ec2', accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, amzDate });
    const response = await request(`https://${host}/`, { method: 'POST', headers: { ...headers, 'x-amz-date': amzDate, authorization }, body });
    const text = await response.text();
    if (!response.ok) throw new Error(`aws_${action}: ${first(text, 'Code') ?? response.status} ${first(text, 'Message') ?? ''}`);
    return text;
  }

  return {
    /** The address comes first, so that the server already knows it when it starts. */
    async reserveAddress(log: Log) {
      log('address');
      const allocated = await call('AllocateAddress', { Domain: 'vpc' });
      allocationId = first(allocated, 'allocationId')!;
      return first(allocated, 'publicIp')!;
    },

    async createServer(script: string, log: Log) {
      log('network');
      const vpcs = await call('DescribeVpcs', { 'Filter.1.Name': 'isDefault', 'Filter.1.Value.1': 'true' });
      const vpcId = first(vpcs, 'vpcId');
      if (!vpcId) throw new Error('aws_no_default_network');
      const subnets = await call('DescribeSubnets', { 'Filter.1.Name': 'vpc-id', 'Filter.1.Value.1': vpcId, 'Filter.2.Name': 'default-for-az', 'Filter.2.Value.1': 'true' });
      const subnetId = first(subnets, 'subnetId');
      if (!subnetId) throw new Error('aws_no_default_network');

      const group = await call('CreateSecurityGroup', { GroupName: `urna-abierta-${randomBytes(3).toString('hex')}`, GroupDescription: 'Urna Abierta: web and SSH', VpcId: vpcId });
      const groupId = first(group, 'groupId')!;
      const open = [['tcp', '22'], ['tcp', '80'], ['tcp', '443'], ['udp', '443']];
      const rules = Object.fromEntries(open.flatMap(([protocol, port], index) => {
        const n = index + 1;
        return [[`IpPermissions.${n}.IpProtocol`, protocol!], [`IpPermissions.${n}.FromPort`, port!], [`IpPermissions.${n}.ToPort`, port!], [`IpPermissions.${n}.IpRanges.1.CidrIp`, '0.0.0.0/0']];
      }));
      await call('AuthorizeSecurityGroupIngress', { GroupId: groupId, ...rules });

      log('image');
      const found = await call('DescribeImages', { 'Owner.1': CANONICAL_ACCOUNT, 'Filter.1.Name': 'name', 'Filter.1.Value.1': 'ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*', 'Filter.2.Name': 'state', 'Filter.2.Value.1': 'available' });
      const newest = [...found.matchAll(/<imageId>([^<]+)<\/imageId>[\s\S]*?<creationDate>([^<]+)<\/creationDate>/g)].sort((a, b) => b[2]!.localeCompare(a[2]!))[0];
      if (!newest) throw new Error('aws_no_image');

      log('server');
      const started = await call('RunInstances', {
        ImageId: newest[1]!,
        InstanceType: 't3.micro',
        MinCount: '1',
        MaxCount: '1',
        UserData: Buffer.from(script).toString('base64'),
        'SecurityGroupId.1': groupId,
        SubnetId: subnetId,
        'BlockDeviceMapping.1.DeviceName': '/dev/sda1',
        'BlockDeviceMapping.1.Ebs.VolumeSize': '20',
        'TagSpecification.1.ResourceType': 'instance',
        'TagSpecification.1.Tag.1.Key': 'Name',
        'TagSpecification.1.Tag.1.Value': 'urna-abierta',
      });
      const instanceId = first(started, 'instanceId')!;

      for (let attempt = 0; ; attempt += 1) {
        const state = await call('DescribeInstances', { 'InstanceId.1': instanceId });
        if (/<instanceState>\s*<code>16<\/code>/.test(state)) break;
        if (attempt > 60) throw new Error('aws_server_did_not_start');
        await wait(5_000);
      }
      await call('AssociateAddress', { InstanceId: instanceId, AllocationId: allocationId });
    },
  };
}
