#!/usr/bin/env node
/**
 * Regression tests for the production-audit fixes.
 *
 * Every check here corresponds to a defect that was found, reproduced, and
 * fixed. They exist so the same hole cannot reopen quietly — each one failed
 * before its fix landed.
 *
 * Credential-free: no Google call, no network egress beyond loopback.
 *
 * Run: node scripts/check-hardening.mjs
 */
import http from "node:http";
import path from "node:path";
import { isPrivateAddress, assertPublicUrl, safeFetch } from "../dist/net-guard.js";
import { confineReportPath } from "../dist/tools/generate-report.js";
import { sniffImageFormat, dimensionsAreSafeFor, mediaTypeFor } from "../dist/tools/image-page-audit.js";
import { imageDimensions } from "../dist/image-dimensions.js";

const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) console.log(`  ok    ${label}`);
  else { console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); failures.push(label); }
};

// ---------------------------------------------------------------------------
console.log("SSRF address classification");
// ---------------------------------------------------------------------------
// The original bug: URL parsing normalises ::ffff:127.0.0.1 to the hex form
// ::ffff:7f00:1, which a dotted-decimal regex never matches — so loopback and
// the cloud metadata endpoint were both reachable from the hosted server.
const MUST_BLOCK = [
  "127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254",
  "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
  "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe",
  "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:0:127.0.0.1", "::127.0.0.1",
  "64:ff9b::127.0.0.1", "64:ff9b::7f00:1", "not-an-ip", "",
];
const MUST_ALLOW = [
  "8.8.8.8", "1.1.1.1", "93.184.216.34",
  "2606:2800:220:1:248:1893:25c8:1946", "2001:4860:4860::8888",
  "::ffff:8.8.8.8", "::ffff:808:808",
];
const leaks = MUST_BLOCK.filter((ip) => !isPrivateAddress(ip));
const falsePos = MUST_ALLOW.filter((ip) => isPrivateAddress(ip));
check(`${MUST_BLOCK.length} private/reserved forms all blocked`, leaks.length === 0, leaks.join(", "));
check(`${MUST_ALLOW.length} public addresses all allowed`, falsePos.length === 0, falsePos.join(", "));

for (const url of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:169.254.169.254]/", "http://[64:ff9b::7f00:1]/", "http://127.0.0.1:5678/"]) {
  let blocked = false;
  try { await assertPublicUrl(url); } catch { blocked = true; }
  check(`assertPublicUrl blocks ${url}`, blocked);
}
let schemeBlocked = false;
try { await assertPublicUrl("file:///etc/passwd"); } catch { schemeBlocked = true; }
check("non-http schemes are refused", schemeBlocked);

// ---------------------------------------------------------------------------
console.log("\nFetch limits (deadline covers the body; bytes are capped)");
// ---------------------------------------------------------------------------
// The original bug: the abort timer was cleared in a `finally` that ran when
// the Response was returned, i.e. before any caller read the body — so page
// HTML and image bytes downloaded with no time limit and no size limit.
const hostile = http.createServer((req, res) => {
  if (req.url === "/slowbody") {
    res.writeHead(200, { "content-type": "text/html" });
    res.write("<html>");
    return; // never ends
  }
  if (req.url === "/infinite") {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    const t = setInterval(() => res.write(Buffer.alloc(64 * 1024)), 1);
    res.on("close", () => clearInterval(t));
    return;
  }
  if (req.url === "/redirect-to-loopback") {
    res.writeHead(302, { location: "http://127.0.0.1:1/" });
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});
await new Promise((r) => hostile.listen(0, "127.0.0.1", r));
const port = hostile.address().port;
const base = `http://127.0.0.1:${port}`;
const local = { userAgent: "check-hardening", allowPrivate: true };

const t0 = Date.now();
let timedOut = false;
try {
  await safeFetch(`${base}/slowbody`, { ...local, timeoutMs: 1200, maxBytes: 1e6 });
} catch { timedOut = true; }
const elapsed = Date.now() - t0;
check("a response that streams forever times out", timedOut && elapsed < 4000, `${elapsed}ms`);

const capped = await safeFetch(`${base}/infinite`, { ...local, timeoutMs: 15000, maxBytes: 256 * 1024 });
check("body is cut at the byte ceiling", capped.body.length <= 256 * 1024 && capped.truncated, `${capped.body.length} bytes, truncated=${capped.truncated}`);

const ok = await safeFetch(`${base}/ok`, { ...local, timeoutMs: 5000, maxBytes: 1e6 });
check("a normal response still succeeds", ok.status === 200 && ok.body.toString() === "ok" && !ok.truncated);

// Redirects must be re-validated: a public URL that 302s to loopback is the
// classic way around a check that only looks at the first hop.
let redirectBlocked = false;
try {
  await safeFetch(`${base}/redirect-to-loopback`, { userAgent: "t", timeoutMs: 5000, maxBytes: 1e6 });
} catch { redirectBlocked = true; }
check("a redirect into loopback is refused in remote mode", redirectBlocked);
hostile.close();

// ---------------------------------------------------------------------------
console.log("\nReport path confinement");
// ---------------------------------------------------------------------------
// The original bug: output_path was passed straight to fs.writeFileSync, so a
// tool argument could clobber any file the process could write.
process.env.GSC_REPORT_DIR = "/tmp/gsc-hardening-test";
const baseDir = path.resolve("/tmp/gsc-hardening-test");
const escapes = ["/etc/passwd", "../../../../etc/cron.d/evil", "~/.ssh/authorized_keys", "..", ".", "/", "a/b/c/deep.md", "nested/../../escape.md"];
const escaped = escapes.filter((p) => {
  try { return path.dirname(confineReportPath(p, "2026-01-01")) !== baseDir; }
  catch { return false; }
});
check(`${escapes.length} traversal attempts all confined`, escaped.length === 0, escaped.join(", "));
check("a plain filename is preserved", path.basename(confineReportPath("weekly.md", "2026-01-01")) === "weekly.md");

// ---------------------------------------------------------------------------
console.log("\nImage dimension parsing");
// ---------------------------------------------------------------------------
// The image-size package carried two unpatched advisories — CVE-2025-71330
// (ICNS) and CVE-2025-71329 (JXL/HEIF) — where a zero-valued length or box-size
// field left a loop's offset unadvanced, spinning the event loop forever. That
// loop is synchronous, so no timeout can interrupt it, and one crafted image
// served to image_page_audit would hang every tenant. The dependency is gone;
// src/image-dimensions.ts reads the headers itself. These checks pin BOTH
// halves of that: the format is still decided from magic bytes, and the reader
// terminates on every hostile shape the advisories describe.
const b = (...bytes) => Buffer.from(bytes);
const pad = (buf) => Buffer.concat([buf, Buffer.alloc(Math.max(0, 32 - buf.length))]);

const SAMPLES = [
  ["jpeg", pad(b(0xff, 0xd8, 0xff, 0xe0)), true],
  ["png",  pad(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), true],
  ["gif",  pad(Buffer.from("GIF89a", "latin1")), true],
  ["webp", pad(Buffer.concat([Buffer.from("RIFF", "latin1"), b(0, 0, 0, 0), Buffer.from("WEBP", "latin1")])), true],
  ["bmp",  pad(b(0x42, 0x4d)), true],
  ["tiff", pad(b(0x49, 0x49, 0x2a, 0x00)), true],
  ["tiff", pad(b(0x4d, 0x4d, 0x00, 0x2a)), true],
  ["svg",  pad(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', "latin1")), true],
  // The three vulnerable families must be recognised AND refused.
  ["icns", pad(Buffer.from("icns", "latin1")), false],
  ["jxl",  pad(b(0xff, 0x0a)), false],
  ["jxl",  pad(b(0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a)), false],
  ["avif", pad(Buffer.concat([b(0, 0, 0, 0x20), Buffer.from("ftypavif", "latin1")])), false],
  ["heic", pad(Buffer.concat([b(0, 0, 0, 0x20), Buffer.from("ftypheic", "latin1")])), false],
];

const misread = SAMPLES.filter(([want, buf]) => sniffImageFormat(buf) !== want)
  .map(([want, buf]) => `${want} read as ${sniffImageFormat(buf)}`);
check(`${SAMPLES.length} formats identified from magic bytes`, misread.length === 0, misread.join("; "));

const wrongGate = SAMPLES.filter(([, buf, safe]) => dimensionsAreSafeFor(sniffImageFormat(buf)) !== safe)
  .map(([want]) => want);
check("the vulnerable parsers are gated off, the safe ones allowed", wrongGate.length === 0, wrongGate.join(", "));

// A Content-Type header is attacker-controlled, so it must never be what
// decides which parser runs.
const heicBytes = pad(Buffer.concat([b(0, 0, 0, 0x20), Buffer.from("ftypheic", "latin1")]));
check(
  "a HEIC mislabelled as image/png is still refused",
  dimensionsAreSafeFor(sniffImageFormat(heicBytes)) === false
);
check("an unidentifiable file is refused rather than guessed", sniffImageFormat(pad(b(0x00, 0x01, 0x02, 0x03))) === null);
check("a truncated file is refused", sniffImageFormat(b(0xff, 0xd8)) === null);

// `format` is reported in the tool output and read by a model, so it must be
// a real media type — not the internal sniff label glued onto "image/".
const MEDIA_TYPES = [["svg", "image/svg+xml"], ["icns", "image/x-icns"], ["jpeg", "image/jpeg"], ["tiff", "image/tiff"]];
const badTypes = MEDIA_TYPES.filter(([k, want]) => mediaTypeFor(k) !== want).map(([k]) => `${k}->${mediaTypeFor(k)}`);
check("sniffed formats map to real media types", badTypes.length === 0, badTypes.join(", "));
// isobmff is a container family, not an image type: it must map to nothing so
// the caller falls back to the server's Content-Type.
check("a container family maps to no media type", mediaTypeFor("isobmff") === null, String(mediaTypeFor("isobmff")));

// ---------------------------------------------------------------------------
console.log("\nRow ceiling");
// ---------------------------------------------------------------------------
// Unbounded pagination could accumulate every row Google would return, which
// on a shared host was enough to abort the process. The default is deliberately
// modest: measured at 384 MB of heap, 100,000 rows cost ~68 MB per query
// including the transient JSON, against ~17 MB at 25,000.
const { MAX_TOTAL_ROWS } = await import("../dist/analytics.js");
check("the row ceiling defaults to a memory-safe value", MAX_TOTAL_ROWS === 25000, String(MAX_TOTAL_ROWS));
check("the row ceiling is overridable", Number(process.env.GSC_MAX_TOTAL_ROWS ?? 25000) === 25000);

// ---------------------------------------------------------------------------
console.log("\nDimension reader: correctness");
// ---------------------------------------------------------------------------
// A safe parser that returns wrong numbers is no better than a hanging one:
// intrinsic size drives the "below Google's indexing minimum" finding.
const be16v = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const be32v = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const le16v = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const le32v = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const W = 1280, H = 720;

const tiffOf = (le) => {
  const t = Buffer.alloc(38);
  if (le) {
    t.write("II", 0); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4); t.writeUInt16LE(2, 8);
    t.writeUInt16LE(0x100, 10); t.writeUInt16LE(4, 12); t.writeUInt32LE(1, 14); t.writeUInt32LE(W, 18);
    t.writeUInt16LE(0x101, 22); t.writeUInt16LE(4, 24); t.writeUInt32LE(1, 26); t.writeUInt32LE(H, 30);
  } else {
    t.write("MM", 0); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4); t.writeUInt16BE(2, 8);
    t.writeUInt16BE(0x100, 10); t.writeUInt16BE(4, 12); t.writeUInt32BE(1, 14); t.writeUInt32BE(W, 18);
    t.writeUInt16BE(0x101, 22); t.writeUInt16BE(4, 24); t.writeUInt32BE(1, 26); t.writeUInt32BE(H, 30);
  }
  return t;
};
const vp8xOf = () => {
  const v = Buffer.alloc(40);
  Buffer.from("RIFF").copy(v, 0); le32v(100).copy(v, 4);
  Buffer.from("WEBP").copy(v, 8); Buffer.from("VP8X").copy(v, 12); le32v(10).copy(v, 16);
  v[24] = (W - 1) & 255; v[25] = ((W - 1) >> 8) & 255; v[26] = ((W - 1) >> 16) & 255;
  v[27] = (H - 1) & 255; v[28] = ((H - 1) >> 8) & 255; v[29] = ((H - 1) >> 16) & 255;
  return v;
};
const bmpTopDown = () => {
  const x = Buffer.concat([Buffer.from("BM"), le32v(1000), Buffer.alloc(4), le32v(54), le32v(40), le32v(W), Buffer.alloc(4), Buffer.alloc(8)]);
  x.writeInt32LE(-H, 22);
  return x;
};

const DIMS = [
  ["png", "png", Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), be32v(13), Buffer.from("IHDR"), be32v(W), be32v(H), Buffer.alloc(8)])],
  ["gif", "gif", Buffer.concat([Buffer.from("GIF89a"), le16v(W), le16v(H), Buffer.alloc(4)])],
  ["bmp", "bmp", Buffer.concat([Buffer.from("BM"), le32v(1000), Buffer.alloc(4), le32v(54), le32v(40), le32v(W), le32v(H), Buffer.alloc(8)])],
  ["bmp top-down", "bmp", bmpTopDown()],
  ["jpeg", "jpeg", Buffer.concat([Buffer.from([0xff,0xd8]), Buffer.from([0xff,0xe0]), be16v(16), Buffer.alloc(14), Buffer.from([0xff,0xc0]), be16v(17), Buffer.from([8]), be16v(H), be16v(W), Buffer.alloc(8)])],
  ["webp VP8", "webp", Buffer.concat([Buffer.from("RIFF"), le32v(100), Buffer.from("WEBP"), Buffer.from("VP8 "), le32v(50), Buffer.alloc(3), Buffer.from([0x9d,0x01,0x2a]), le16v(W), le16v(H), Buffer.alloc(8)])],
  ["webp VP8L", "webp", Buffer.concat([Buffer.from("RIFF"), le32v(100), Buffer.from("WEBP"), Buffer.from("VP8L"), le32v(50), Buffer.from([0x2f]), le32v((W-1)|((H-1)<<14)), Buffer.alloc(12)])],
  ["webp VP8X", "webp", vp8xOf()],
  ["tiff LE", "tiff", tiffOf(true)],
  ["tiff BE", "tiff", tiffOf(false)],
  ["svg attrs", "svg", Buffer.from(`<svg width="${W}" height="${H}"/>`)],
  ["svg viewBox", "svg", Buffer.from(`<svg viewBox="0 0 ${W} ${H}"/>`)],
];
const wrongDims = DIMS.filter(([, fmt, buf]) => {
  const d = imageDimensions(buf, fmt);
  return !d || d.width !== W || d.height !== H;
}).map(([label]) => label);
check(`${DIMS.length} formats measured correctly (${W}x${H})`, wrongDims.length === 0, wrongDims.join(", "));

// ---------------------------------------------------------------------------
console.log("\nDimension reader: termination on hostile input");
// ---------------------------------------------------------------------------
// Each of these is a zero-advance shape, an out-of-bounds claim, or an
// oversized document. The reader must return null promptly; a hang here is the
// exact defect that removing image-size was meant to eliminate. If this check
// ever stops completing, that is the regression.
const HOSTILE = [
  ["jpeg segment length 0", "jpeg", Buffer.concat([Buffer.from([0xff,0xd8]), Buffer.from([0xff,0xe1]), be16v(0), Buffer.alloc(64)])],
  ["jpeg segment length 1", "jpeg", Buffer.concat([Buffer.from([0xff,0xd8]), Buffer.from([0xff,0xe1]), be16v(1), Buffer.alloc(64)])],
  ["jpeg 5000 zero segments", "jpeg", Buffer.concat([Buffer.from([0xff,0xd8]), ...Array.from({length:5000}, () => Buffer.concat([Buffer.from([0xff,0xe1]), be16v(0)]))])],
  ["tiff 65535 entries claimed", "tiff", (() => { const b = Buffer.alloc(64); b.write("II",0); b.writeUInt16LE(42,2); b.writeUInt32LE(8,4); b.writeUInt16LE(65535,8); return b; })()],
  ["tiff IFD offset out of bounds", "tiff", (() => { const b = Buffer.alloc(32); b.write("II",0); b.writeUInt16LE(42,2); b.writeUInt32LE(0xfffffff0,4); return b; })()],
  ["svg 2MB of attributes", "svg", Buffer.from("<svg " + 'a="1" '.repeat(300000) + ">")],
  ["svg unterminated tag", "svg", Buffer.from('<svg width="10' + "0".repeat(200000))],
  ["empty buffer", "png", Buffer.alloc(0)],
  ["single byte", "jpeg", Buffer.from([0xff])],
  ["4KB of noise", "webp", Buffer.alloc(4096, 0xab)],
  ["all zeros", "bmp", Buffer.alloc(1024)],
  ["unsupported format", "icns", Buffer.alloc(64)],
  ["null format", null, Buffer.alloc(64)],
];
const started = process.hrtime.bigint();
const misbehaved = HOSTILE.filter(([, fmt, buf]) => {
  try {
    return imageDimensions(buf, fmt) !== null;
  } catch {
    return true; // throwing counts as misbehaving; callers expect null
  }
}).map(([label]) => label);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
check(`${HOSTILE.length} hostile inputs all return null without throwing`, misbehaved.length === 0, misbehaved.join(", "));
check(`hostile input handled promptly (${elapsedMs.toFixed(1)}ms, budget 2000ms)`, elapsedMs < 2000, `${elapsedMs}ms`);

if (failures.length > 0) {
  console.error(`\nHardening tests: ${failures.length} failure(s).`);
  process.exit(1);
}
console.log("\nHardening tests: all checks passed.");
process.exit(0);
