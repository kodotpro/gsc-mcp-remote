/**
 * Intrinsic width and height, read from an image's own header bytes.
 *
 * This replaces the `image-size` package, which carries two unpatched
 * high-severity advisories — CVE-2025-71330 (ICNS) and CVE-2025-71329 (JXL and
 * HEIF) — with no fixed release. Both are the same shape: a length or box-size
 * field of zero leaves a `while` loop's offset unadvanced, so the parser spins
 * forever. That loop is synchronous, so no timeout can interrupt it: one
 * crafted image served to `image_page_audit` would hang the event loop and take
 * every tenant of a hosted deployment down with it.
 *
 * We only ever needed dimensions for the handful of raster formats the web
 * actually serves, and `sniffImageFormat` already identifies those from magic
 * bytes. So reading the two numbers ourselves removes the dependency, and with
 * it a class of advisory we cannot patch.
 *
 * THE RULE THAT KEEPS THIS SAFE: no unbounded loops. Every scan below is capped
 * by both a hard iteration count and an explicit bounds check before each read,
 * and every reader returns null rather than throwing or continuing on
 * malformed input. A zero-valued length field here ends the scan; it cannot
 * fail to advance the offset. Please keep it that way — the whole point of this
 * module is that a hostile file cannot make it spin.
 *
 * Deliberately NOT supported: ICNS, JXL, HEIF/HEIC and AVIF. They are the
 * formats the advisories concern, they are not worth hand-parsing, and callers
 * already refuse them (see DIMENSION_SAFE_FORMATS in tools/image-page-audit.ts).
 */

export interface Dimensions {
  width: number;
  height: number;
}

/** Sanity ceiling: nothing real is larger, and it catches garbage reads. */
const MAX_DIMENSION = 100_000;

function plausible(width: number, height: number): Dimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
  return { width: Math.floor(width), height: Math.floor(height) };
}

/** PNG: IHDR is fixed at byte 16, so there is nothing to scan. */
function png(b: Buffer): Dimensions | null {
  if (b.length < 24) return null;
  // Bytes 12-16 must be "IHDR" or this is not a conforming PNG.
  if (b.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return plausible(b.readUInt32BE(16), b.readUInt32BE(20));
}

/** GIF: little-endian logical screen size at byte 6. */
function gif(b: Buffer): Dimensions | null {
  if (b.length < 10) return null;
  return plausible(b.readUInt16LE(6), b.readUInt16LE(8));
}

/** BMP: BITMAPINFOHEADER at byte 14; a negative height means top-down. */
function bmp(b: Buffer): Dimensions | null {
  if (b.length < 26) return null;
  return plausible(b.readInt32LE(18), Math.abs(b.readInt32LE(22)));
}

/**
 * JPEG: walk the segment chain to the first Start-Of-Frame.
 *
 * The only loop in this module that genuinely has to scan, so it carries three
 * independent brakes: the buffer bound, a segment-count cap, and the rule that
 * a segment length below 2 aborts rather than repeating.
 */
function jpeg(b: Buffer): Dimensions | null {
  let offset = 2; // past 0xFFD8
  for (let segment = 0; segment < 1024; segment++) {
    if (offset + 4 > b.length) return null;
    if (b[offset] !== 0xff) return null; // lost the chain; refuse to guess
    const marker = b[offset + 1];
    const length = b.readUInt16BE(offset + 2);
    // A length of 0 or 1 would leave the offset unadvanced — the exact defect
    // this module exists to avoid. Treat it as a malformed file.
    if (length < 2) return null;

    // SOF0..SOF15 carry the frame size. DHT (C4), JPG (C8) and DAC (CC) sit in
    // the same numeric range but are not frame headers.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 9 > b.length) return null;
      // marker(2) + length(2) + precision(1), then height then width.
      return plausible(b.readUInt16BE(offset + 7), b.readUInt16BE(offset + 5));
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan
    offset += 2 + length;
  }
  return null;
}

/**
 * WebP: a RIFF container whose first chunk says which of three encodings it is.
 * No scanning — the chunk tag is at a fixed offset.
 */
function webp(b: Buffer): Dimensions | null {
  if (b.length < 30) return null;
  const chunk = b.subarray(12, 16).toString("latin1");

  if (chunk === "VP8 ") {
    // Lossy: 3-byte frame tag, then the 0x9d 0x01 0x2a sync code.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return plausible(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === "VP8L") {
    // Lossless: signature byte, then 14 bits of width-1 and 14 of height-1
    // packed little-endian across the next four bytes.
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return plausible((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X") {
    // Extended: 24-bit little-endian canvas width-1 and height-1.
    const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return plausible(width, height);
  }
  return null;
}

/**
 * TIFF: read the first IFD's ImageWidth (0x0100) and ImageLength (0x0101).
 *
 * Entry count is bounded by the file's own field AND a cap, and each entry is
 * a fixed 12 bytes, so the offset always advances.
 */
function tiff(b: Buffer): Dimensions | null {
  if (b.length < 8) return null;
  const littleEndian = b[0] === 0x49;
  const u16 = (o: number) => (littleEndian ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o: number) => (littleEndian ? b.readUInt32LE(o) : b.readUInt32BE(o));

  const ifdOffset = u32(4);
  if (ifdOffset < 8 || ifdOffset + 2 > b.length) return null;
  const entries = Math.min(u16(ifdOffset), 512);

  let width: number | undefined;
  let height: number | undefined;
  for (let i = 0; i < entries; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > b.length) break;
    const tag = u16(entry);
    const type = u16(entry + 2);
    if (tag !== 0x0100 && tag !== 0x0101) continue;
    // SHORT (3) is stored in the low half of the value field; LONG (4) fills it.
    const value = type === 3 ? u16(entry + 8) : type === 4 ? u32(entry + 8) : undefined;
    if (value === undefined) continue;
    if (tag === 0x0100) width = value;
    else height = value;
    if (width !== undefined && height !== undefined) break;
  }
  if (width === undefined || height === undefined) return null;
  return plausible(width, height);
}

/**
 * SVG: width/height attributes if they carry usable units, else the viewBox.
 *
 * Only the opening tag is examined, and only the first 64 KB of it, so a huge
 * or hostile document cannot turn this into real work. Percentage widths are
 * ignored on purpose — they describe layout, not intrinsic size.
 */
function svg(b: Buffer): Dimensions | null {
  const head = b.subarray(0, 65536).toString("utf8");
  const tag = head.match(/<svg\b[^>]*>/i);
  if (!tag) return null;
  const open = tag[0];

  const attr = (name: string): number | undefined => {
    const m = open.match(new RegExp(`\\b${name}\\s*=\\s*["']?\\s*([0-9.]+)\\s*(px)?\\s*["']?`, "i"));
    if (!m) return undefined;
    const n = Number.parseFloat(m[1]);
    return Number.isFinite(n) ? n : undefined;
  };

  const width = attr("width");
  const height = attr("height");
  if (width !== undefined && height !== undefined) return plausible(width, height);

  const viewBox = open.match(/\bviewBox\s*=\s*["']\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)/i);
  if (viewBox) {
    return plausible(Number.parseFloat(viewBox[3]), Number.parseFloat(viewBox[4]));
  }
  return null;
}

const READERS: Record<string, (b: Buffer) => Dimensions | null> = {
  png,
  gif,
  bmp,
  jpeg,
  webp,
  tiff,
  svg,
};

/** Formats this module can measure. Anything else gets no dimensions. */
export const MEASURABLE_FORMATS = Object.freeze(Object.keys(READERS));

/**
 * Reads intrinsic dimensions for an already-identified format.
 *
 * `format` is the value `sniffImageFormat` produced from the file's magic
 * bytes — never a server-supplied Content-Type, which an attacker controls.
 * Returns null for an unsupported format or any malformed file; it never
 * throws, and it always terminates.
 */
export function imageDimensions(buffer: Buffer, format: string | null): Dimensions | null {
  if (!format) return null;
  const reader = READERS[format];
  if (!reader) return null;
  try {
    return reader(buffer);
  } catch {
    // A truncated file can still make a bounded read overrun; treat any
    // surprise as "unknown" rather than propagating it into a tool result.
    return null;
  }
}
