import { parse, type HTMLElement } from "node-html-parser";
import { imageDimensions, MEASURABLE_FORMATS } from "../image-dimensions.js";
import exifr from "exifr";
import { isRemoteMode } from "../runtime.js";
import { safeFetch, BlockedUrlError } from "../net-guard.js";

/**
 * Fetches pages from the user's own site and audits every image on them
 * against the on-page factors that drive image-search performance: alt text,
 * filenames, dimension attributes, lazy loading on the LCP candidate,
 * responsive markup, file format and weight, intrinsic dimensions against
 * Google's ~250x200 indexing minimum, ImageObject / licensable schema,
 * max-image-preview, and (optionally) the metadata inside the image files
 * themselves (camera EXIF that should be stripped, IPTC editorial fields
 * that should survive, XMP DigitalSourceType on AI-generated images).
 *
 * This is the bridge from "which pages fail" (image_impressions_no_clicks,
 * image_search_quick_wins) to "why they fail". It only ever fetches the
 * URLs it is given; no third-party service is involved.
 */

const USER_AGENT =
  "gsc-mcp-remote/3.0 image_page_audit";

const PAGE_TIMEOUT_MS = 15000;
const IMAGE_TIMEOUT_MS = 12000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// HTML is parsed into a DOM, so it costs several times its wire size in
// memory. Cap it well below the image ceiling.
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

const INDEX_MIN_WIDTH = 250;
const INDEX_MIN_HEIGHT = 200;
const INDEX_MIN_AREA = 50000;
const HEAVY_BYTES = 300 * 1024;
const OVERSIZED_BYTES = 500 * 1024;
const PNG_PHOTO_BYTES = 150 * 1024;

const GENERIC_ALTS = new Set([
  "image",
  "img",
  "photo",
  "picture",
  "pic",
  "icon",
  "logo",
  "graphic",
  "banner",
  "screenshot",
  "untitled",
  "alt",
  "thumbnail",
]);

const GENERIC_FILENAME =
  /^(img|image|dsc[fn]?|mvimg|pxl|screen[-_ ]?shot|screenshot|photo|unnamed|untitled|capture|whatsapp[-_ ]image|signal[-_]attachment|hero|thumbnail|default|placeholder|final|new)[\-_ ]?\d*$/i;

// Stock-agency default filenames (shutterstock_524347192.jpg and friends) are
// the stock-photo equivalent of camera defaults: an opaque ID that tells
// Google nothing about the subject. Prefix match, because CMS resizing
// appends suffixes like -1024x694.
const STOCK_FILENAME =
  /^(shutterstock|istock(photo)?|getty(images)?|adobestock|stock-photo|depositphotos|dreamstime|bigstock|123rf|alamy|pexels|unsplash)[-_]/i;

interface ImageFinding {
  src: string;
  alt: string | null;
  alt_status: "missing" | "empty" | "generic" | "filename_as_alt" | "duplicate" | "ok";
  filename_status: "generic_or_nondescriptive" | "hash_or_id" | "ok";
  has_width_height_attrs: boolean;
  loading: string | null;
  fetchpriority: string | null;
  has_srcset: boolean;
  fetched: boolean;
  format: string | null;
  bytes: number | null;
  intrinsic_width: number | null;
  intrinsic_height: number | null;
  /** Set when dimensions were skipped on purpose rather than simply absent. */
  dimensions_unread_reason?: string;
  below_indexing_minimum: boolean | null;
  weight_status: "ok" | "heavy" | "oversized" | null;
  png_likely_photo: boolean | null;
  metadata: {
    camera_exif_present: boolean;
    gps_present: boolean;
    iptc_creator: boolean;
    iptc_copyright: boolean;
    iptc_caption: boolean;
    digital_source_type: string | null;
  } | null;
  issues: string[];
}

interface PageAudit {
  url: string;
  status: "ok" | "fetch_failed";
  http_status: number | null;
  error?: string;
  page_checks?: {
    total_img_tags: number;
    content_images: number;
    images_fetched: number;
    lcp_candidate_src: string | null;
    lcp_candidate_lazy_loaded: boolean | null;
    lcp_candidate_fetchpriority: string | null;
    inline_background_images: number;
    max_image_preview: string | "not_set";
    image_object_schema_count: number;
    has_licensable_fields: boolean;
    has_primary_image_of_page: boolean;
    images_with_srcset: number;
    modern_format_sources: boolean;
  };
  images?: ImageFinding[];
  images_not_reported?: number;
  issue_counts?: Record<string, number>;
  top_fixes?: string[];
}

function basenameNoExt(src: string): string {
  try {
    const path = new URL(src).pathname;
    const base = path.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(base.replace(/\.[a-z0-9]+$/i, ""));
  } catch {
    return "";
  }
}

function classifyFilename(src: string): ImageFinding["filename_status"] {
  const base = basenameNoExt(src);
  if (!base) return "ok";
  if (GENERIC_FILENAME.test(base) || STOCK_FILENAME.test(base) || /^\d+$/.test(base)) {
    return "generic_or_nondescriptive";
  }
  if (/^[0-9a-f]{16,}$/i.test(base.replace(/-/g, ""))) return "hash_or_id";
  return "ok";
}

function classifyAlt(
  alt: string | null,
  src: string,
  duplicateAlts: Set<string>
): ImageFinding["alt_status"] {
  if (alt === null) return "missing";
  const trimmed = alt.trim();
  if (trimmed === "") return "empty";
  const lower = trimmed.toLowerCase();
  if (GENERIC_ALTS.has(lower)) return "generic";
  const base = basenameNoExt(src).toLowerCase().replace(/[-_]+/g, " ").trim();
  if (base && lower === base) return "filename_as_alt";
  if (duplicateAlts.has(lower)) return "duplicate";
  return "ok";
}

function walkForImageObjects(node: unknown, hits: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walkForImageObjects(item, hits);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("ImageObject")) hits.push(obj);
    for (const value of Object.values(obj)) walkForImageObjects(value, hits);
  }
}

const MAX_REDIRECTS = 4;

/**
 * Formats whose dimensions we can read.
 *
 * This used to be an allow-list protecting the `image-size` package from the
 * formats its unpatched advisories concerned. That package is gone: dimensions
 * are now read by ../image-dimensions.ts, which has no unbounded loops and
 * covers exactly these families. The set derives from that module so the two
 * cannot drift apart.
 *
 * The format is still decided from the file's own magic bytes, never from a
 * server-supplied Content-Type, because a server that mislabels its images is
 * itself a finding — and because trusting the header would let a caller pick
 * which parser runs. ICNS, JXL, HEIC and AVIF are simply not measured; their
 * dimensions come back null with a stated reason.
 */
const DIMENSION_SAFE_FORMATS = new Set(MEASURABLE_FORMATS);

/** Exported for the hardening regression suite. */
export function dimensionsAreSafeFor(format: string | null): boolean {
  return format !== null && DIMENSION_SAFE_FORMATS.has(format);
}

/**
 * Real media type for a sniffed container.
 *
 * `format` is reported in the tool's output and read by a model, so it has to
 * be an actual media type rather than `image/` glued to an internal label —
 * `image/svg` and `image/isobmff` are not types that exist. `isobmff` maps to
 * nothing useful (it is a container family, not an image format), so callers
 * fall back to the server's own Content-Type for it.
 */
const SNIFFED_MEDIA_TYPE: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  jxl: "image/jxl",
  icns: "image/x-icns",
};

export function mediaTypeFor(sniffed: string | null): string | null {
  return sniffed ? SNIFFED_MEDIA_TYPE[sniffed] ?? null : null;
}

/** True container format from magic bytes, or null when unrecognised. */
export function sniffImageFormat(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 6).toString("latin1") === "GIF89a" || buf.subarray(0, 6).toString("latin1") === "GIF87a") return "gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "bmp";
  if (buf.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]))) return "tiff";
  if (buf.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return "tiff";
  if (buf.subarray(0, 4).toString("latin1") === "icns") return "icns";
  // JPEG XL: bare codestream, or the ISOBMFF-boxed form.
  if (buf[0] === 0xff && buf[1] === 0x0a) return "jxl";
  if (buf.subarray(0, 12).equals(Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]))) return "jxl";

  // ISOBMFF: the brand at bytes 8-12 separates AVIF/HEIC from other MP4-ish files.
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "avif";
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("hevc") || brand.startsWith("mif1")) return "heic";
    return "isobmff";
  }

  // SVG is text; only sniff the leading non-whitespace bytes.
  const head = buf.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";

  return null;
}

/**
 * Every fetch this tool makes goes through safeFetch, which owns the whole
 * request: one deadline covering headers AND body, a hard byte ceiling applied
 * while streaming, address validation at connect time, and per-hop redirect
 * re-validation.
 *
 * The previous implementation cleared its abort timer in a `finally` that ran
 * when the Response object was returned — i.e. before any caller read the
 * body — so page HTML and image bytes were downloaded with no time limit and
 * no size limit at all.
 *
 * Locally the address checks are skipped: this runs on the user's own machine,
 * where auditing a dev server on localhost is a legitimate thing to want.
 */
function fetchGuarded(url: string, timeoutMs: number, maxBytes: number) {
  return safeFetch(url, {
    timeoutMs,
    maxBytes,
    userAgent: USER_AGENT,
    maxRedirects: MAX_REDIRECTS,
    allowPrivate: !isRemoteMode(),
  });
}

async function auditImage(
  src: string,
  fetchMetadata: boolean
): Promise<Partial<ImageFinding>> {
  const result: Partial<ImageFinding> = { fetched: false };
  const response = await fetchGuarded(src, IMAGE_TIMEOUT_MS, MAX_IMAGE_BYTES);
  if (response.status < 200 || response.status >= 300) return result;

  // safeFetch stopped reading at MAX_IMAGE_BYTES; a truncated image tells us
  // nothing reliable about dimensions or metadata, so it is not "fetched".
  if (response.truncated) return result;

  const buffer = response.body;
  if (buffer.length === 0) return result;

  result.fetched = true;
  result.bytes = buffer.length;
  const contentType = String(response.headers["content-type"] ?? "");
  const sniffed = sniffImageFormat(buffer);
  // Prefer what the bytes say over what the server claims — a server
  // mislabelling a PNG as image/jpeg is itself worth reporting — but fall back
  // to the header when the container maps to no specific media type.
  result.format = mediaTypeFor(sniffed) ?? contentType.split(";")[0].trim() ?? null;
  if (result.format === "") result.format = null;

  if (sniffed && DIMENSION_SAFE_FORMATS.has(sniffed)) {
    const dims = imageDimensions(buffer, sniffed);
    result.intrinsic_width = dims?.width ?? null;
    result.intrinsic_height = dims?.height ?? null;
    if (dims) {
      result.below_indexing_minimum =
        dims.width * dims.height < INDEX_MIN_AREA ||
        dims.width < INDEX_MIN_WIDTH ||
        dims.height < INDEX_MIN_HEIGHT;
    }
  } else {
    // Dimensions deliberately unread — see DIMENSION_SAFE_FORMATS. Say so in
    // the finding so a null is never mistaken for "the image has no size".
    result.intrinsic_width = null;
    result.intrinsic_height = null;
    result.dimensions_unread_reason = sniffed
      ? `${sniffed} dimensions are not read: the parser has an unpatched denial-of-service advisory for this format`
      : "dimensions are not read: the file's format could not be identified from its bytes";
  }

  result.weight_status =
    buffer.length > OVERSIZED_BYTES
      ? "oversized"
      : buffer.length > HEAVY_BYTES
        ? "heavy"
        : "ok";
  result.png_likely_photo =
    result.format === "image/png" && buffer.length > PNG_PHOTO_BYTES;

  // Embedded metadata lives in JPEG/TIFF/PNG/WebP for practical purposes, and
  // restricting the parser to formats we already identified keeps unknown
  // containers away from a second parsing library.
  const METADATA_FORMATS = new Set(["jpeg", "tiff", "png", "webp"]);

  if (fetchMetadata && sniffed && METADATA_FORMATS.has(sniffed)) {
    try {
      const meta = await exifr.parse(buffer, {
        tiff: true,
        exif: true,
        gps: true,
        iptc: true,
        xmp: true,
      });
      if (meta) {
        result.metadata = {
          camera_exif_present: Boolean(meta.Make || meta.Model || meta.ISO),
          gps_present: Boolean(meta.latitude || meta.longitude || meta.GPSLatitude),
          iptc_creator: Boolean(meta.Creator || meta["By-line"] || meta.Byline || meta.creator),
          iptc_copyright: Boolean(meta.Copyright || meta.CopyrightNotice || meta.rights),
          iptc_caption: Boolean(meta.Caption || meta["Caption-Abstract"] || meta.description),
          digital_source_type:
            typeof meta.DigitalSourceType === "string"
              ? meta.DigitalSourceType.split("/").pop() ?? null
              : null,
        };
      } else {
        result.metadata = null;
      }
    } catch {
      result.metadata = null;
    }
  }

  return result;
}

function imageIssues(finding: ImageFinding): string[] {
  const issues: string[] = [];
  if (finding.alt_status === "missing") issues.push("alt attribute missing");
  if (finding.alt_status === "generic") issues.push("generic alt text");
  if (finding.alt_status === "filename_as_alt") issues.push("alt text is just the filename");
  if (finding.alt_status === "duplicate") issues.push("alt text duplicated on this page");
  if (finding.filename_status !== "ok") issues.push("non-descriptive filename");
  if (!finding.has_width_height_attrs) issues.push("no width/height attributes (layout shift)");
  if (finding.below_indexing_minimum) issues.push("below Google's ~250x200 indexing minimum");
  if (finding.weight_status === "oversized") issues.push("over 500KB");
  if (finding.png_likely_photo) issues.push("photo shipped as PNG (use WebP/AVIF)");
  if (finding.metadata?.gps_present) issues.push("GPS coordinates in EXIF (privacy)");
  return issues;
}

export async function imagePageAudit(
  urls: string[],
  fetchMetadata: boolean = true,
  maxImagesPerPage: number = 12,
  maxImagesReported: number = 20
): Promise<{ audits: PageAudit[]; overall: Record<string, unknown> }> {
  const audits: PageAudit[] = [];

  for (const rawUrl of urls.slice(0, 5)) {
    const audit: PageAudit = { url: rawUrl, status: "ok", http_status: null };
    audits.push(audit);

    let response: Awaited<ReturnType<typeof fetchGuarded>>;
    try {
      response = await fetchGuarded(rawUrl, PAGE_TIMEOUT_MS, MAX_PAGE_BYTES);
    } catch (error) {
      audit.status = "fetch_failed";
      audit.error = error instanceof Error ? error.message : String(error);
      continue;
    }
    audit.http_status = response.status;
    if (response.status < 200 || response.status >= 300) {
      audit.status = "fetch_failed";
      audit.error = `HTTP ${response.status}`;
      continue;
    }
    if (response.truncated) {
      audit.status = "fetch_failed";
      audit.error = `Page exceeded the ${Math.round(MAX_PAGE_BYTES / 1024 / 1024)}MB fetch limit and was not parsed.`;
      continue;
    }

    const html = response.body.toString("utf8");
    const root = parse(html);
    const pageUrl = response.url || rawUrl;

    // ── Page-level checks ────────────────────────────────────────────
    const robotsContent = root
      .querySelectorAll('meta[name="robots"], meta[name="googlebot"]')
      .map((m: HTMLElement) => m.getAttribute("content") ?? "")
      .join(",");
    const previewMatch = robotsContent.match(/max-image-preview:\s*(\w+)/i);

    const ldBlocks = root.querySelectorAll('script[type="application/ld+json"]');
    const imageObjects: Record<string, unknown>[] = [];
    let hasPrimaryImage = false;
    for (const block of ldBlocks) {
      try {
        const json = JSON.parse(block.textContent);
        walkForImageObjects(json, imageObjects);
        if (JSON.stringify(json).includes("primaryImageOfPage")) hasPrimaryImage = true;
      } catch {
        // Malformed JSON-LD is its own problem, but not this tool's.
      }
    }
    const hasLicensable = imageObjects.some(
      (o) => o.license || o.acquireLicensePage || o.creditText || o.copyrightNotice
    );

    const backgroundCount = root
      .querySelectorAll("[style]")
      .filter((el: HTMLElement) =>
        /background(-image)?\s*:\s*url\(/i.test(el.getAttribute("style") ?? "")
      ).length;

    const modernSources = root
      .querySelectorAll("picture source")
      .some((s: HTMLElement) => /image\/(avif|webp)/i.test(s.getAttribute("type") ?? ""));

    // ── Collect content images ───────────────────────────────────────
    const imgElements = root.querySelectorAll("img");
    interface Candidate {
      el: HTMLElement;
      src: string;
      jsLazy: boolean;
    }
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    for (const el of imgElements) {
      // JS lazy-loaders (WP Rocket, Smush, LiteSpeed, Autoptimize) put an
      // inline data: placeholder in src and the real URL in a data-* attr,
      // so a data: src means "unset", not "skip the image".
      const attrSrc = el.getAttribute("src");
      const directSrc = attrSrc && !attrSrc.startsWith("data:") ? attrSrc : null;
      const lazySrc =
        el.getAttribute("data-src") ??
        el.getAttribute("data-lazy-src") ??
        el.getAttribute("data-original");
      let src =
        directSrc ??
        lazySrc ??
        (el.getAttribute("srcset") ?? "").split(/[\s,]+/)[0] ??
        "";
      if (!src || src.startsWith("data:")) continue;
      try {
        src = new URL(src, pageUrl).href;
      } catch {
        continue;
      }
      if (seen.has(src)) continue;
      seen.add(src);
      candidates.push({ el, src, jsLazy: directSrc === null && lazySrc !== null });
    }

    const isIconLike = (c: Candidate): boolean => {
      const w = Number(c.el.getAttribute("width") ?? "0");
      const h = Number(c.el.getAttribute("height") ?? "0");
      if ((w && w < 100) || (h && h < 100)) return true;
      return /logo|icon|avatar|favicon|badge|emoji/i.test(c.src);
    };

    const contentImages = candidates.filter((c) => !isIconLike(c));
    const svgImages = contentImages.filter((c) => /\.svg(\?|$)/i.test(c.src));
    const fetchable = contentImages.filter((c) => !/\.svg(\?|$)/i.test(c.src));

    const lcpCandidate = contentImages[0] ?? null;

    // Duplicate alt detection across the page.
    const altCounts = new Map<string, number>();
    for (const c of contentImages) {
      const alt = c.el.getAttribute("alt");
      if (alt && alt.trim()) {
        const key = alt.trim().toLowerCase();
        altCounts.set(key, (altCounts.get(key) ?? 0) + 1);
      }
    }
    const duplicateAlts = new Set(
      [...altCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k)
    );

    // ── Per-image findings ───────────────────────────────────────────
    const findings: ImageFinding[] = [];
    for (const c of contentImages) {
      const alt = c.el.hasAttribute("alt") ? (c.el.getAttribute("alt") ?? "") : null;
      const finding: ImageFinding = {
        src: c.src,
        alt,
        alt_status: classifyAlt(alt, c.src, duplicateAlts),
        filename_status: classifyFilename(c.src),
        has_width_height_attrs:
          c.el.hasAttribute("width") && c.el.hasAttribute("height"),
        loading: c.el.getAttribute("loading") ?? (c.jsLazy ? "lazy" : null),
        fetchpriority: c.el.getAttribute("fetchpriority") ?? null,
        has_srcset: c.el.hasAttribute("srcset") || c.el.hasAttribute("data-srcset"),
        fetched: false,
        format: null,
        bytes: null,
        intrinsic_width: null,
        intrinsic_height: null,
        below_indexing_minimum: null,
        weight_status: null,
        png_likely_photo: null,
        metadata: null,
        issues: [],
      };
      findings.push(finding);
    }

    const toFetch = findings
      .filter((f) => fetchable.some((c) => c.src === f.src))
      .slice(0, maxImagesPerPage);
    for (const finding of toFetch) {
      try {
        Object.assign(finding, await auditImage(finding.src, fetchMetadata));
      } catch {
        // Fetch failure on one image never sinks the audit.
      }
    }

    for (const finding of findings) finding.issues = imageIssues(finding);

    // ── Summaries ────────────────────────────────────────────────────
    const issueCounts: Record<string, number> = {};
    for (const finding of findings) {
      for (const issue of finding.issues) {
        issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
      }
    }

    const lcpLazy = lcpCandidate
      ? (lcpCandidate.el.getAttribute("loading") ?? "").toLowerCase() === "lazy" ||
        lcpCandidate.jsLazy
      : null;

    const topFixes: string[] = [];
    if (lcpLazy) topFixes.push("Remove loading=\"lazy\" from the LCP image and add fetchpriority=\"high\"");
    const altBroken =
      (issueCounts["alt attribute missing"] ?? 0) +
      (issueCounts["generic alt text"] ?? 0) +
      (issueCounts["alt text is just the filename"] ?? 0);
    if (altBroken > 0) topFixes.push(`Rewrite alt text on ${altBroken} image(s) to describe what the image shows`);
    if (issueCounts["below Google's ~250x200 indexing minimum"])
      topFixes.push(`Re-export ${issueCounts["below Google's ~250x200 indexing minimum"]} image(s) above 250x200; below that Google skips them`);
    if ((issueCounts["over 500KB"] ?? 0) + (issueCounts["photo shipped as PNG (use WebP/AVIF)"] ?? 0) > 0)
      topFixes.push("Convert heavy PNG/oversized images to WebP or AVIF");
    if (issueCounts["non-descriptive filename"])
      topFixes.push(`Rename ${issueCounts["non-descriptive filename"]} image file(s) to subject-modifier-context form`);
    if (imageObjects.length === 0)
      topFixes.push("Add ImageObject schema (with about/mainEntity) for the page's key images");
    if (!previewMatch) topFixes.push("Add max-image-preview:large to the robots meta for full-size previews");

    audit.page_checks = {
      total_img_tags: imgElements.length,
      content_images: contentImages.length,
      images_fetched: toFetch.length,
      lcp_candidate_src: lcpCandidate?.src ?? null,
      lcp_candidate_lazy_loaded: lcpLazy,
      lcp_candidate_fetchpriority: lcpCandidate?.el.getAttribute("fetchpriority") ?? null,
      inline_background_images: backgroundCount,
      max_image_preview: previewMatch ? previewMatch[1].toLowerCase() : "not_set",
      image_object_schema_count: imageObjects.length,
      has_licensable_fields: hasLicensable,
      has_primary_image_of_page: hasPrimaryImage,
      images_with_srcset: findings.filter((f) => f.has_srcset).length,
      modern_format_sources: modernSources,
    };
    audit.images = findings.slice(0, maxImagesReported);
    audit.images_not_reported = Math.max(0, findings.length - maxImagesReported);
    audit.issue_counts = issueCounts;
    audit.top_fixes = topFixes;
    void svgImages;
  }

  const overall: Record<string, unknown> = {
    pages_audited: audits.filter((a) => a.status === "ok").length,
    pages_failed: audits.filter((a) => a.status !== "ok").length,
    total_issues: audits.reduce(
      (sum, a) =>
        sum + Object.values(a.issue_counts ?? {}).reduce((s, n) => s + n, 0),
      0
    ),
    note:
      "empty alt (alt=\"\") is correct for decorative images; it is reported but not counted as an issue.",
  };

  return { audits, overall };
}
