/**
 * Choosing between the two representations every public page has: HTML for
 * browsers and the chat assistants that read what a browser would, Markdown for
 * the coding agents that ask for it with `Accept: text/markdown`.
 *
 * This is the part that is easy to get subtly wrong, and each way of getting it
 * wrong ships the wrong format to somebody:
 *
 *  - Substring-matching "markdown" in the header sends Markdown to a browser that
 *    said `text/html, text/markdown;q=0.5` — a client that said it prefers HTML.
 *    So q-values are compared, not searched for.
 *  - A strict "greater than" sends HTML to the coding agents that write
 *    `text/markdown, text/html`, both at q=1. A tie goes to Markdown...
 *  - ...but only when the client NAMED text/markdown. A browser's `*` + `/` + `*`
 *    ties too, through the wildcard, and must keep getting HTML. So a tie is
 *    broken toward Markdown only for an explicit match.
 *  - A client that accepts neither gets 406 rather than a silent substitution,
 *    which would hide its bug.
 *
 * Pure and dependency-free so the rules can be tested without a server.
 */

export type Representation = "html" | "markdown";

/** An Accept header is untrusted input; bound what it can make us do. */
const MAX_HEADER_CHARS = 1024;
const MAX_RANGES = 32;

interface MediaRange {
  type: string;
  subtype: string;
  q: number;
}

const TOKEN = "[a-z0-9!#$&^_.+-]+";
const RANGE = new RegExp(`^(${TOKEN}|\\*)/(${TOKEN}|\\*)$`);
// RFC 9110 weight: 0 to 1 with at most three decimals.
const WEIGHT = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

function parseAccept(header: string): MediaRange[] {
  const ranges: MediaRange[] = [];
  for (const part of header.slice(0, MAX_HEADER_CHARS).split(",").slice(0, MAX_RANGES)) {
    const [media, ...params] = part.split(";");
    const m = RANGE.exec(media.trim().toLowerCase());
    // `*` as a type needs a `*` subtype too; `*/html` is not a range.
    if (!m || (m[1] === "*" && m[2] !== "*")) continue;

    let q = 1;
    let valid = true;
    for (const raw of params) {
      const eq = raw.indexOf("=");
      if (eq < 0 || raw.slice(0, eq).trim().toLowerCase() !== "q") continue;
      const value = raw.slice(eq + 1).trim();
      if (WEIGHT.test(value)) q = Number(value);
      else valid = false;
      break;
    }
    // A malformed weight makes the range meaningless; ignore it rather than guess.
    if (valid) ranges.push({ type: m[1], subtype: m[2], q });
  }
  return ranges;
}

interface Score {
  q: number;
  /** True only when a range named this exact type, not one that matched by wildcard. */
  explicit: boolean;
}

/**
 * The weight a client gives one media type: that of the most specific range
 * that matches it (RFC 9110 section 12.5.1). No match means not acceptable.
 */
function scoreFor(ranges: MediaRange[], type: string, subtype: string): Score {
  let best: { specificity: number; q: number } | undefined;
  for (const r of ranges) {
    const specificity =
      r.type === type && r.subtype === subtype ? 2 :
      r.type === type && r.subtype === "*" ? 1 :
      r.type === "*" && r.subtype === "*" ? 0 : -1;
    if (specificity < 0) continue;
    if (!best || specificity > best.specificity || (specificity === best.specificity && r.q > best.q)) {
      best = { specificity, q: r.q };
    }
  }
  return best ? { q: best.q, explicit: best.specificity === 2 } : { q: 0, explicit: false };
}

/**
 * Which representation to send, or null when the client accepts neither
 * (answer 406).
 *
 * No Accept header, or one with nothing parseable in it, gets HTML: that is the
 * default a client that did not ask for anything in particular should receive,
 * and it keeps crawlers that send odd headers working.
 */
export function chooseRepresentation(accept: string | undefined): Representation | null {
  if (accept === undefined || accept.trim() === "") return "html";
  const ranges = parseAccept(accept);
  if (ranges.length === 0) return "html";

  const html = scoreFor(ranges, "text", "html");
  const markdown = scoreFor(ranges, "text", "markdown");
  if (html.q === 0 && markdown.q === 0) return null;
  if (markdown.q > html.q) return "markdown";
  if (markdown.q === html.q && markdown.explicit) return "markdown";
  return "html";
}
