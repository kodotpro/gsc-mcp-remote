/**
 * Pictures for the public pages: what a result looks like in a client that
 * renders the MCP Apps view, and how a question travels.
 *
 * They are drawn in HTML with the page's own styles (web-theme.ts, DEMO and
 * BLOCKS), not shipped as screenshots: the pages allow no script and only
 * same-origin images, HTML stays sharp and follows the theme, and a crawler or
 * a screen reader gets the numbers as text.
 *
 * Honesty rule. Everything on these pages that claims to be real output is real
 * (the captured examples in site-content.ts say when and against which site).
 * These are illustrations, so every one says "sample data" in its caption and
 * uses example.com. They follow the layouts in src/app-view/view.js column for
 * column; scripts/check-http.mjs checks the captions are there.
 */
import { esc } from "./web-theme.js";

const SAMPLE_PROPERTY = "sc-domain:example.com";
const CAPTION_SUFFIX = "Sample data, drawn to show the layout.";

function frame(title: string, sub: string, inner: string, caption: string, property: string | null = SAMPLE_PROPERTY): string {
  return `<figure class="demo st">
  <div class="demo-frame">
    <p class="demo-eyebrow">Search Console${property ? ` &middot; ${esc(property)}` : ""}</p>
    <p class="demo-title">${esc(title)}</p>
    <p class="demo-sub">${esc(sub)}</p>
    ${inner}
  </div>
  <figcaption>${caption} ${CAPTION_SUFFIX}</figcaption>
</figure>`;
}

function card(label: string, value: string, delta: string, tone: "good" | "bad" | ""): string {
  return `<div class="demo-card"><div class="k">${esc(label)}</div><div class="v">${esc(value)}</div>` +
    `<div class="d${tone ? ` ${tone}` : ""}">${esc(delta)}</div></div>`;
}

/** A number with a bar scaled against the largest in its column. */
function bar(text: string, share: number, negative = false): string {
  const width = Math.max(2, Math.min(100, Math.round(share * 100)));
  return `${esc(text)} <span class="hbar-track" aria-hidden="true"><span class="hbar${negative ? " neg" : ""}" style="width:${width}%"></span></span>`;
}

function table(head: [string, boolean][], rows: string[][]): string {
  const th = head.map(([label, numeric]) => `<th${numeric ? ' class="n"' : ""}>${esc(label)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.map((c, i) => `<td${head[i][1] ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="demo-tile"><table><tr>${th}</tr>${body}</table></div>`;
}

const tag = (text: string, tone: "ok" | "warn" | "err" | "" = ""): string =>
  `<span class="tag${tone ? ` ${tone}` : ""}">${esc(text)}</span>`;

export function demoSnapshot(): string {
  return frame(
    "Site snapshot",
    "Against the previous period · last 28 days",
    `<div class="demo-cards">
      ${card("Clicks", "4,210", "+8.23%", "good")}
      ${card("Impressions", "182,400", "-4.75%", "bad")}
      ${card("CTR", "2.31%", "+0.28 pts", "good")}
      ${card("Avg position", "14.2", "-1.3", "good")}
    </div>`,
    `<span class="tool-name">site_snapshot</span> as a client with MCP Apps shows it: four figures and how each moved. A lower position is better, so it is marked as good.`
  );
}

export function demoQuickWins(): string {
  const rows: [string, string, string, string, number][] = [
    ["search console mcp server", "4.2", "5,200", "1.2%", 410],
    ["connect search console to claude", "5.4", "4,780", "1.4%", 368],
    ["image seo audit tool", "6.6", "4,360", "1.6%", 326],
    ["content decay checker", "8.4", "3,730", "1.9%", 263],
  ];
  return frame(
    "Quick wins",
    "Queries at positions 4–15 that could reach page one · last 28 days",
    table(
      [["Query", false], ["Position", true], ["Impressions", true], ["CTR", true], ["Extra clicks", true]],
      rows.map(([q, pos, imp, ctr, extra]) => [esc(q), pos, imp, ctr, bar(String(extra), extra / 410)])
    ),
    `<span class="tool-name">quick_wins</span>: sortable by any column in the client, with the estimated gain drawn to scale.`
  );
}

export function demoTrafficDrops(): string {
  const rows: [string, string, string, number, string, string, "err" | "warn" | ""][] = [
    ["/blog/search-console-guide/", "120", "310", -190, "+4.9", "Ranking loss", "err"],
    ["/tools/", "80", "140", -60, "0", "CTR collapse", "warn"],
    ["/about/", "0", "42", -42, "0", "Page disappeared", "err"],
    ["/pricing/", "30", "44", -14, "-0.4", "Impression decline", ""],
  ];
  return frame(
    "Traffic drops",
    "Pages that lost clicks against the previous period · last 28 days",
    table(
      [["Page", false], ["Clicks", true], ["Before", true], ["Change", true], ["Position", true], ["Diagnosis", false]],
      rows.map(([page, now, before, change, pos, diagnosis, tone]) => [
        esc(page), now, before, `<span class="bad">${bar(String(change), Math.abs(change) / 190, true)}</span>`,
        `<span class="${pos.startsWith("+") ? "bad" : pos.startsWith("-") ? "good" : ""}">${esc(pos)}</span>`, tag(diagnosis, tone),
      ])
    ),
    `<span class="tool-name">traffic_drops</span>: each lost page with a diagnosis that tells a ranking loss from a CTR collapse or falling demand.`
  );
}

export function demoAlerts(): string {
  return frame(
    "Alerts",
    "Changes that need attention · last 7 days",
    `<div class="demo-cards">
      ${card("Critical", "2", "", "")}
      ${card("Warning", "1", "", "")}
      ${card("Total", "3", "", "")}
    </div>` +
    table(
      [["Severity", false], ["Query and page", false], ["What changed", false]],
      [
        [tag("critical", "err"), "search console mcp on /gsc/", "Clicks dropped from 100 to 30 (70% decline)"],
        [tag("critical", "err"), "seo audit on /audit/", "Had 25 clicks in the prior period, zero now"],
        [tag("warning", "warn"), "claude seo on /", "CTR dropped from 10% to 4% (60% decline)"],
      ]
    ),
    `<span class="tool-name">check_alerts</span>: what crossed a threshold, most severe first.`
  );
}

/**
 * How a question travels, and what stays where. Three boxes and two arrows in
 * HTML, so the words in it are text a reader can select and a crawler can read.
 */
export function flowDiagram(): string {
  return `<div class="flow st" role="group" aria-label="How a question travels">
  <div class="flow-node">
    <span class="k">1 &middot; You</span>
    <h3>Your Claude client</h3>
    <p>You ask a question in plain words. Claude picks a tool and sends the request.</p>
  </div>
  <div class="flow-arrow"><span>tool call</span><b aria-hidden="true">&rarr;</b></div>
  <div class="flow-node mid">
    <span class="k">2 &middot; This server</span>
    <h3>Reads, analyses, returns</h3>
    <p>Keeps your email and an encrypted Google token. Keeps none of your Search Console data.</p>
  </div>
  <div class="flow-arrow"><span>read-only, as you</span><b aria-hidden="true">&rarr;</b></div>
  <div class="flow-node">
    <span class="k">3 &middot; Google</span>
    <h3>Search Console API</h3>
    <p>Answers with live data for the properties your own account can see.</p>
  </div>
</div>`;
}
