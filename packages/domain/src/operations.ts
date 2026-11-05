import * as v from 'valibot';

export const SCHEMA_VERSION = 1;
/** Small batches: on a bad connection only short requests get through. */
export const MAX_BATCH = 50;

const uuid = v.pipe(v.string(), v.uuid());
const shortId = v.pipe(v.string(), v.minLength(1), v.maxLength(64));

const common = {
  id: uuid,
  schema: v.literal(SCHEMA_VERSION),
  table: shortId,
  device: shortId,
  device_seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  device_time: v.pipe(v.string(), v.isoTimestamp()),
};

export const operationSchema = v.variant('type', [
  v.object({
    ...common,
    type: v.literal('voter.marked'),
    payload: v.object({ elector: shortId }),
  }),
  v.object({
    ...common,
    type: v.literal('voter.unmarked'),
    payload: v.object({
      elector: shortId,
      cancels: v.pipe(v.array(uuid), v.minLength(1), v.maxLength(64)),
    }),
  }),
  v.object({
    ...common,
    type: v.literal('incident.reported'),
    payload: v.object({ kind: shortId }),
  }),
]);

export type Operation = v.InferOutput<typeof operationSchema>;

export function parseOperation(input: unknown): Operation | null {
  const result = v.safeParse(operationSchema, input);
  return result.success ? result.output : null;
}

/** UUIDv7: sorts by creation time and needs no coordination between phones. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
