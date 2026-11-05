/**
 * Runs the HTML parser somewhere it cannot hurt anyone, and returns plain facts.
 *
 * image_page_audit parses whatever a caller-named server returns. node-html-parser's
 * cost is not bounded by the byte cap and cannot be predicted from the outside:
 * its cleanup of unclosed and stray-closed tags is superlinear in shapes that
 * depend on the parser's own element tables. Measured, a 36 KB page of
 * "<div></i>" repeated took 3 s, 72 KB took 29 s, and a 407 KB page took over two
 * minutes, all synchronous on the one event loop every tenant shares.
 *
 * An earlier version tried to refuse such pages with a scan that modelled the
 * parser. That cannot be made right: every divergence between the model and the
 * parser is a bypass, and reviewers found several within minutes. So the REAL
 * parser runs, in a worker thread, under a hard timeout and a memory ceiling,
 * and the worker returns only the handful of facts the audit reads. A hostile
 * page can burn one worker for the timeout; it cannot touch the event loop.
 */
import { Worker } from "node:worker_threads";
import * as path from "node:path";
import { parse, type HTMLElement } from "node-html-parser";

import { createLimiter } from "./concurrency.js";

export interface ImgFact {
  src: string | null;
  /** data-src, else data-lazy-src, else data-original (JS lazy-loader attributes). */
  lazySrc: string | null;
  srcset: string | null;
  width: string | null;
  height: string | null;
  alt: string | null;
  hasAlt: boolean;
  hasWidth: boolean;
  hasHeight: boolean;
  loading: string | null;
  fetchpriority: string | null;
  /** srcset or data-srcset present. */
  hasSrcset: boolean;
}

export interface PageFacts {
  robotsContent: string;
  /** Text of up to MAX_LD_BLOCKS JSON-LD scripts, each cut at MAX_LD_CHARS. */
  ldTexts: string[];
  backgroundCount: number;
  modernSources: boolean;
  totalImgTags: number;
  /** The first MAX_IMG_FACTS <img> elements; a page past that is reported, not walked. */
  imgs: ImgFact[];
}

export const MAX_IMG_FACTS = 2000;
const MAX_LD_BLOCKS = 50;
const MAX_LD_CHARS = 256 * 1024;

/** The pure extraction. Runs inside the worker; exported so it can be unit-tested. */
export function extractFacts(html: string): PageFacts {
  const root = parse(html);
  const attr = (el: HTMLElement, name: string): string | null => el.getAttribute(name) ?? null;

  const robotsContent = root
    .querySelectorAll('meta[name="robots"], meta[name="googlebot"]')
    .map((m: HTMLElement) => m.getAttribute("content") ?? "")
    .join(",");

  const ldTexts = root
    .querySelectorAll('script[type="application/ld+json"]')
    .slice(0, MAX_LD_BLOCKS)
    .map((b: HTMLElement) => b.textContent.slice(0, MAX_LD_CHARS));

  const backgroundCount = root
    .querySelectorAll("[style]")
    .filter((el: HTMLElement) => /background(-image)?\s*:\s*url\(/i.test(el.getAttribute("style") ?? "")).length;

  const modernSources = root
    .querySelectorAll("picture source")
    .some((s: HTMLElement) => /image\/(avif|webp)/i.test(s.getAttribute("type") ?? ""));

  const all = root.querySelectorAll("img");
  const imgs: ImgFact[] = all.slice(0, MAX_IMG_FACTS).map((el: HTMLElement) => ({
    src: attr(el, "src"),
    lazySrc: el.getAttribute("data-src") ?? el.getAttribute("data-lazy-src") ?? el.getAttribute("data-original") ?? null,
    srcset: attr(el, "srcset"),
    width: attr(el, "width"),
    height: attr(el, "height"),
    alt: attr(el, "alt"),
    hasAlt: el.hasAttribute("alt"),
    hasWidth: el.hasAttribute("width"),
    hasHeight: el.hasAttribute("height"),
    loading: attr(el, "loading"),
    fetchpriority: attr(el, "fetchpriority"),
    hasSrcset: el.hasAttribute("srcset") || el.hasAttribute("data-srcset"),
  }));

  return { robotsContent, ldTexts, backgroundCount, modernSources, totalImgTags: all.length, imgs };
}

export class PageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageParseError";
  }
}

/** A legitimate page parses in tens of milliseconds; this is generous. Read per call. */
const parseTimeoutMs = (): number => Number(process.env.GSC_PARSE_TIMEOUT_MS ?? 2000);

/** At most this many parser workers exist at once, process-wide. */
const parseLimiter = createLimiter("page parse", 2, 20_000);

export function extractPageFacts(html: string): Promise<PageFacts> {
  return parseLimiter(
    () =>
      new Promise<PageFacts>((resolve, reject) => {
        const timeoutMs = parseTimeoutMs();
        const worker = new Worker(path.join(__dirname, "page-extract-worker.js"), {
          workerData: html,
          resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
        });
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          void worker.terminate();
          fn();
        };
        const timer = setTimeout(
          () =>
            finish(() =>
              reject(new PageParseError(`Page not analysed: it took longer than ${Math.round(timeoutMs / 1000)}s to parse, which a real page does not.`))
            ),
          timeoutMs
        );
        worker.once("message", (facts: PageFacts) => finish(() => resolve(facts)));
        worker.once("error", (err: Error) =>
          finish(() => reject(new PageParseError(`Page not analysed: the parser failed (${err.message.slice(0, 120)}).`)))
        );
        worker.once("exit", (code) =>
          finish(() => reject(new PageParseError(`Page not analysed: the parser stopped unexpectedly (exit ${code}).`)))
        );
      })
  );
}
