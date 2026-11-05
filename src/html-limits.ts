/**
 * A cheap pre-parse gate on HTML fetched from an arbitrary page.
 *
 * image_page_audit hands whatever a caller-named server returns to a DOM parser
 * that runs synchronously on the one event loop every tenant shares. That
 * parser's cost is not bounded by the byte cap: unclosed nested tags make its
 * cleanup superlinear in the node count, and one 2 MB page can hold hundreds of
 * thousands of nodes. So the page is measured first, by a scan that is itself
 * linear, and refused if it is not a plausible web page.
 *
 * THE SCAN MUST STAY LINEAR. Every step either advances the cursor or moves a
 * monotonic pointer forward, and nothing is re-searched from each "<": a gate
 * that is quadratic on hostile input would only relocate the problem.
 */
export interface HtmlLimits {
  /** Opening and closing tags together, outside script/style text. */
  maxTags: number;
  /** Deepest nesting of tags that really nest (optional-close tags are excluded). */
  maxDepth: number;
  /** <img> elements: the tool does per-image work for each. */
  maxImgs: number;
}

export const DEFAULT_HTML_LIMITS: HtmlLimits = { maxTags: 60_000, maxDepth: 256, maxImgs: 4_000 };

export type HtmlAssessment = { ok: true } | { ok: false; reason: string };

/** Elements that never have content or a closing tag. */
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
/**
 * Elements whose closing tag HTML lets authors omit. Legacy markup leaves them
 * open by the thousand, and parsers close them implicitly rather than nesting,
 * so counting them toward depth would reject ordinary old pages.
 */
const OPTIONAL_CLOSE = new Set([
  "p", "li", "dt", "dd", "tr", "td", "th", "thead", "tbody", "tfoot", "option", "optgroup", "colgroup", "rt", "rp", "body", "head", "html",
]);
/** Elements whose content is raw text: "<" inside them is not markup. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

const isLetter = (c: number): boolean => (c >= 97 && c <= 122) || (c >= 65 && c <= 90);

export function assessHtmlComplexity(html: string, limits: HtmlLimits = DEFAULT_HTML_LIMITS): HtmlAssessment {
  const lower = html.toLowerCase();
  const n = lower.length;
  let i = 0;
  let tags = 0;
  let imgs = 0;
  let depth = 0;
  let gt = -1; // nearest ">" at or after the cursor, advanced monotonically

  while (i < n) {
    i = lower.indexOf("<", i);
    if (i < 0) break;
    const next = lower.charCodeAt(i + 1);

    // comments, doctype, CDATA, processing instructions: skip, never counted
    if (next === 33 /* ! */ || next === 63 /* ? */) {
      if (lower.startsWith("<!--", i)) {
        const close = lower.indexOf("-->", i + 4);
        if (close < 0) break;
        i = close + 3;
      } else {
        if (gt < i) gt = lower.indexOf(">", i);
        if (gt < 0) break;
        i = gt + 1;
      }
      continue;
    }

    const closing = next === 47; /* / */
    const nameStart = i + (closing ? 2 : 1);
    if (!isLetter(lower.charCodeAt(nameStart))) {
      i += 1; // a stray "<": not a tag, and the cursor still moves
      continue;
    }
    let nameEnd = nameStart + 1;
    while (nameEnd < n && nameEnd - nameStart < 32) {
      const c = lower.charCodeAt(nameEnd);
      if (isLetter(c) || (c >= 48 && c <= 57) || c === 45) nameEnd++;
      else break;
    }
    const name = lower.slice(nameStart, nameEnd);

    tags++;
    if (tags > limits.maxTags) return { ok: false, reason: `more than ${limits.maxTags} tags` };

    if (closing) {
      if (depth > 0 && !VOID.has(name) && !OPTIONAL_CLOSE.has(name)) depth--;
      i = nameEnd;
      continue;
    }

    if (name === "img") {
      imgs++;
      if (imgs > limits.maxImgs) return { ok: false, reason: `more than ${limits.maxImgs} <img> elements` };
    }

    if (gt < nameEnd) gt = lower.indexOf(">", nameEnd);
    const selfClosing = gt >= 0 && lower.charCodeAt(gt - 1) === 47;
    if (!VOID.has(name) && !OPTIONAL_CLOSE.has(name) && !selfClosing) {
      depth++;
      if (depth > limits.maxDepth) return { ok: false, reason: `nesting deeper than ${limits.maxDepth} levels` };
    }

    if (RAW_TEXT.has(name) && !selfClosing) {
      const close = lower.indexOf(`</${name}`, nameEnd);
      if (close < 0) break; // the rest of the document is raw text
      depth = Math.max(0, depth - 1);
      i = close + 2 + name.length;
      continue;
    }
    i = nameEnd;
  }
  return { ok: true };
}
