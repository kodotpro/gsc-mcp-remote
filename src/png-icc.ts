/**
 * Defuses the one PNG chunk exifr will decompress without a limit.
 *
 * exifr's PNG parser inflates an `iCCP` (embedded colour profile) chunk with no
 * output ceiling, whatever options are passed. A few hundred bytes of
 * compressed zeros expand to gigabytes, in the shared process, and the tool
 * feeds exifr every PNG it fetches from a caller-named server.
 *
 * The profile is useless to this tool, so the chunk's TYPE is renamed on a COPY
 * to an ancillary type exifr does not know (`xCCP`); EXIF, XMP and the other
 * chunks still parse. The input buffer is never modified. The walk is bounded by
 * a chunk-count cap and an explicit length check, and every iteration advances.
 */
const PNG_SIGNATURE_LENGTH = 8;
const MAX_CHUNKS = 4096;

export function neutralisePngIcc(buffer: Buffer): Buffer {
  let copy: Buffer | null = null;
  let pos = PNG_SIGNATURE_LENGTH;
  for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
    if (pos + 12 > buffer.length) break;
    const length = buffer.readUInt32BE(pos);
    if (buffer.toString("latin1", pos + 4, pos + 8) === "iCCP") {
      copy ??= Buffer.from(buffer);
      copy.write("xCCP", pos + 4, "latin1");
    }
    const next = pos + 12 + length; // length + type + data + crc
    if (!Number.isSafeInteger(next) || next <= pos || next > buffer.length) break;
    pos = next;
  }
  return copy ?? buffer;
}
