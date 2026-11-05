/**
 * Builds the only PNG that is ever handed to exifr.
 *
 * exifr inflates an `iCCP` (colour profile) chunk with no output ceiling,
 * whatever options are passed: a few hundred bytes of compressed zeros expand to
 * gigabytes inside the shared process. Defusing that chunk by NAME is a losing
 * game, and an earlier version lost it: exifr lowercases chunk names and walks
 * every chunk with no cap, while the first attempt matched one exact spelling and
 * stopped after 4,096 chunks, so `ICCP`, or the profile placed after 5,000 tiny
 * text chunks, walked straight through.
 *
 * So this works the other way round: a fresh buffer is built from an ALLOW-LIST
 * of the only chunks exifr reads here (IHDR, tEXt, iTXt, eXIf), matched
 * case-insensitively across the WHOLE buffer. Everything else, the colour
 * profile and the image data included, is simply absent. The walk is bounded by
 * the buffer (itself capped by the image byte ceiling) and every iteration
 * advances by at least 12 bytes. If the chunk structure cannot be walked to its
 * end, the answer is null and the caller skips metadata for that file: an
 * unparseable PNG gets no second chance to surprise a parser.
 */
const SIGNATURE_LENGTH = 8;
const KEEP = new Set(["ihdr", "text", "itxt", "exif"]);

export function pngMetadataView(buffer: Buffer): Buffer | null {
  if (buffer.length < SIGNATURE_LENGTH) return null;
  const kept: Buffer[] = [buffer.subarray(0, SIGNATURE_LENGTH)];
  let pos = SIGNATURE_LENGTH;
  while (pos < buffer.length) {
    if (pos + 12 > buffer.length) return null; // length + type + crc do not even fit
    const size = buffer.readUInt32BE(pos);
    const end = pos + 12 + size; // length(4) + type(4) + data + crc(4)
    if (end > buffer.length) return null; // the chunk claims more bytes than exist
    if (KEEP.has(buffer.toString("latin1", pos + 4, pos + 8).toLowerCase())) kept.push(buffer.subarray(pos, end));
    pos = end;
  }
  return Buffer.concat(kept);
}
