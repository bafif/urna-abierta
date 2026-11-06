/** A copy of a ZIP where one file says it takes `size` bytes once unpacked, whatever it really takes. */
export function declareSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  const encoded = new TextEncoder().encode(name);
  const named = (at: number) => encoded.every((byte, i) => out[at + i] === byte);
  for (let at = 0; at + 46 <= out.length; at += 1) {
    const signature = view.getUint32(at, true);
    // A local header keeps the size at 22 and its name at 30; the central directory, at 24 and 46.
    if (signature === 0x04034b50 && view.getUint16(at + 26, true) === encoded.length && named(at + 30)) view.setUint32(at + 22, size, true);
    if (signature === 0x02014b50 && view.getUint16(at + 28, true) === encoded.length && named(at + 46)) view.setUint32(at + 24, size, true);
  }
  return out;
}
