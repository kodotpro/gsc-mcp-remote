#!/usr/bin/env node
/**
 * The Markdown representation of the public pages, and the rules that choose it.
 *
 * Credential-free and serverless: this renders the pages straight from dist/ and
 * exercises the pure modules (negotiate, markdown, robots). What only a running
 * server can show — headers, routes — is in check-http.mjs.
 *
 * Why these checks exist. The Markdown is generated from the HTML, never written
 * by hand, so the promise is "the same article, in another format". A converter
 * can keep that promise or quietly break it — drop a table row, swallow a code
 * block, leave a stray tag, lose a paragraph — and nothing visible fails. So the
 * checks compare the two forms against each other, page by page, rather than
 * asserting that some Markdown comes out.
 *
 * Run: node scripts/check-markdown.mjs
 */
import { parse } from "node-html-parser";
import { chooseRepresentation } from "../dist/negotiate.js";
import { htmlToMarkdown } from "../dist/markdown.js";
import { CONTENT_SIGNAL_DEFAULT, resolveContentSignal, robotsTxt } from "../dist/robots.js";
import { markdownPathFor } from "../dist/web-theme.js";
import { PUBLIC_PAGES, llmsFullTxt, pageMarkdown } from "../dist/web-guides.js";
import { PRODUCT_NAME } from "../dist/site-content.js";

const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
};

// ---------------------------------------------------------------------------
console.log("Content negotiation");
// ---------------------------------------------------------------------------
// [Accept header, expected]. null means 406. The comments name the way each row
// goes wrong if the rule is implemented the obvious way.
const NEGOTIATION = [
  [undefined, "html", "no header: the default"],
  ["", "html", "an empty header is no header"],
  ["*/*", "html", "curl and most clients: ties through the wildcard, and must not flip to Markdown"],
  ["text/html", "html", ""],
  ["text/markdown", "markdown", ""],
  ["TEXT/Markdown", "markdown", "media types are case-insensitive"],
  ["text/markdown, text/html", "markdown", "coding agents: both at q=1, Markdown named, so a strict > would wrongly send HTML"],
  ["text/html, text/markdown", "markdown", "order does not decide it"],
  ["text/html, text/markdown;q=0.5", "html", "prefers HTML: substring-matching 'markdown' would send Markdown to a browser"],
  ["text/markdown;q=0.5, text/html", "html", ""],
  ["text/html;q=0.9, text/markdown", "markdown", ""],
  ["text/html;q=0.001, text/markdown;q=0.002", "markdown", "weights are compared at full precision"],
  ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "html", "a real browser"],
  ["text/*", "html", "a wildcard ties but names nothing"],
  ["text/*, text/markdown", "markdown", "naming it breaks the tie"],
  ["*/*, text/markdown", "markdown", ""],
  ["text/html;q=0, text/markdown", "markdown", "HTML refused outright"],
  ["text/markdown;q=0, text/html", "html", "Markdown refused outright"],
  ["text/markdown;q=0, */*", "html", ""],
  ["image/png", null, "accepts neither"],
  ["application/json", null, ""],
  ["text/plain", null, "text/plain is not either of ours"],
  ["text/html;q=0", null, ""],
  ["text/html;q=0, text/markdown;q=0", null, ""],
  ["text/markdown;q=abc", "html", "a malformed weight is ignored, not guessed at, leaving nothing: the default"],
  ["text/markdown;q=1.5", "html", "out-of-range weight, likewise"],
  ["not a media type", "html", "unparseable: the default, so an odd crawler still gets a page"],
];
for (const [accept, expected, why] of NEGOTIATION) {
  const got = chooseRepresentation(accept);
  check(`Accept ${JSON.stringify(accept)} -> ${expected ?? "406"}${why ? ` (${why})` : ""}`, got === expected, `got ${got}`);
}
const t0 = Date.now();
const flood = chooseRepresentation("a/b,".repeat(200_000));
check("a huge Accept header is bounded, not parsed in full", Date.now() - t0 < 250 && flood === null, `${Date.now() - t0} ms -> ${flood}`);

// ---------------------------------------------------------------------------
console.log("\nHTML to Markdown, on constructs the pages use");
// ---------------------------------------------------------------------------
const md = (html, opts) => htmlToMarkdown(`<main>${html}</main>`, opts).trimEnd();

check("headings keep their level", md("<h1>A</h1><h2>B</h2><h3>C</h3>") === "# A\n\n## B\n\n### C");
check("a paragraph's text is not read as Markdown", md("<p>a &lt;b&gt; * _x_ [y] `z` \\</p>") === "a \\<b\\> \\* \\_x\\_ \\[y\\] \\`z\\` \\\\");
check("an underscore inside a word is left alone", md("<p>quick_wins and ctr_vs_benchmark</p>") === "quick_wins and ctr_vs_benchmark");
check("a line that looks like a heading is not one", md("<p># not a heading</p>") === "\\# not a heading");
check("a line that looks like a list item is not one", md("<p>- not a bullet</p>") === "\\- not a bullet");
check("inline code keeps its text", md("<p>run <code>a_b | c</code> now</p>") === "run `a_b | c` now");
check("inline code containing a backtick gets a longer fence", md("<p><code>a`b</code></p>") === "``a`b``");
check("a tool-name span reads as code", md('<p><span class="tool-name">quick_wins</span></p>') === "`quick_wins`");
check("links and emphasis convert", md('<p><a href="/x">go</a> <strong>b</strong> <em>i</em></p>') === "[go](/x) **b** *i*");
check("a link target's spaces and parentheses cannot end it early", md('<p><a href="/a b(c)">t</a></p>') === "[t](/a%20b%28c%29)");
check("a link with no text is dropped, not emitted empty", md('<p>x<a href="/y"></a></p>') === "x");
check("link targets can be rewritten", md('<p><a href="/claude">c</a></p>', { rewriteHref: (h) => `${h}.md` }) === "[c](/claude.md)");
check("a hard line break survives", md("<p>a<br>b</p>") === "a  \nb");
check("an unordered list", md("<ul><li>a</li><li>b</li></ul>") === "- a\n- b");
check("an ordered list", md("<ol><li>a</li><li>b</li></ol>") === "1. a\n2. b");
check("a nested list is indented under its item", md("<ul><li>a<ul><li>b</li></ul></li></ul>") === "- a\n  - b");
check("a table becomes a Markdown table", md("<table><tr><th>P</th><th>D</th></tr><tr><td><code>x</code></td><td>1</td></tr></table>") === "| P | D |\n| --- | --- |\n| `x` | 1 |");
check("a pipe in a cell cannot split it", md("<table><tr><th>a</th></tr><tr><td>x|y</td></tr></table>").includes("x\\|y"));
check("an empty cell stays a cell", md("<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td></td></tr></table>").endsWith("| 1 |  |"));
check("a code block's entities are decoded, its text untouched",
  md("<pre><code>&lt;div&gt; &amp; \"q\"\n  indented</code></pre>") === "```\n<div> & \"q\"\n  indented\n```");
check("a code block containing a fence gets a longer one", md("<pre><code>```\nx\n```</code></pre>").startsWith("````\n"));
check("a JSON code block is labelled json", md('<pre><code>{"a": 1}</code></pre>').startsWith("```json\n"));
check("code that is not JSON is not labelled json", md("<pre><code>{ not json }</code></pre>").startsWith("```\n"));
check("details keep their summary and their content", md("<details><summary>More</summary><p>inside</p></details>") === "**More**\n\ninside");
check("a figure's caption and code both survive", md("<figure><figcaption>cap</figcaption><pre><code>x</code></pre></figure>") === "cap\n\n```\nx\n```");
check("a breadcrumb reads as one line", md('<ol class="crumbs"><li><a href="/">Home</a></li><li>Here</li></ol>') === "[Home](/) › Here");
check("scripts, styles, svg and hidden elements are dropped",
  md('<p>a</p><script>x()</script><style>p{}</style><svg><path/></svg><div aria-hidden="true">hide</div><p>b</p>') === "a\n\nb");
check("an element it does not know keeps its text", md("<custom-thing>kept <b>bold</b></custom-thing>") === "kept **bold**");
check("only the selected parts are converted", htmlToMarkdown("<main><p>in</p></main><footer><p class=\"note\">out</p></footer>") === "in\n");
check("a second selector is appended after a rule", htmlToMarkdown("<main><p>in</p></main><footer><p class=\"note\">out</p></footer>", { select: ["main", "footer .note"] }) === "in\n\n---\n\nout\n");
check("a <main> inside a style comment is not mistaken for the page's", htmlToMarkdown("<style>/* <main> */a{}</style><main><p>real</p></main>") === "real\n");
check("deeply nested input terminates", htmlToMarkdown(`<main>${"<div>".repeat(5000)}x${"</div>".repeat(5000)}</main>`).length >= 0);

// ---------------------------------------------------------------------------
console.log("\nEvery page, HTML against Markdown");
// ---------------------------------------------------------------------------
const INFO = { publicUrl: "https://gsc.example.com", perUserSignIn: true, repoUrl: "https://github.com/example/gsc", contactEmail: "ops@example.invalid", stars: 7 };
const pagePaths = new Set(PUBLIC_PAGES.map((p) => p.path));
const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
/** Fenced blocks removed: what is left is prose, headings, lists and tables. */
const withoutFences = (m) => m.replace(/^ *```[\s\S]*?^ *```/gm, "");
/** ...and inline code too, for the check that no HTML is left in the prose. */
const withoutCode = (m) => withoutFences(m).replace(/`[^`\n]*`/g, "");
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The text of an element with a space wherever a tag was, so cells and list items do not run together. */
const spacedText = (el) => parse(el.innerHTML.replace(/<[^>]+>/g, " ")).text;
const unescapeMd = (s) => s.replace(/\\([\\`*[\]<>_#+-])/g, "$1");
const rewritten = (href) => {
  const m = /^([^?#]*)([?#][\s\S]*)?$/.exec(href);
  return m && pagePaths.has(m[1]) ? `${markdownPathFor(m[1])}${m[2] ?? ""}` : href;
};

for (const page of PUBLIC_PAGES) {
  const label = page.path;
  const html = page.render(INFO);
  const main = parse(html).querySelector("main");
  const out = pageMarkdown(page, INFO);
  const prose = withoutCode(out);

  // Headings: same text, same level, same order.
  const wantHeadings = main.querySelectorAll("h1,h2,h3,h4,h5,h6").map((h) => `${"#".repeat(Number(h.tagName[1]))} ${norm(h.text)}`);
  const gotHeadings = [...withoutFences(out).matchAll(/^(#{1,6}) (.+)$/gm)].map((m) => `${m[1]} ${norm(unescapeMd(m[2]).replace(/`/g, ""))}`);
  check(`${label}: headings match, in order`, JSON.stringify(wantHeadings) === JSON.stringify(gotHeadings),
    `html ${wantHeadings.length} vs markdown ${gotHeadings.length}`);
  check(`${label}: exactly one h1`, (withoutFences(out).match(/^# /gm) ?? []).length === 1);

  // Code blocks verbatim.
  // A block under a numbered step is indented to its item, which is what
  // CommonMark requires; everywhere else it must match exactly.
  const preBlocks = main.querySelectorAll("pre");
  const missingCode = preBlocks.filter((pre) => {
    const code = parse(pre.innerHTML).text.replace(/^\n/, "").replace(/\s+$/, "");
    return pre.closest("li")
      ? !new RegExp(code.split("\n").map(escapeRe).join("\\n {0,8}")).test(out)
      : !out.includes(code);
  });
  check(`${label}: all ${preBlocks.length} code blocks are present verbatim`, missingCode.length === 0, missingCode[0]?.innerHTML.slice(0, 60));

  // Tables: same number of rows.
  const wantRows = main.querySelectorAll("tr").length;
  const gotRows = (out.match(/^\| .* \|$/gm) ?? []).filter((l) => !/^(\| *---+ *)+\|$/.test(l)).length;
  check(`${label}: all ${wantRows} table rows are present`, wantRows === gotRows, `markdown has ${gotRows}`);

  // Links: every one with text, with its target (internal ones as .md).
  const links = main.querySelectorAll("a").filter((a) => a.getAttribute("href") && a.text.trim());
  const lostLinks = links.filter((a) => !out.includes(`](${rewritten(a.getAttribute("href")).replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`));
  check(`${label}: all ${links.length} links keep their target`, lostLinks.length === 0, lostLinks[0]?.getAttribute("href"));
  const stillHtml = links.filter((a) => pagePaths.has(a.getAttribute("href").split(/[?#]/)[0]) && out.includes(`](${a.getAttribute("href")})`));
  check(`${label}: links to other pages point at their Markdown`, stillHtml.length === 0, stillHtml[0]?.getAttribute("href"));

  // Nothing is left half-converted.
  const rawTag = /(?<!\\)<\/?[a-z][a-z0-9-]*[\s/>]/i.exec(prose);
  check(`${label}: no HTML tags left in the prose`, !rawTag, rawTag && prose.slice(rawTag.index, rawTag.index + 40));
  const entity = /&(?:amp|lt|gt|quot|#\d+|[a-z]+dquo|[a-z]+squo);/i.exec(prose);
  check(`${label}: no HTML entities left in the prose`, !entity, entity?.[0]);

  // No words lost: every word of the visible text is somewhere in the Markdown.
  const visible = parse(main.outerHTML);
  visible.querySelectorAll("pre").forEach((p) => p.remove()); // verified verbatim above
  const words = (t) => new Set((t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []));
  const have = words(unescapeMd(out));
  const lost = [...words(spacedText(visible))].filter((w) => !have.has(w));
  check(`${label}: no word of the page text is lost`, lost.length === 0, lost.slice(0, 5).join(", "));

  // The size and shape that make it useful to a fetcher with a budget.
  check(`${label}: Markdown is smaller than the HTML it came from`, out.length < html.length / 2, `${out.length} vs ${html.length}`);
  check(`${label}: ends with exactly one newline`, /[^\n]\n$/.test(out));
  check(`${label}: is generated deterministically`, pageMarkdown(page, INFO) === out);
}

const landing = pageMarkdown(PUBLIC_PAGES.find((p) => p.path === "/"), INFO);
check("the landing page's h1 reads as one line, with its sub-line", landing.includes(`\n# ${PRODUCT_NAME}\n`), landing.split("\n").find((l) => l.startsWith("# ")));
check("the footer notice is added when asked for", pageMarkdown(PUBLIC_PAGES[0], INFO, { footer: true }).trimEnd().endsWith("trademarks of Google LLC."));
check("and not when it is not", !landing.includes("trademarks of Google LLC"));

// The HTML side of the same pages: the properties that let a fetcher find the
// content at all.
for (const page of PUBLIC_PAGES) {
  const html = page.render(INFO);
  // "<main" must occur exactly once: as the element. A CSS comment that said
  // "<main>" moved the apparent start of the content by 18 KB and fooled every
  // `grep -b '<main'` measurement of how early it begins. (Comparing the first
  // "<main" with the first "<main>" does not catch it: the comment had both.)
  const mainMentions = html.split("<main").length - 1;
  check(`${page.path}: "<main" appears once in the source, as the element`, mainMentions === 1 && html.includes("<main>"),
    `${mainMentions} occurrences`);
  // /llms.txt only helps if something points to it: an agent fetches it when it
  // is linked, not by guessing. The footer is on every page.
  check(`${page.path}: links /llms.txt`, html.includes('<a href="/llms.txt">'));
  // Claude Code's WebFetch reads the first 100,000 characters of a response.
  check(`${page.path}: the whole page is well inside a fetcher's 100,000-character budget`, html.length < 100_000, `${html.length}`);
  check(`${page.path}: its content starts before 40,000 characters`, html.indexOf("<main>") < 40_000, `${html.indexOf("<main>")}`);
}

// ---------------------------------------------------------------------------
console.log("\nllms-full.txt");
// ---------------------------------------------------------------------------
const full = llmsFullTxt(INFO);
check("every page appears, under its address", PUBLIC_PAGES.every((p) => full.includes(`\nSource: https://gsc.example.com${p.path}\n`)));
check("every page's text is in it", PUBLIC_PAGES.every((p) => full.includes(pageMarkdown(p, INFO).trimEnd())));
check("the trademark notice is stated once, at the end", /trademarks of Google LLC\.\n$/.test(full) && (full.match(/trademarks of Google LLC/g) ?? []).length === 1);
check("it opens with a title and a summary", full.startsWith(`# ${PRODUCT_NAME}: full text\n\n> `));

// ---------------------------------------------------------------------------
console.log("\nrobots.txt and Content-Signal");
// ---------------------------------------------------------------------------
const rd = resolveContentSignal(undefined);
check("by default everything is permitted", rd.value === "search=yes, ai-input=yes, ai-train=yes" && rd.value === CONTENT_SIGNAL_DEFAULT && !rd.ignored);
check("an empty value is the default", resolveContentSignal("  ").value === CONTENT_SIGNAL_DEFAULT && !resolveContentSignal("  ").ignored);
check("an operator can opt out of training alone", resolveContentSignal("search=yes, ai-input=yes, ai-train=no").value === "search=yes, ai-input=yes, ai-train=no");
check("a single signal is allowed", resolveContentSignal("ai-train=no").value === "ai-train=no");
for (const bad of ["search=yes\nDisallow: /", "search=maybe", "ai-train=no; Allow: /", "ai-train=no, ai-train=no, ai-train=no, ai-train=no", "search=yes,ai-input=yes", "anything"]) {
  const r = resolveContentSignal(bad);
  check(`${JSON.stringify(bad)} is refused and the default published`, r.ignored && r.value === CONTENT_SIGNAL_DEFAULT);
}
const robots = robotsTxt({ base: "https://gsc.example.com", contentSignal: rd.value });
check("the signal sits inside the * group, before its rules", robots.split("\n").slice(0, 3).join("|") === "User-agent: *|Content-Signal: search=yes, ai-input=yes, ai-train=yes|Allow: /");
check("the sitemap is announced for a published origin", robots.includes("Sitemap: https://gsc.example.com/sitemap.xml"));
check("no sitemap is announced without a public origin", !robotsTxt({ base: undefined, contentSignal: rd.value }).includes("Sitemap"));
check("endpoints that are not pages stay disallowed", /Disallow: \/oauth\/\n/.test(robots) && /Disallow: \/mcp\n/.test(robots));
check("no line can be smuggled in by the signal", robotsTxt({ base: undefined, contentSignal: resolveContentSignal("search=yes\nDisallow: /").value }).split("\n").filter((l) => l.startsWith("Disallow")).length === 2);

if (failures.length > 0) {
  console.error(`\nMarkdown tests: ${failures.length} failure(s).`);
  process.exit(1);
}
console.log("\nMarkdown tests: all checks passed.");
