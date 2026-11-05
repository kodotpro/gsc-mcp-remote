/**
 * HTML to Markdown, for the pages this server renders itself.
 *
 * The Markdown a coding agent gets must be the same article a browser shows, not
 * a second copy that can drift. So there is one source — the page's HTML — and
 * this converts it. That is also why it only has to understand the vocabulary
 * web-theme.ts and the page builders actually emit (headings, paragraphs,
 * lists, tables, code blocks, details/figure, inline code, links), not arbitrary
 * HTML. Anything it does not recognise is treated as a transparent container, so
 * its text is kept rather than dropped.
 *
 * Input is this server's own output, never a caller's HTML, which is why a
 * general-purpose parser with no extra hardening is acceptable here (contrast
 * page-extract.ts, which parses other people's pages and is hardened for it).
 */
import { parse, HTMLElement, TextNode, type Node } from "node-html-parser";

export interface MarkdownOptions {
  /**
   * CSS selectors whose content is converted, in this order, each separated from
   * the next by a horizontal rule. Default: the page's `main` element.
   */
  select?: string[];
  /** Rewrites every link target, for pointing internal links at their .md form. */
  rewriteHref?: (href: string) => string;
}

/** Elements with no readable content, or content that is chrome or decoration. */
const SKIP = new Set([
  "script", "style", "noscript", "svg", "template", "button", "form", "input", "select",
  "textarea", "iframe", "head", "link", "meta", "title", "img", "picture", "canvas",
]);

/** Elements that start a new block rather than flowing inside a line of text. */
const BLOCK = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "nav", "aside",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "pre", "blockquote",
  "hr", "details", "summary", "figure", "figcaption", "dl", "dt", "dd", "address",
]);

/** Deep enough for any page here; stops a pathological document recursing forever. */
const MAX_DEPTH = 64;

const isElement = (n: Node): n is HTMLElement => n instanceof HTMLElement;
const isText = (n: Node): n is TextNode => n instanceof TextNode;
const tagOf = (el: HTMLElement): string => (el.tagName ?? "").toLowerCase();
const hasClass = (el: HTMLElement, cls: string): boolean => el.classList.contains(cls);

// -- inline text ---------------------------------------------------------------

/**
 * Backslash-escapes what would otherwise be read as Markdown. Underscores
 * inside a word are left alone: CommonMark treats them as literal, and every
 * tool name here (quick_wins) would otherwise be littered with backslashes.
 */
function escapeText(s: string): string {
  return s
    .replace(/[\\`*[\]<>]/g, "\\$&")
    .replace(/_/g, (m, offset: number, whole: string) => {
      const before = whole[offset - 1] ?? "";
      const after = whole[offset + 1] ?? "";
      return /[A-Za-z0-9]/.test(before) && /[A-Za-z0-9]/.test(after) ? m : "\\_";
    });
}

/** A line that begins like a heading, bullet or numbered item must not become one. */
function escapeLineStart(line: string): string {
  return line.replace(/^(#{1,6}(?=\s)|[-+](?=\s)|\d+(?=[.)]\s))/, "\\$1");
}

function codeSpan(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t === "") return "";
  // The fence must be longer than any backtick run inside, and a span that
  // starts or ends with a backtick needs padding so the fence is not merged.
  const longest = Math.max(0, ...(t.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = t.startsWith("`") || t.endsWith("`") ? " " : "";
  return `${fence}${pad}${t}${pad}${fence}`;
}

function linkTarget(href: string): string {
  // Spaces and parentheses would end the destination early.
  return href.trim().replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** Wraps `inner` in a delimiter, keeping edge whitespace outside it. */
function wrap(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] === "" ? inner : `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

interface Ctx {
  rewriteHref: (href: string) => string;
  depth: number;
}

function inline(nodes: Node[], ctx: Ctx): string {
  let out = "";
  for (const node of nodes) {
    if (isText(node)) {
      out += escapeText(node.text.replace(/\s+/g, " "));
      continue;
    }
    if (!isElement(node)) continue;
    const tag = tagOf(node);
    if (SKIP.has(tag) || node.getAttribute("aria-hidden") === "true") continue;

    switch (tag) {
      case "br":
        out += "  \n";
        break;
      case "code":
      case "kbd":
        out += codeSpan(node.text);
        break;
      case "strong":
      case "b":
        out += wrap(inline(node.childNodes, ctx), "**");
        break;
      case "em":
      case "i":
        out += wrap(inline(node.childNodes, ctx), "*");
        break;
      case "a": {
        const text = inline(node.childNodes, ctx).trim();
        const href = node.getAttribute("href");
        out += href && text ? `[${text}](${linkTarget(ctx.rewriteHref(href))})` : text;
        break;
      }
      default:
        // A tool name is an identifier, so it reads as code wherever it appears.
        if (tag === "span" && hasClass(node, "tool-name")) out += codeSpan(node.text);
        else out += inline(node.childNodes, ctx);
    }
  }
  return out;
}

/** Inline content as one line: no hard breaks, whitespace collapsed. */
const oneLine = (nodes: Node[], ctx: Ctx): string =>
  inline(nodes, ctx).replace(/ {2}\n/g, " ").replace(/\s+/g, " ").trim();

/** A paragraph: inline content, with the edges and any run of spaces tidied. */
function paragraph(nodes: Node[], ctx: Ctx): string {
  return inline(nodes, ctx)
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, (m) => (m.length >= 2 ? "  " : "")).replace(/^[ \t]+/, ""))
    .join("\n")
    .replace(/ {3,}/g, " ")
    .trim();
}

// -- blocks --------------------------------------------------------------------

function codeBlock(pre: HTMLElement): string {
  // node-html-parser keeps a <pre>'s content as one raw text node, entities and
  // inner tags intact, so parse that fragment to get the characters the reader
  // sees (&lt; back to <) without the <code> wrapper.
  let text = parse(pre.innerHTML).text.replace(/\r\n?/g, "\n").replace(/^\n/, "").replace(/\s+$/, "");
  const lang = (pre.querySelector("code")?.classNames ?? "").match(/language-([\w-]+)/)?.[1] ?? jsonOrNothing(text);
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  if (text === "") text = " ";
  return `${fence}${lang}\n${text}\n${fence}`;
}

/** Marks a block as JSON when, and only when, it parses as JSON. */
function jsonOrNothing(text: string): string {
  const t = text.trim();
  if (!/^[{[]/.test(t)) return "";
  try {
    JSON.parse(t);
    return "json";
  } catch {
    return "";
  }
}

function table(el: HTMLElement, ctx: Ctx): string {
  const rows = el.querySelectorAll("tr").map((tr) =>
    tr.childNodes
      .filter(isElement)
      .filter((c) => ["th", "td"].includes(tagOf(c)))
      .map((c) => oneLine(c.childNodes, ctx).replace(/\|/g, "\\|"))
  ).filter((r) => r.length > 0);
  if (rows.length === 0) return "";

  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  // Markdown tables need a header row; the first row serves when there is no <th>.
  return [line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

function list(el: HTMLElement, ordered: boolean, ctx: Ctx): string {
  const items: string[] = [];
  let n = 0;
  for (const li of el.childNodes.filter(isElement).filter((c) => tagOf(c) === "li")) {
    const parts = blocks(li.childNodes, ctx);
    if (parts.length === 0) continue;
    n++;
    const marker = ordered ? `${n}. ` : "- ";
    const indent = " ".repeat(marker.length);
    // Nested lists continue the item on the next line; a second paragraph needs
    // a blank line to stay inside it.
    let body = parts[0];
    for (const part of parts.slice(1)) body += (/^(- |\d+\. )/.test(part) ? "\n" : "\n\n") + part;
    items.push(marker + body.split("\n").map((l, i) => (i === 0 ? l : l === "" ? l : indent + l)).join("\n"));
  }
  return items.join("\n");
}

/** A breadcrumb trail reads as one line, not as a numbered list. */
function breadcrumb(el: HTMLElement, ctx: Ctx): string {
  return el.querySelectorAll("li").map((li) => oneLine(li.childNodes, ctx)).filter(Boolean).join(" › ");
}

/**
 * Converts a run of child nodes to blocks. Inline content between block
 * elements is gathered into paragraphs; elements this does not recognise are
 * descended into, so their text survives.
 */
function blocks(nodes: Node[], ctx: Ctx): string[] {
  if (ctx.depth > MAX_DEPTH) return [];
  const deeper: Ctx = { ...ctx, depth: ctx.depth + 1 };
  const out: string[] = [];
  let run: Node[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const p = paragraph(run, ctx);
    run = [];
    if (p !== "") out.push(escapeLineStart(p));
  };

  for (const node of nodes) {
    if (!isElement(node)) {
      if (isText(node)) run.push(node);
      continue;
    }
    const tag = tagOf(node);
    if (SKIP.has(tag) || node.getAttribute("aria-hidden") === "true") continue;
    if (!BLOCK.has(tag)) {
      run.push(node);
      continue;
    }

    flush();
    if (/^h[1-6]$/.test(tag)) {
      const text = oneLine(node.childNodes, ctx);
      if (text) out.push(`${"#".repeat(Number(tag[1]))} ${text}`);
    } else if (tag === "pre") {
      out.push(codeBlock(node));
    } else if (tag === "table") {
      const t = table(node, deeper);
      if (t) out.push(t);
    } else if (tag === "ul" || tag === "ol") {
      if (node.getAttribute("aria-label")?.toLowerCase() === "breadcrumb" || hasClass(node, "crumbs")) {
        const b = breadcrumb(node, deeper);
        if (b) out.push(b);
      } else {
        const l = list(node, tag === "ol", deeper);
        if (l) out.push(l);
      }
    } else if (tag === "hr") {
      out.push("---");
    } else if (tag === "summary") {
      const text = oneLine(node.childNodes, ctx);
      if (text) out.push(`**${text}**`);
    } else if (tag === "blockquote") {
      const inner = blocks(node.childNodes, deeper).join("\n\n");
      if (inner) out.push(inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
    } else {
      // p, div, section, header, details, figure, figcaption, li outside a list...
      out.push(...blocks(node.childNodes, deeper));
    }
  }
  flush();
  return out;
}

/** The Markdown for the selected parts of an HTML document. */
export function htmlToMarkdown(html: string, options: MarkdownOptions = {}): string {
  const root = parse(html);
  const ctx: Ctx = { rewriteHref: options.rewriteHref ?? ((h) => h), depth: 0 };
  const sections: string[] = [];
  for (const selector of options.select ?? ["main"]) {
    const el = root.querySelector(selector);
    if (!el) continue;
    const md = blocks(el.childNodes, ctx).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    if (md) sections.push(md);
  }
  return sections.join("\n\n---\n\n") + "\n";
}
