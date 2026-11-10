#!/usr/bin/env node
/**
 * The MCP Apps view (src/apps.ts, src/app-view/).
 *
 * Three things are checked.
 *
 *  1. The wiring a client sees: which tools name the view, that the resource is
 *     listed and readable with the MCP Apps MIME type, and what the sandbox is
 *     asked to allow.
 *  2. The page itself, by running the exact script a client would run. There is
 *     no browser here, so it runs against a small fake DOM and a fake host that
 *     speaks the protocol from the other side: handshake, tool result, theme,
 *     teardown.
 *  3. That third-party text cannot become markup. The fake DOM has no HTML
 *     parser at all and throws if the script reaches for one, and the source is
 *     scanned for the APIs that would.
 *
 * Run: node scripts/check-apps.mjs
 */
import * as fs from "node:fs";
import vm from "node:vm";

const { createServer } = await import("../dist/server-factory.js");
const { APP_MIME_TYPE, VIEW_TOOLS, VIEW_URI, viewFontOrigin, viewHtml, viewResourceMeta } = await import("../dist/apps.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) console.log(`  ok    ${label}`);
  else { console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); failures.push(label); }
};

// ---------------------------------------------------------------------------
console.log("What a client sees");
{
  const server = createServer();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "check-apps", version: "1" });
  await client.connect(clientSide);
  try {
    const { tools } = await client.listTools();
    const withView = tools.filter((t) => t._meta?.ui?.resourceUri).map((t) => t.name).sort();
    check("exactly the tools the view can draw point at it", JSON.stringify(withView) === JSON.stringify([...VIEW_TOOLS].sort()), withView.join(", "));
    check("each names the same resource, in both the current and the earlier spelling",
      tools.filter((t) => VIEW_TOOLS.has(t.name)).every((t) => t._meta.ui.resourceUri === VIEW_URI && t._meta["ui/resourceUri"] === VIEW_URI));
    check("no tool that changes anything has a view",
      tools.filter((t) => t.annotations?.readOnlyHint !== true).every((t) => !t._meta?.ui));
    check("the URI is a ui:// address", VIEW_URI.startsWith("ui://"));

    const { resources } = await client.listResources();
    const listed = resources.find((r) => r.uri === VIEW_URI);
    check("the view is listed as a resource with the MCP Apps MIME type", listed?.mimeType === APP_MIME_TYPE && APP_MIME_TYPE === "text/html;profile=mcp-app", JSON.stringify(listed));
    const read = await client.readResource({ uri: VIEW_URI });
    const item = read.contents[0];
    check("reading it returns one HTML document of that type", read.contents.length === 1 && item.mimeType === APP_MIME_TYPE && /^<!doctype html>/i.test(item.text));
    check("the document is small: it is fetched for every rendered result", item.text.length < 40_000, `${item.text.length} bytes`);
    check("it asks the host not to draw a second border", item._meta?.ui?.prefersBorder === false);

    const instructions = client.getInstructions() ?? "";
    check("the model is told not to rebuild a result the client already shows as a view", /do not rebuild it as an artifact/.test(instructions));
  } finally {
    await client.close();
    await server.close();
  }
}

// ---------------------------------------------------------------------------
console.log("What the sandbox is asked to allow");
{
  const local = viewHtml(null);
  check("a local install's page references no network address at all", !/https?:\/\//.test(local.replace(/\/\*[\s\S]*?\*\//g, "").replace(/https\?:/g, "")), (local.match(/https?:\/\/[^\s"')]+/g) ?? []).join(", "));
  check("...and so declares no CSP exception", viewResourceMeta(null).ui.csp === undefined);

  const hosted = viewHtml("https://gsc.example.com");
  const urls = [...new Set(hosted.match(/https:\/\/[^\s"')]+/g) ?? [])];
  check("a hosted page loads exactly one thing, its font, from its own origin",
    urls.length === 1 && urls[0] === "https://gsc.example.com/fonts/host-grotesk-latin.woff2", urls.join(", "));
  check("...and asks the sandbox for that origin only",
    JSON.stringify(viewResourceMeta("https://gsc.example.com").ui.csp) === JSON.stringify({ resourceDomains: ["https://gsc.example.com"] }));
  check("the font file it names is actually shipped", fs.existsSync(new URL("../dist/fonts/host-grotesk-latin.woff2", import.meta.url)));

  check("the font origin comes from GSC_PUBLIC_URL, reduced to its origin", viewFontOrigin("https://gsc.example.com/some/path/") === "https://gsc.example.com");
  for (const [value, why] of [[undefined, "no public URL"], ["", "an empty one"], ["http://gsc.example.com", "plain http"],
    ["https://user:pw@gsc.example.com", "one carrying credentials"], ["not a url", "garbage"], ["javascript:alert(1)", "a javascript: URL"]]) {
    check(`${why} gives no font origin, so nothing is requested`, viewFontOrigin(value) === null, String(viewFontOrigin(value)));
  }
}

// ---------------------------------------------------------------------------
console.log("The script cannot turn text into markup, or reach outside");
const source = fs.readFileSync(new URL("../src/app-view/view.js", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
{
  for (const api of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "DOMParser",
    "createContextualFragment", "srcdoc", "fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "localStorage", "sessionStorage",
    "document.cookie", "importScripts", "window.open", "location.href", "setAttribute(\"href\"", "setAttribute(\"src\""]) {
    check(`never uses ${api}`, !code.includes(api));
  }
  check("only ever listens to its own parent window", /if \(event\.source !== host\) return;/.test(code));
  const page = viewHtml(null);
  check("the page has one inline script and one inline style, and nothing external",
    (page.match(/<script/g) ?? []).length === 1 && (page.match(/<style/g) ?? []).length === 1 && !/<(link|img|iframe|object|embed|form)\b/i.test(page));
}

// ---------------------------------------------------------------------------
// A fake DOM: just enough for the script, and no way to parse HTML.
function makeDom() {
  class Node {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.className = ""; this.style = {}; this._text = "";
    }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    getBoundingClientRect() { return { height: 100 + this.allNodes().length, width: 700 }; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(_v) { throw new Error("innerHTML is not available: nothing may be parsed as markup"); }
    set outerHTML(_v) { throw new Error("outerHTML is not available"); }
    insertAdjacentHTML() { throw new Error("insertAdjacentHTML is not available"); }
    allNodes() { return this.children.flatMap((c) => [c, ...c.allNodes()]); }
    find(pred) { return this.allNodes().filter(pred); }
    click() { for (const fn of this.listeners.click ?? []) fn({ preventDefault() {} }); }
  }
  const html = new Node("html");
  const app = new Node("main");
  const created = [];
  const sent = [];
  const windowListeners = {};
  const parent = { postMessage: (msg, target) => sent.push({ msg, target }) };
  const window = {
    parent,
    addEventListener: (type, fn) => { (windowListeners[type] ??= []).push(fn); },
    matchMedia: () => ({ matches: false }),
  };
  const document = {
    documentElement: html,
    getElementById: (id) => (id === "app" ? app : null),
    createElement: (tag) => { const n = new Node(tag); created.push(n); return n; },
  };
  const deliver = (data, source = parent) => { for (const fn of windowListeners.message ?? []) fn({ data, source }); };
  return { window, document, app, html, sent, created, deliver, parent };
}

/** Loads the view, completes the handshake as a host would, returns the handles. */
async function boot({ theme } = {}) {
  const dom = makeDom();
  vm.runInNewContext(source, { window: dom.window, document: dom.document, Promise, Math, JSON, String, Array, Object, Number, isFinite, Error });
  const init = dom.sent.find((s) => s.msg.method === "ui/initialize");
  dom.deliver({ jsonrpc: "2.0", id: init.msg.id, result: { protocolVersion: init.msg.params.protocolVersion, hostInfo: { name: "t", version: "1" }, hostCapabilities: {}, hostContext: theme ? { theme } : {} } });
  await new Promise((r) => setTimeout(r, 0));
  return { ...dom, init };
}
const result = (tool, data, parameters = { days: 28, site_url: "sc-domain:example.com" }) => ({
  content: [{ type: "text", text: JSON.stringify({ _meta: { tool, parameters, note: "", untrusted_text: "" }, data }) }],
});
const toolResult = (dom, r) => dom.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: r });
const cells = (dom) => dom.app.find((n) => n.tagName === "tr").map((tr) => tr.children.map((td) => td.textContent));

// ---------------------------------------------------------------------------
console.log("The protocol, from the host's side");
{
  const dom = await boot({ theme: "dark" });
  check("the first thing it sends is ui/initialize, as a JSON-RPC request",
    dom.sent[0].msg.method === "ui/initialize" && dom.sent[0].msg.jsonrpc === "2.0" && dom.sent[0].msg.id !== undefined, JSON.stringify(dom.sent[0].msg));
  check("...naming itself and a protocol version", dom.init.msg.params.appInfo?.name === "gsc-mcp-view" && /^\d{4}-\d{2}-\d{2}$/.test(dom.init.msg.params.protocolVersion));
  check("after the host answers, it sends ui/notifications/initialized", dom.sent.some((s) => s.msg.method === "ui/notifications/initialized" && s.msg.id === undefined));
  check("it takes the theme from the host", dom.html.getAttribute("data-theme") === "dark");
  dom.deliver({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "light" } });
  check("...and follows it when the host changes it", dom.html.getAttribute("data-theme") === "light");

  dom.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: {} } });
  check("while the tool runs it says so", /Loading/.test(dom.app.textContent), dom.app.textContent);

  toolResult(dom, result("site_snapshot", { period: { startDate: "2026-01-01", endDate: "2026-01-28" },
    current: { clicks: 40, impressions: 400, ctr: 10, position: 5 }, change: { clicks: 20, clicksPercent: 100, impressions: 0, impressionsPercent: 0, ctr: 5, position: 1 } }));
  check("it tells the host how tall it became, so the frame can be sized",
    dom.sent.some((s) => s.msg.method === "ui/notifications/size-changed" && s.msg.params.height > 0));

  const before = dom.sent.length;
  dom.deliver({ jsonrpc: "2.0", id: 77, method: "ui/resource-teardown", params: {} });
  dom.deliver({ jsonrpc: "2.0", id: 78, method: "ping" });
  dom.deliver({ jsonrpc: "2.0", id: 79, method: "tools/call", params: { name: "disconnect_account" } });
  const replies = Object.fromEntries(dom.sent.slice(before).map((s) => [s.msg.id, s.msg]));
  check("it answers teardown and ping", replies[77]?.result !== undefined && replies[78]?.result !== undefined);
  check("it refuses any other request from the host instead of ignoring it", replies[79]?.error?.code === -32601);

  const text = dom.app.textContent;
  dom.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result("quick_wins", [{ query: "FORGED", opportunity: 1 }]) }, { postMessage() {} });
  check("ATTACK: a message from any window but the parent is ignored", dom.app.textContent === text && !/FORGED/.test(dom.app.textContent));
  check("it only ever posts to its parent", dom.sent.every((s) => s.target === "*") && dom.sent.length > 0);
  check("the only things it ever sends are the handshake, its size and replies",
    dom.sent.every((s) => ["ui/initialize", "ui/notifications/initialized", "ui/notifications/size-changed", undefined].includes(s.msg.method)),
    [...new Set(dom.sent.map((s) => s.msg.method))].join(", "));
}

// ---------------------------------------------------------------------------
console.log("Drawing results");
{
  const dom = await boot();
  toolResult(dom, result("site_snapshot", { period: { startDate: "2026-01-01", endDate: "2026-01-28" },
    current: { clicks: 4210, impressions: 182400, ctr: 2.31, position: 14.2 },
    change: { clicks: 320, clicksPercent: 8.23, impressions: -9100, impressionsPercent: -4.75, ctr: 0.28, position: -1.3 } }));
  const cards = dom.app.find((n) => n.className === "card").map((c) => c.children.map((x) => x.textContent));
  check("site_snapshot shows four cards with the exact figures",
    JSON.stringify(cards) === JSON.stringify([["Clicks", "4,210", "+8.23%"], ["Impressions", "182,400", "-4.75%"], ["CTR", "2.31%", "+0.28 pts"], ["Avg position", "14.2", "-1.3"]]), JSON.stringify(cards));
  const tones = dom.app.find((n) => /^d /.test(n.className)).map((n) => n.className);
  check("more clicks is good, fewer impressions is bad, and a LOWER position is good",
    JSON.stringify(tones) === JSON.stringify(["d good", "d bad", "d good", "d good"]), tones.join(" | "));
  check("the header names the property and the period", /sc-domain:example\.com/.test(dom.app.textContent) && /last 28 days/.test(dom.app.textContent));
}
{
  const dom = await boot();
  const rows = Array.from({ length: 20 }, (_, i) => ({ query: `q${i}`, clicks: i, impressions: 1000 + i, ctr: 1.5, position: 4 + i / 2, opportunity: 20 - i }));
  toolResult(dom, result("quick_wins", rows));
  let body = cells(dom).slice(1);
  check("a long table shows its first twelve rows", body.length === 12 && body[0][0] === "q0", `${body.length} rows`);
  check("numbers are formatted for reading", JSON.stringify(body[0]) === JSON.stringify(["q0", "4.0", "1,000", "1.5%", "20"]), JSON.stringify(body[0]));
  const more = dom.app.find((n) => n.tagName === "button")[0];
  check("...and offers the rest", more?.textContent === "Show all 20");
  more.click();
  check("which then appear", cells(dom).slice(1).length === 20 && more.textContent === "Show fewer");
  const headers = dom.app.find((n) => n.tagName === "th");
  headers[2].click();
  body = cells(dom).slice(1);
  check("clicking a numeric column sorts by it, largest first", body[0][0] === "q19" && headers[2].getAttribute("aria-sort") === "descending", body[0][0]);
  headers[2].click();
  check("clicking again reverses it", cells(dom).slice(1)[0][0] === "q0" && headers[2].getAttribute("aria-sort") === "ascending");
  const bars = dom.app.find((n) => n.tagName === "i").map((n) => n.style.width);
  check("the bar is scaled to the largest value in the column", bars.includes("100%") && bars.every((w) => /^\d+%$/.test(w)), bars.slice(0, 4).join(","));
}
{
  const dom = await boot();
  toolResult(dom, result("traffic_drops", [
    { page: "https://example.com/blog/a/", currentClicks: 120, priorClicks: 310, clickChange: -190, currentPosition: 9.1, priorPosition: 4.2, positionChange: 4.9, diagnosis: "Ranking loss" },
    { page: "https://example.com/b/", currentClicks: 80, priorClicks: 140, clickChange: -60, currentPosition: 3, priorPosition: 3, positionChange: 0, diagnosis: "CTR collapse (rankings stable, fewer clicks)" },
  ]));
  const body = cells(dom).slice(1);
  check("traffic_drops shows the path, the change and a short diagnosis",
    JSON.stringify(body[0]) === JSON.stringify(["/blog/a/", "120", "310", "-190", "+4.9", "Ranking loss"]) && body[1][5] === "CTR collapse", JSON.stringify(body));
  const firstCell = dom.app.find((n) => n.tagName === "td")[0];
  check("the full URL stays available on hover", firstCell.getAttribute("title") === "https://example.com/blog/a/");
  const pill = dom.app.find((n) => /^pill/.test(n.className))[1];
  check("...and so does the full diagnosis", pill.getAttribute("title") === "CTR collapse (rankings stable, fewer clicks)" && /warn/.test(pill.className));
}
{
  const dom = await boot();
  toolResult(dom, result("check_alerts", { summary: { critical: 2, warning: 1, info: 0, total: 3 },
    alerts: [{ severity: "critical", entity: "k on /p", detail: "Clicks dropped from 100 to 30 (70% decline)" }] }));
  const cards = dom.app.find((n) => n.className === "card").map((c) => c.children.map((x) => x.textContent).join(":"));
  check("check_alerts shows the counts and the alerts", JSON.stringify(cards) === JSON.stringify(["Critical:2", "Warning:1", "Total:3"]) &&
    /Clicks dropped from 100 to 30/.test(dom.app.textContent), cards.join(" "));
}
{
  const dom = await boot();
  toolResult(dom, result("cannibalization_check", [{ query: "gsc mcp", totalImpressions: 1900, pages: [
    { page: "https://example.com/gsc/", clicks: 90, impressions: 1200, position: 3.1 }, { page: "https://example.com/blog/", clicks: 12, impressions: 700, position: 7.3 }] }]));
  const body = cells(dom).slice(1);
  check("cannibalization_check groups the competing pages under their query",
    JSON.stringify(body) === JSON.stringify([["gsc mcp", "", "1,900", ""], ["/gsc/", "3.1", "1,200", "90"], ["/blog/", "7.3", "700", "12"]]), JSON.stringify(body));
}
{
  const dom = await boot();
  toolResult(dom, result("multi_site_dashboard", { periodDays: 28, sites: [
    { siteUrl: "sc-domain:a.com", current: { clicks: 10, impressions: 100, ctr: 10, position: 3 }, change: { clicksPercent: -22.5 }, health: "declining" }] }, {}));
  const body = cells(dom).slice(1);
  check("multi_site_dashboard lists each property with its change and health",
    JSON.stringify(body[0]) === JSON.stringify(["sc-domain:a.com", "10", "-22.5%", "100", "10%", "3.0", "declining"]), JSON.stringify(body[0]));
}
{
  const dom = await boot();
  toolResult(dom, { content: [{ type: "text", text: "unparseable" }],
    structuredContent: { _meta: { tool: "content_gaps", parameters: { days: 90 } }, data: [{ query: "typed", impressions: 500, clicks: 0, position: 35.4 }] } });
  check("a typed result (structuredContent) is drawn without parsing the text at all",
    JSON.stringify(cells(dom)[1]) === JSON.stringify(["typed", "500", "0", "35.4"]), JSON.stringify(cells(dom)[1]));
}
for (const tool of VIEW_TOOLS) {
  const dom = await boot();
  let threw = null;
  try {
    toolResult(dom, result(tool, tool === "site_snapshot" || tool === "check_alerts" || tool === "multi_site_dashboard" ? {} : []));
  } catch (e) { threw = e; }
  check(`${tool}: an empty result draws a sentence, not a crash or a blank frame`, !threw && dom.app.textContent.trim().length > 20, String(threw ?? dom.app.textContent));
}

// ---------------------------------------------------------------------------
console.log("Results that are not what the view expects");
{
  const dom = await boot();
  toolResult(dom, { isError: true, content: [{ type: "text", text: "This Google account does not have access to the Search Console property." }] });
  check("a tool error is shown as the error it is", /does not have access/.test(dom.app.textContent) && dom.app.find((n) => /err/.test(n.className)).length === 1);
  for (const [r, why] of [
    [{ content: [{ type: "text", text: "not json at all" }] }, "text that is not JSON"],
    [{ content: [] }, "no content"],
    [{ content: [{ type: "text", text: JSON.stringify({ _meta: { tool: "list_properties" }, data: {} }) }] }, "a tool it has no layout for"],
    [{ content: [{ type: "text", text: JSON.stringify({ _meta: { tool: "__proto__" }, data: [] }) }] }, "a tool named __proto__"],
    [{ content: [{ type: "text", text: JSON.stringify({ _meta: { tool: "constructor" }, data: [] }) }] }, "a tool named constructor"],
    [{ content: [{ type: "text", text: JSON.stringify({ _meta: { tool: "check_alerts" }, data: { summary: null, alerts: [null, "x"] } }) }] }, "alerts that are not objects"],
    [{ content: [{ type: "text", text: JSON.stringify({ _meta: { tool: "cannibalization_check" }, data: [{ query: "q", pages: "nope" }, 7] }) }] }, "pages that are not a list"],
    [{ content: [{ type: "text", text: JSON.stringify({ _meta: { tool: "multi_site_dashboard" }, data: { sites: [null, { siteUrl: 5 }] } }) }] }, "sites that are not objects"],
    [{ content: [{ type: "text", text: JSON.stringify({ _meta: { tool: "quick_wins" }, data: { not: "an array" } }) }] }, "data of the wrong shape"],
    [{ content: [{ type: "text", text: JSON.stringify({ _meta: { tool: "quick_wins" }, data: [null, 5, "x", { query: null, opportunity: "NaN" }] }) }] }, "rows that are not objects"],
    [{}, "an empty result"],
  ]) {
    let threw = null;
    try { toolResult(dom, r); } catch (e) { threw = e; }
    check(`${why} is handled without throwing`, !threw && dom.app.textContent.trim().length > 0, String(threw ?? ""));
  }
}

// ---------------------------------------------------------------------------
console.log("Hostile text in a result");
{
  const dom = await boot();
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  toolResult(dom, result("quick_wins", [{ query: evil, clicks: 1, impressions: 2, ctr: 3, position: 4, opportunity: 5 }], { days: 28, site_url: `sc-domain:${evil}` }));
  const tags = new Set(dom.created.map((n) => n.tagName));
  check("ATTACK: a query that is HTML is shown as the characters it is", cells(dom)[1][0] === evil, cells(dom)[1]?.[0]);
  check("...and creates no element the script did not ask for (no img, no script)",
    [...tags].every((t) => ["header", "p", "h1", "div", "table", "thead", "tbody", "tr", "th", "td", "span", "i", "button", "footer"].includes(t)), [...tags].join(", "));
  check("ATTACK: the same text in the property name is inert too", dom.app.find((n) => n.className === "eyebrow")[0].textContent.includes(evil));
  check("no attribute ever receives a URL or a handler", dom.created.every((n) => Object.keys(n.attributes).every((a) => ["title", "scope", "tabindex", "role", "aria-sort", "type"].includes(a))),
    [...new Set(dom.created.flatMap((n) => Object.keys(n.attributes)))].join(", "));

  toolResult(dom, { isError: true, content: [{ type: "text", text: evil }] });
  check("ATTACK: an error message that is HTML is inert", dom.app.textContent === evil && dom.app.find((n) => n.tagName === "img").length === 0);
  toolResult(dom, result("traffic_drops", [{ page: "javascript:alert(1)", currentClicks: 1, priorClicks: 2, clickChange: -1, positionChange: 0, diagnosis: evil }]));
  check("ATTACK: a javascript: URL in a page column is only ever text", cells(dom)[1][0] === "javascript:alert(1)" && dom.app.find((n) => n.tagName === "a").length === 0);
}

if (failures.length) {
  console.error(`\nMCP Apps tests: ${failures.length} failure(s).`);
  process.exit(1);
}
console.log("\nMCP Apps tests: all checks passed.");
