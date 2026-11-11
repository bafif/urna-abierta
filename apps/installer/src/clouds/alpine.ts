import { createHash } from 'node:crypto';

/**
 * The system of the servers that the installer creates: Alpine Linux, from its official cloud images
 * (https://alpinelinux.org/cloud). AWS has them published in every region; Google and Oracle get the image file, which
 * the installer uploads to the person's account, turns into an image and deletes once the server has started.
 * To update: the newest release at that page, and the sha512 of each file from its .yaml
 * (https://dl-cdn.alpinelinux.org/alpine/v<version>/releases/cloud/alpine-<release>-<arch>-tiny-r0.yaml).
 */
export const ALPINE = { version: '3.24', release: '3.24.4' };

/** The AWS account that publishes Alpine's images. Look-alikes from other sellers exist on the Marketplace. */
export const ALPINE_AWS_OWNER = '538276064493';

export interface AlpineImage {
  file: string;
  sha512: string;
}

export const ALPINE_IMAGES = {
  /** Google's format: a disk.raw inside a .tar.gz. */
  googleX86: {
    file: `alpine-${ALPINE.release}-x86_64-tiny-r0.raw.tar.gz`,
    sha512: '44375a71b5b277a677e46b6f4461d919cadf384ac88aec479481d3cb6c5f5dda70d0c8d542366655dad116c0dcd1a453ffd260933cc250f396f2c2ad5e1447f4',
  },
  /** Oracle's format, QCOW2: the free ARM machine and the free x86 one. */
  oracleArm: {
    file: `alpine-${ALPINE.release}-aarch64-tiny-r0.qcow2`,
    sha512: '0b82595259ae4602cbebb2abb55c76fe32a85baebf8931ddf7bc377f9b3ffa776166979bf28f3bf17ae0fd8d5b24f4066da35bee86c4f86b5905b50571f30992',
  },
  oracleX86: {
    file: `alpine-${ALPINE.release}-x86_64-tiny-r0.qcow2`,
    sha512: '2b58f6774f7102c8366b00e00eb1075d7e9d30ff2df25fbce2f88952b33da056a582655332495c09f12a5fb07135ebcdf08b9e03710ddc84b74999f01c514f51',
  },
} satisfies Record<string, AlpineImage>;

/** Downloads one image file and checks it against the sum pinned here: a different file is never uploaded. */
export async function downloadAlpine(image: AlpineImage, request: typeof fetch = fetch): Promise<Buffer> {
  const response = await request(`https://dl-cdn.alpinelinux.org/alpine/v${ALPINE.version}/releases/cloud/${image.file}`);
  if (!response.ok) throw new Error(`alpine_download: ${image.file} ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha512').update(data).digest('hex') !== image.sha512) throw new Error(`alpine_checksum: ${image.file}`);
  return data;
}
