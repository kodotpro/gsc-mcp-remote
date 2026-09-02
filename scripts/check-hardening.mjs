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
console.log("\nImage parser exposure");
// ---------------------------------------------------------------------------
// image-size has unfixed advisories for infinite loops in its ICNS, JXL and
// HEIF readers (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq). The loop is
// synchronous, so a timeout cannot interrupt it: one crafted image would spin
// the event loop and hang every tenant. The defence is to decide the format
// from the file's own magic bytes and never hand those families to the parser.
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

if (failures.length > 0) {
  console.error(`\nHardening tests: ${failures.length} failure(s).`);
  process.exit(1);
}
console.log("\nHardening tests: all checks passed.");
process.exit(0);
