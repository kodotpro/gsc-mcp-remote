#!/usr/bin/env node
/**
 * The numbers. Every other suite checks that the server is safe to run; this
 * one checks that what it SAYS is right.
 *
 * A Search Console client is faked at the one seam every tool already goes
 * through (the per-request user context), fixtures are fed in, and each tool's
 * output is compared with values worked out by hand in the comments beside
 * them. No Google credentials, no network.
 *
 * Also here, because they need the same fake:
 *   - pagination and the row ceiling,
 *   - retrying a read after Google's transient failures (and not after others),
 *   - the plain-language messages for Google's failure classes,
 *   - the input bounds every tool's schema now declares,
 *   - the size of tools/list, which every client pays for in context.
 *
 * Run: node scripts/check-analytics.mjs
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

process.env.GSC_GOOGLE_RETRY_BASE_MS = "1"; // keep the retry tests fast

const { runWithUserContext } = await import("../dist/request-context.js");
const { fetchRows, getDateRange, getPriorDateRange } = await import("../dist/analytics.js");
const { quickWins } = await import("../dist/tools/quick-wins.js");
const { ctrOpportunities } = await import("../dist/tools/ctr-opportunities.js");
const { trafficDrops } = await import("../dist/tools/traffic-drops.js");
const { contentGaps } = await import("../dist/tools/content-gaps.js");
const { siteSnapshot } = await import("../dist/tools/site-snapshot.js");
const { cannibalizationCheck } = await import("../dist/tools/cannibalization-check.js");
const { contentDecay } = await import("../dist/tools/content-decay.js");
const { ctrVsBenchmark } = await import("../dist/tools/ctr-vs-benchmark.js");
const { checkAlerts } = await import("../dist/tools/check-alerts.js");
const { advancedSearchAnalytics } = await import("../dist/tools/advanced-search-analytics.js");
const { generateReport } = await import("../dist/tools/generate-report.js");
const { submitBatch } = await import("../dist/tools/submit-url.js");
const { explainGoogleError, isRetryableGoogleError, withGoogleRetry } = await import("../dist/google-errors.js");
const { setRemoteMode } = await import("../dist/runtime.js");
const { SERVER_VERSION } = await import("../dist/version.js");
const { outputShapeFor, TOOLS_WITH_OUTPUT_SCHEMA } = await import("../dist/output-schemas.js");
const { z } = await import("zod");
const { createServer } = await import("../dist/server-factory.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) console.log(`  ok    ${label}`);
  else { console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); failures.push(label); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (v) => JSON.stringify(v).slice(0, 400);

const SITE = "sc-domain:example.com";
const row = (keys, clicks, impressions, ctr, position) => ({ keys: [].concat(keys), clicks, impressions, ctr, position });

/** How many days before today a period starts; tells the periods of a comparison apart. */
const ageDays = (startDate) => Math.round((Date.now() - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);

/**
 * A user context whose Search Console client answers from `respond`.
 * `calls` records every request body, so a test can see what was asked.
 */
function fakeContext(respond) {
  const calls = [];
  const client = {
    searchanalytics: {
      query: async ({ siteUrl, requestBody }) => {
        calls.push({ siteUrl, ...requestBody });
        const rows = await respond(requestBody, calls.length);
        return { data: { rows } };
      },
    },
    sites: { list: async () => ({ data: { siteEntry: [{ siteUrl: SITE, permissionLevel: "siteOwner" }] } }) },
  };
  const ctx = {
    userId: "u1",
    email: "u1@example.com",
    getSearchConsole: async () => client,
    settings: { getDefaultProperty: () => SITE, setDefaultProperty: () => {} },
    account: { disconnect: () => ({ deleted: {} }), exportData: () => null },
  };
  return { ctx, calls };
}
const withRows = (respond, fn) => {
  const { ctx, calls } = fakeContext(respond);
  return runWithUserContext(ctx, async () => ({ out: await fn(), calls }));
};
/** Pages a row list the way Google does, so pagination is exercised for real. */
const paged = (all) => (body) => all.slice(body.startRow ?? 0, (body.startRow ?? 0) + body.rowLimit);

const googleError = (status, message, reason) =>
  Object.assign(new Error(message), { code: status, response: { status, headers: {} }, errors: reason ? [{ reason, message }] : [] });

// ---------------------------------------------------------------------------
console.log("Date ranges");
{
  const cur = getDateRange(28);
  const prior = getPriorDateRange(28);
  const span = (r) => (Date.parse(r.endDate) - Date.parse(r.startDate)) / 86_400_000 + 1;
  check("a 28-day range is 28 days long and ends yesterday", span(cur) === 28 && ageDays(cur.endDate) === 1, show(cur));
  check("the prior range is the same length", span(prior) === 28, show(prior));
  check("...and ends the day before the current one starts",
    (Date.parse(cur.startDate) - Date.parse(prior.endDate)) / 86_400_000 === 1, `${prior.endDate} / ${cur.startDate}`);
}

// ---------------------------------------------------------------------------
console.log("quick_wins");
{
  const rows = [
    row("a", 20, 1000, 0.02, 5.04),   // kept: 1000 * (0.110 - 0.02) = 90
    row("b", 50, 1000, 0.05, 3.9),    // above position 4: already winning
    row("c", 5, 1000, 0.005, 15.1),   // past max_position
    row("d", 1, 99, 0.01, 8),         // under min_impressions
    row("e", 1000, 5000, 0.2, 10),    // kept, CTR already above target: 0, never negative
    row("f", 100, 2000, 0.05, 4),     // kept: 2000 * (0.110 - 0.05) = 120
  ];
  const { out, calls } = await withRows(paged(rows), () => quickWins(28, 100, 15, SITE));
  check("keeps positions 4-15 with enough impressions, ordered by opportunity",
    same(out.map((w) => [w.query, w.opportunity]), [["f", 120], ["a", 90], ["e", 0]]), show(out));
  check("CTR is a percentage and position is rounded to one decimal", out[1].ctr === 2 && out[1].position === 5, show(out[1]));
  check("asks Google for the query dimension on the resolved property, final data included",
    calls[0].siteUrl === SITE && same(calls[0].dimensions, ["query"]) && calls[0].dataState === "all", show(calls[0]));
  check("asks for exactly the requested window", same([calls[0].startDate, calls[0].endDate], Object.values(getDateRange(28))));
}

// ---------------------------------------------------------------------------
console.log("ctr_opportunities");
{
  const rows = [
    row("/p1", 100, 1000, 0.10, 1.2),   // benchmark 28.5%: gap 18.5 points, 185 clicks
    row("/p2", 4, 400, 0.01, 1),        // under min_impressions
    row("/p3", 10, 1000, 0.01, 21),     // beyond position 20
    row("/p4", 105, 1000, 0.105, 3),    // gap 0.5 points: within tolerance
    row("/p5", 2, 2000, 0.001, 12),     // benchmark 2.1%: gap 2.0 points, 40 clicks
  ];
  const { out } = await withRows(paged(rows), () => ctrOpportunities(28, 500, SITE));
  check("flags pages more than one point under the benchmark for their position",
    same(out.map((o) => [o.page, o.potentialExtraClicks]), [["/p1", 185], ["/p5", 40]]), show(out));
  check("reports the benchmark and the gap in percentage points",
    out[0].expectedCtr === 28.5 && out[0].ctrGap === 18.5 && out[0].ctr === 10, show(out[0]));
}

// ---------------------------------------------------------------------------
console.log("traffic_drops");
{
  const current = [
    row("/a", 50, 1000, 0.05, 8),
    row("/b", 80, 4000, 0.02, 3),
    row("/c", 90, 1800, 0.05, 5),
    row("/d", 100, 2000, 0.05, 5),
  ];
  const prior = [
    row("/a", 100, 2000, 0.05, 4),      // -50, four positions worse: ranking loss
    row("/b", 100, 2500, 0.04, 3),      // -20, CTR halved at the same position
    row("/c", 100, 2000, 0.05, 5),      // -10, nothing else moved: demand
    row("/d", 50, 1000, 0.05, 5),       // went UP: not a drop
    row("/gone", 30, 600, 0.05, 6),     // absent now
    row("/gone-small", 5, 100, 0.05, 6),// absent now, but too small to report
  ];
  const { out } = await withRows((b) => (ageDays(b.startDate) <= 29 ? current : prior), () => trafficDrops(28, SITE));
  check("lists only pages that lost clicks, biggest loss first",
    same(out.map((d) => [d.page, d.clickChange]), [["/a", -50], ["/gone", -30], ["/b", -20], ["/c", -10]]), show(out));
  const by = Object.fromEntries(out.map((d) => [d.page, d.diagnosis]));
  check("diagnoses a ranking loss", by["/a"] === "Ranking loss", by["/a"]);
  check("diagnoses a CTR collapse at a stable position", /^CTR collapse/.test(by["/b"]), by["/b"]);
  check("diagnoses an impression decline when neither moved", /^Impression decline/.test(by["/c"]), by["/c"]);
  check("reports a page that vanished from the results", by["/gone"] === "Page disappeared from search results", by["/gone"]);
}
{
  // The disappeared-page check used to scan every current row for every prior
  // page. Two full 25,000-row periods made that 625 million comparisons.
  const n = 25_000;
  const cur = Array.from({ length: n }, (_, i) => row(`/c${i}`, 1, 10, 0.1, 5));
  const pri = Array.from({ length: n }, (_, i) => row(`/p${i}`, 10, 100, 0.1, 5));
  const started = Date.now();
  const { out } = await withRows((b) => paged(ageDays(b.startDate) <= 29 ? cur : pri)(b), () => trafficDrops(28, SITE));
  const ms = Date.now() - started;
  console.log(`        (${ms} ms)`);
  check("two full 25,000-row periods are compared in well under a second (was quadratic)", ms < 700 && out.length === 50, `${ms} ms`);
}

// ---------------------------------------------------------------------------
console.log("content_gaps");
{
  const rows = [
    row("far", 0, 500, 0, 35.44),
    row("edge", 1, 50, 0.02, 20),       // exactly on both thresholds: kept
    row("near", 9, 900, 0.01, 19.9),    // ranks better than min_position
    row("quiet", 0, 49, 0, 60),         // under min_impressions
  ];
  const { out } = await withRows(paged(rows), () => contentGaps(90, 50, 20, SITE));
  check("keeps queries at or beyond the position threshold, by impressions",
    same(out, [{ query: "far", impressions: 500, clicks: 0, position: 35.4 }, { query: "edge", impressions: 50, clicks: 1, position: 20 }]), show(out));
}

// ---------------------------------------------------------------------------
console.log("site_snapshot");
{
  const current = [row("2026-01-02", 10, 100, 0.1, 2), row("2026-01-03", 30, 300, 0.1, 6)];
  const prior = [row("2025-12-05", 20, 400, 0.05, 4)];
  const { out } = await withRows((b) => (ageDays(b.startDate) <= 29 ? current : prior), () => siteSnapshot(28, SITE));
  // position is weighted by impressions: (2*100 + 6*300) / 400 = 5, not the plain mean 4.
  check("totals clicks and impressions and weights position by impressions",
    same(out.current, { clicks: 40, impressions: 400, ctr: 10, position: 5 }), show(out.current));
  check("computes the change against the prior period",
    same(out.change, { clicks: 20, clicksPercent: 100, impressions: 0, impressionsPercent: 0, ctr: 5, position: 1 }), show(out.change));
}
{
  const { out } = await withRows(() => [], () => siteSnapshot(28, SITE));
  check("an empty property gives zeros, not NaN or a division by zero",
    same(out.current, { clicks: 0, impressions: 0, ctr: 0, position: 0 }) && out.change.clicksPercent === 0, show(out));
}

// ---------------------------------------------------------------------------
console.log("cannibalization_check");
{
  const rows = [
    row(["q1", "/x"], 3, 60, 0.05, 7.26),
    row(["q1", "/y"], 9, 40, 0.2, 3.11),
    row(["q2", "/only"], 50, 900, 0.05, 2),   // one page: no competition
    row(["q3", "/m"], 1, 20, 0.05, 5),
    row(["q3", "/n"], 1, 20, 0.05, 6),        // two pages, but 40 impressions in total
  ];
  const { out, calls } = await withRows(paged(rows), () => cannibalizationCheck(28, 50, SITE));
  check("reports only queries with two or more pages and enough combined impressions",
    out.length === 1 && out[0].query === "q1" && out[0].totalImpressions === 100, show(out));
  check("lists the better-ranking page first",
    same(out[0].pages.map((p) => [p.page, p.position]), [["/y", 3.1], ["/x", 7.3]]), show(out[0]?.pages));
  check("groups by query and page", same(calls[0].dimensions, ["query", "page"]));
}

// ---------------------------------------------------------------------------
console.log("content_decay");
{
  const periods = {
    p1: [row("/dec", 30, 900, 0.03, 9), row("/flat", 50, 900, 0.05, 5), row("/small", 2, 90, 0.02, 5), row("/stable", 30, 600, 0.05, 5), row("/rebound", 80, 900, 0.08, 5)],
    p2: [row("/rebound", 60, 900, 0.06, 5), row("/dec", 60, 900, 0.06, 6), row("/flat", 100, 900, 0.1, 5), row("/small", 5, 90, 0.05, 5), row("/stable", 40, 600, 0.06, 5), row("/missing", 80, 900, 0.08, 5)],
    // /rebound fell and then recovered: one bad month is noise, not decay.
    p3: [row("/rebound", 100, 900, 0.1, 5), row("/dec", 100, 900, 0.1, 5), row("/flat", 100, 900, 0.1, 5), row("/small", 9, 90, 0.1, 5), row("/stable", 50, 600, 0.08, 5), row("/missing", 90, 900, 0.1, 5)],
  };
  const starts = new Set();
  const { out } = await withRows((b) => {
    starts.add(b.startDate);
    const age = ageDays(b.startDate);
    return age <= 45 ? periods.p1 : age <= 75 ? periods.p2 : periods.p3;
  }, () => contentDecay(SITE));
  check("compares three separate 30-day windows", starts.size === 3, [...starts].join(", "));
  check("flags only pages that fell in BOTH steps and had real traffic to lose",
    same(out.map((d) => [d.page, d.totalClickLoss]), [["/dec", 70], ["/stable", 20]]), show(out));
  check("says whether rankings fell with the clicks",
    out[0].positionTrend === "Rankings declining" && /^Rankings stable/.test(out[1].positionTrend), show(out.map((d) => d.positionTrend)));
}

// ---------------------------------------------------------------------------
console.log("ctr_vs_benchmark");
{
  const rows = [
    row("/a", 310, 1000, 0.31, 1),      // +2.5 points
    row("/b", 157, 1000, 0.157, 2),     // on the benchmark
    row("/c", 70, 1000, 0.07, 3),       // -4 points
    row("/d", 100, 1000, 0.1, 1),       // -18.5 points
    row("/e", 1, 100, 0.01, 1),         // under min_impressions
  ];
  const { out } = await withRows(paged(rows), () => ctrVsBenchmark(28, 200, SITE));
  check("orders pages from furthest below the benchmark to furthest above",
    same(out.map((r) => [r.page, r.gap]), [["/d", -18.5], ["/c", -4], ["/b", 0], ["/a", 2.5]]), show(out));
  check("grades each gap",
    /^Significantly below/.test(out[0].verdict) && /^Below benchmark/.test(out[1].verdict) &&
    out[2].verdict === "At benchmark" && out[3].verdict === "Above benchmark", show(out.map((r) => r.verdict)));
}

// ---------------------------------------------------------------------------
console.log("check_alerts");
{
  const P = "/p";
  const current = [
    row(["k1", P], 2, 5, 0.4, 50),      // 45 positions worse (> 2 x 20): critical
    row(["k2", P], 0, 20, 0, 30),       // 25 positions worse: warning
    row(["k3", P], 8, 200, 0.04, 3),    // CTR 10% -> 4%, a 60% fall: warning; clicks -20%: under the threshold
    row(["k4", P], 3, 33, 0.09, 3),     // clicks 10 -> 3, a 70% fall (> 2 x 30): critical
  ];
  const prior = [
    row(["k1", P], 2, 5, 0.4, 5),
    row(["k2", P], 0, 20, 0, 5),
    row(["k3", P], 10, 100, 0.1, 3),
    row(["k4", P], 10, 100, 0.1, 3),
    row(["k5", P], 25, 300, 0.08, 4),   // gone, had 25 clicks: critical
    row(["k6", P], 4, 100, 0.04, 4),    // gone, but under 5 clicks: not reported
    row(["k7", P], 5, 100, 0.05, 4),    // gone, 5 clicks: warning
  ];
  const { out } = await withRows((b) => (ageDays(b.startDate) <= 8 ? current : prior), () => checkAlerts(7, 20, 50, 30, SITE));
  check("counts alerts by severity", same(out.summary, { critical: 3, warning: 3, info: 0, total: 6 }), show(out.summary));
  check("orders critical first, then by size of change",
    same(out.alerts.map((a) => [a.entity.split(" ")[0], a.type, a.change]),
      [["k4", "click_drop", -70], ["k1", "position_drop", 45], ["k5", "disappeared", -25],
       ["k3", "ctr_drop", -60], ["k2", "position_drop", 25], ["k7", "disappeared", -5]]), show(out.alerts.map((a) => [a.entity, a.type, a.change])));
}

// ---------------------------------------------------------------------------
console.log("advanced_search_analytics");
{
  const rows = [row(["a", "usa"], 5, 100, 0.05, 3.04), row(["b", "gbr"], 50, 100, 0.5, 1), row(["c", "usa"], 20, 100, 0.2, 2)];
  const filters = [{ dimension: "country", operator: "equals", expression: "usa" }];
  const { out, calls } = await withRows(paged(rows), () =>
    advancedSearchAnalytics(28, ["query", "country"], filters, 2, "clicks", "descending", SITE, "image"));
  check("sorts by the chosen metric and returns at most row_limit rows",
    same(out.rows.map((r) => r.keys[0]), ["b", "c"]) && out.totalRows === 3, show(out.rows));
  check("passes the filters and the search type through to Google",
    same(calls[0].dimensionFilterGroups, [{ filters }]) && calls[0].type === "image", show(calls[0]));
  const asc = await withRows(paged(rows), () => advancedSearchAnalytics(28, ["query", "country"], [], 500, "position", "ascending", SITE));
  check("ascending order works, and CTR/position are rounded for reading",
    same(asc.out.rows.map((r) => [r.keys[0], r.ctr, r.position]), [["b", 50, 1], ["c", 20, 2], ["a", 5, 3]]), show(asc.out.rows));
}

// ---------------------------------------------------------------------------
console.log("Pagination and the row ceiling");
{
  const all = Array.from({ length: 5 }, (_, i) => row(`q${i}`, i, 10, 0.1, 1));
  const base = { startDate: "2026-01-01", endDate: "2026-01-28", dimensions: ["query"] };
  const a = await withRows(paged(all), () => fetchRows({ ...base, rowLimit: 2 }, SITE));
  check("follows pages until a short one", a.out.rows.length === 5 && a.calls.length === 3 && !a.out.truncated,
    `${a.out.rows.length} rows in ${a.calls.length} calls`);
  check("advances startRow by the page size", same(a.calls.map((c) => c.startRow), [0, 2, 4]));
  const b = await withRows(paged(all), () => fetchRows({ ...base, rowLimit: 2, maxTotalRows: 4 }, SITE));
  check("stops at the row ceiling and says the result was cut", b.out.rows.length === 4 && b.out.truncated === true && b.calls.length === 2,
    `${b.out.rows.length} rows, truncated=${b.out.truncated}`);
  const c = await withRows(() => undefined, () => fetchRows(base, SITE));
  check("a response with no rows field is an empty result, not a crash", same(c.out.rows, []));
}

// ---------------------------------------------------------------------------
console.log("Retrying Google's transient failures");
{
  const rows = [row("a", 1, 10, 0.1, 5)];
  const base = { startDate: "2026-01-01", endDate: "2026-01-28", dimensions: ["query"] };
  const flaky = (failuresBefore, error) => (_b, n) => { if (n <= failuresBefore) throw error; return rows; };

  const once = await withRows(flaky(1, googleError(503, "Service Unavailable")), () => fetchRows(base, SITE).catch(() => ({ rows: [] })));
  check("a 503 is retried and the call then succeeds", once.out.rows.length === 1 && once.calls.length === 2, `${once.calls.length} calls`);
  const limited = await withRows(flaky(2, googleError(429, "Too Many Requests")), () => fetchRows(base, SITE).catch(() => ({ rows: [] })));
  check("a 429 is retried twice before giving up on retries", limited.out.rows.length === 1 && limited.calls.length === 3, `${limited.calls.length} calls`);

  let calls = 0;
  const stillDown = await withRows(() => { calls++; throw googleError(500, "Backend Error"); }, () => fetchRows(base, SITE).catch((e) => e));
  check("a failure that persists is reported after three attempts, not retried forever", stillDown.out instanceof Error && calls === 3, `${calls} calls`);

  for (const [status, why] of [[403, "a permission error"], [400, "a bad request"], [404, "an unknown property"]]) {
    let n = 0;
    await withRows(() => { n++; throw googleError(status, "nope"); }, () => fetchRows(base, SITE).catch(() => null));
    check(`${why} (${status}) is NOT retried: repeating it cannot help`, n === 1, `${n} calls`);
  }
  check("a timeout is not retried (the call already waited the full deadline)",
    isRetryableGoogleError(Object.assign(new Error("timeout of 60000ms exceeded"), { code: "ETIMEDOUT" })) === false);
  check("a dropped connection is", isRetryableGoogleError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })) === true);

  // Only reads are wrapped. A write that failed on the way back may have
  // succeeded on the way in, so the helper must never be reached for one.
  const src = fs.readFileSync(new URL("../src/tools/submit-sitemap.ts", import.meta.url), "utf8") +
              fs.readFileSync(new URL("../src/tools/submit-url.ts", import.meta.url), "utf8");
  check("the write tools do not use the retry helper", !/withGoogleRetry/.test(src));

  let waited = 0;
  const t0 = Date.now();
  await withGoogleRetry(async () => { if (waited++ === 0) throw Object.assign(googleError(429, "slow down"), { response: { status: 429, headers: { "retry-after": "3600" } } }); return 1; });
  check("a Retry-After of an hour is capped, so one call cannot be parked that long", Date.now() - t0 < 6500, `${Date.now() - t0} ms`);
}

// ---------------------------------------------------------------------------
console.log("Google failures in plain language");
{
  const perm = explainGoogleError(googleError(403, "User does not have sufficient permission for site 'sc-domain:nope.com'.", "forbidden"), "sc-domain:nope.com");
  check("a permission error names the property and points at list_properties",
    /does not have access/.test(perm) && perm.includes('"sc-domain:nope.com"') && /list_properties/.test(perm), perm);
  const quota = explainGoogleError(googleError(403, "Quota exceeded for quota metric 'Queries'", "quotaExceeded"));
  check("a quota error on a 403 is recognised as quota, not as a permission problem", /quota was reached/.test(quota) && !/does not have access/.test(quota), quota);
  check("a 429 is a quota message too", /quota was reached/.test(explainGoogleError(googleError(429, "Too Many Requests"))));
  check("a revoked sign-in tells the person to reconnect", /reconnect/.test(explainGoogleError(new Error("invalid_grant"))));
  check("a Google outage is described as Google's, and as brief", /own side/.test(explainGoogleError(googleError(503, "Service Unavailable"))));
  check("an error that did not come from Google is left alone", explainGoogleError(new Error("No property selected")) === null);
  check("...even when its text happens to mention a timeout",
    explainGoogleError(new Error("Page not analysed: fetch timeout after 10s")) === null);
  check("a real Google timeout is explained", /did not answer within the time limit/.test(
    explainGoogleError(Object.assign(new Error("timeout of 60000ms exceeded"), { code: "ETIMEDOUT" })) ?? ""));
  const hostile = explainGoogleError(googleError(400, "bad\u0000\n‮ value " + "x".repeat(5000)));
  check("Google's own text is bounded and stripped of control characters before it reaches the model",
    hostile.length < 600 && !/[\u0000\n‮]/.test(hostile), `${hostile.length} chars`);
}

// ---------------------------------------------------------------------------
console.log("Over MCP: schemas, messages and the cost of tools/list");
{
  const connect = async (respond, fn) => {
    const { ctx, calls } = fakeContext(respond);
    const server = createServer();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "check-analytics", version: "1" });
    await client.connect(clientSide);
    try {
      return await runWithUserContext(ctx, () => fn(client, calls));
    } finally {
      await client.close();
      await server.close();
    }
  };
  const call = async (client, name, args) => {
    try {
      const r = await client.callTool({ name, arguments: args });
      return { isError: r.isError === true, text: r.content?.[0]?.text ?? "" };
    } catch (e) {
      return { isError: true, text: String(e?.message ?? e) };
    }
  };

  await connect(paged([row("f", 100, 2000, 0.05, 4)]), async (client, calls) => {
    const ok = await call(client, "quick_wins", { site_url: SITE });
    const parsed = JSON.parse(ok.text);
    check("a valid call returns the fixture's numbers through the whole MCP path",
      !ok.isError && parsed.data[0].opportunity === 120 && parsed._meta.tool === "quick_wins", ok.text.slice(0, 200));
    check("results are compact JSON: no indentation paid for in tokens", !ok.text.includes("\n"));
    check("every result still carries the accuracy note and the untrusted-text notice",
      /exact values/.test(parsed._meta.note) && /third-party text/.test(parsed._meta.untrusted_text));

    const before = calls.length;
    const bad = [
      ["quick_wins", { days: -5 }, "a negative day count"],
      ["quick_wins", { days: 1e9 }, "a day count far beyond what Google keeps"],
      ["quick_wins", { days: 28.5 }, "a fractional day count"],
      ["quick_wins", { days: 0 }, "zero days"],
      ["quick_wins", { max_position: 0 }, "position 0"],
      ["quick_wins", { min_impressions: -1 }, "negative impressions"],
      ["advanced_search_analytics", { row_limit: 501 }, "more than 500 rows"],
      ["advanced_search_analytics", { dimensions: ["bogus"] }, "an unknown dimension"],
      ["advanced_search_analytics", { dimensions: [] }, "no dimensions"],
      ["advanced_search_analytics", { order_by: "revenue" }, "an unknown sort field"],
      ["advanced_search_analytics", { order_direction: "sideways" }, "an unknown sort direction"],
      ["advanced_search_analytics", { filters: [{ dimension: "query", operator: "like", expression: "x" }] }, "an unknown filter operator"],
      ["generate_report", { include_sections: ["everything"] }, "an unknown report section"],
      ["check_alerts", { ctr_drop_threshold: 250 }, "a percentage over 100"],
      ["content_recommendations", { max_recommendations: 10_000 }, "ten thousand recommendations"],
      ["submit_url", { urls: [] }, "an empty URL list"],
      ["submit_url", { urls: Array.from({ length: 201 }, (_, i) => `https://example.com/${i}`) }, "more than the daily quota of 200 URLs"],
      ["inspect_url", { url: "x".repeat(3000) }, "a 3,000-character URL"],
    ];
    for (const [name, args, why] of bad) {
      const r = await call(client, name, { site_url: SITE, ...args });
      check(`${name} refuses ${why}`, r.isError && /invalid|too (big|small)|expected|option/i.test(r.text), r.text.slice(0, 160));
    }
    check("...and none of those reached Google", calls.length === before, `${calls.length - before} calls`);
  });

  await connect(() => { throw googleError(403, "User does not have sufficient permission for site 'sc-domain:example.com'.", "forbidden"); }, async (client) => {
    const r = await call(client, "site_snapshot", { site_url: SITE });
    check("a Google permission failure comes back as an error a person can act on",
      r.isError && /does not have access/.test(r.text) && /list_properties/.test(r.text), r.text.slice(0, 200));
  });
  await connect(() => { throw googleError(429, "Quota exceeded"); }, async (client, calls) => {
    const r = await call(client, "content_gaps", { site_url: SITE });
    check("a quota failure says it is a quota, after the retries are spent", r.isError && /quota was reached/.test(r.text) && calls.length === 3,
      `${calls.length} calls: ${r.text.slice(0, 120)}`);
  });

  await connect(() => [], async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    check("submit_batch is gone and submit_url takes a list", !names.includes("submit_batch") &&
      tools.find((t) => t.name === "submit_url")?.inputSchema?.properties?.urls?.type === "array");
    const bytes = JSON.stringify(tools).length;
    // It was 59,592 bytes (about 15,000 tokens) with the shared guidance pasted
    // onto every description. This ceiling keeps it from creeping back.
    // 31 KB of names, descriptions and input schemas; about 1 KB naming the MCP
    // Apps view on ten tools; about 9.5 KB for those ten tools' output schemas.
    check("tools/list stays under 42.5 KB", bytes < 42_500, `${bytes} bytes`);
    const longest = tools.map((t) => [t.description.length, t.name]).sort((a, b) => b[0] - a[0])[0];
    check("no tool description runs past 600 characters", longest[0] <= 600, `${longest[1]}: ${longest[0]}`);
    check("the shared guidance is no longer repeated in any description",
      tools.every((t) => !/IMPORTANT: Base your analysis|PRESENTATION:|POSITION: position is/.test(t.description)));
    const instructions = client.getInstructions() ?? "";
    check("...because the server sends it once, as instructions",
      /ACCURACY/.test(instructions) && /POSITION/.test(instructions) && /UNTRUSTED TEXT/.test(instructions) && /list_properties/.test(instructions));
    const loose = [];
    for (const t of tools) {
      for (const [param, schema] of Object.entries(t.inputSchema?.properties ?? {})) {
        if ((schema.type === "number" || schema.type === "integer") && (schema.minimum === undefined || schema.maximum === undefined)) loose.push(`${t.name}.${param}`);
        if (schema.type === "string" && !schema.enum && schema.maxLength === undefined) loose.push(`${t.name}.${param}`);
        if (schema.type === "array" && schema.maxItems === undefined) loose.push(`${t.name}.${param}`);
      }
    }
    check("every numeric, string and array input declares its limits", loose.length === 0, loose.join(", "));
  });
}

// ---------------------------------------------------------------------------
console.log("Structured output");
{
  // One responder that gives every tool something to report: rows shaped by the
  // dimensions asked for, with fewer clicks the more recent the period.
  const respond = (b) => {
    const age = ageDays(b.startDate);
    const clicks = age <= 45 ? 30 : age <= 75 ? 60 : 100;
    const dims = JSON.stringify(b.dimensions);
    if (dims === '["date"]') return [row("2026-01-02", clicks, 4000, clicks / 4000, 6)];
    if (dims === '["query"]') return [row("a query", clicks, 4000, 0.01, 6), row("a far query", 1, 900, 0.001, 40)];
    if (dims === '["page"]') return [row("https://example.com/a/", clicks, 4000, 0.01, 6)];
    if (dims === '["query","page"]') return [row(["q", "https://example.com/a/"], clicks, 4000, 0.01, 6), row(["q", "https://example.com/b/"], 2, 500, 0.004, 9)];
    return [];
  };
  const ARGS = {
    multi_site_dashboard: { site_urls: [SITE] },
    check_alerts: { site_url: SITE, days: 28, click_drop_threshold: 10 },
  };
  const { ctx } = fakeContext(respond);
  const server = createServer();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "check-analytics", version: "1" });
  await client.connect(clientSide);
  try {
    await runWithUserContext(ctx, async () => {
      const { tools } = await client.listTools();
      const declared = tools.filter((t) => t.outputSchema).map((t) => t.name).sort();
      check("ten tools declare an output schema", same(declared, [...TOOLS_WITH_OUTPUT_SCHEMA].sort()) && declared.length === 10, declared.join(", "));
      for (const name of TOOLS_WITH_OUTPUT_SCHEMA) {
        let r, threw = null;
        // The server validates the result against the declared schema, and so
        // does this client: a schema that did not match what the tool really
        // returns would surface here as an error, twice over.
        try { r = await client.callTool({ name, arguments: ARGS[name] ?? { site_url: SITE } }); } catch (e) { threw = e; }
        const text = r?.content?.[0]?.text ?? "";
        const data = r?.structuredContent?.data;
        const rows = Array.isArray(data) ? data.length : (data?.alerts?.length ?? data?.sites?.length ?? (data?.current ? 1 : 0));
        check(`${name}: a real result satisfies its declared schema`, !threw && r?.isError !== true && rows > 0, String(threw?.message ?? text).slice(0, 200));
        check(`${name}: the structured result is exactly the text result`, !threw && same(r.structuredContent, JSON.parse(text)));
      }
      const plain = await client.callTool({ name: "list_properties", arguments: {} });
      check("a tool without a declared schema still returns its result as an object too",
        plain.structuredContent?._meta?.tool === "list_properties" && same(plain.structuredContent, JSON.parse(plain.content[0].text)));
    });
    const failing = fakeContext(() => { throw googleError(403, "User does not have sufficient permission for site", "forbidden"); });
    await runWithUserContext(failing.ctx, async () => {
      const r = await client.callTool({ name: "quick_wins", arguments: { site_url: SITE } });
      check("an error from a tool with a schema is still the readable error, not a schema complaint",
        r.isError === true && /does not have access/.test(r.content[0].text) && !/Output validation/.test(r.content[0].text), r.content?.[0]?.text?.slice(0, 160));
    });
  } finally {
    await client.close();
    await server.close();
  }

  const schema = z.object(outputShapeFor("quick_wins"));
  const good = { query: "q", clicks: 1, impressions: 2, ctr: 3, position: 4, opportunity: 5 };
  check("a number that JSON turned into null (NaN upstream) does not fail the whole result",
    schema.safeParse({ _meta: {}, data: [{ ...good, position: null }] }).success);
  check("a field the schema does not know is allowed", schema.safeParse({ _meta: {}, data: [{ ...good, extra: true }] }).success);
  check("...but a wrong type is refused", !schema.safeParse({ _meta: {}, data: [{ ...good, clicks: "many" }] }).success);
  check("...and so is a missing field", !schema.safeParse({ _meta: {}, data: [{ query: "q" }] }).success);
  check("a tool named like an inherited property has no schema", outputShapeFor("constructor") === undefined && outputShapeFor("__proto__") === undefined);
}

// ---------------------------------------------------------------------------
console.log("generate_report: one behaviour in every mode");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-report-"));
  const savedDir = process.env.GSC_REPORT_DIR;
  process.env.GSC_REPORT_DIR = dir;
  const respond = (b) => (same(b.dimensions, ["date"]) ? [row("2026-01-02", 40, 400, 0.1, 5)] : []);
  try {
    setRemoteMode(false);
    const local = await withRows(respond, () => generateReport(undefined, 28, undefined, SITE));
    check("a local install returns the report itself, not just a path",
      typeof local.out.markdown === "string" && local.out.markdown.includes("# GSC Performance Report") && local.out.markdown.includes("| Clicks | 40 |"),
      show(local.out).slice(0, 200));
    check("...and writes NO file unless asked to", local.out.filePath === null && fs.readdirSync(dir).length === 0, fs.readdirSync(dir).join(", "));
    check("the report is stamped with the real version", local.out.markdown.includes(`v${SERVER_VERSION}`) && !local.out.markdown.includes("v2.0.0"));

    const saved = await withRows(respond, () => generateReport("weekly.md", 28, ["snapshot"], SITE));
    const file = path.join(dir, "weekly.md");
    check("with output_path the same report is also saved, inside the report directory",
      saved.out.filePath === fs.realpathSync(dir) + path.sep + "weekly.md" || saved.out.filePath === file, String(saved.out.filePath));
    check("the saved file is the returned markdown", fs.existsSync(file) && fs.readFileSync(file, "utf8") === saved.out.markdown);
    check("only the requested section is built", same(saved.out.sectionsIncluded, ["snapshot"]) && !saved.out.markdown.includes("## Quick Wins"));
    fs.rmSync(file, { force: true });

    setRemoteMode(true);
    const remote = await withRows(respond, () => generateReport("weekly.md", 28, ["snapshot"], SITE));
    check("the hosted server returns the same report and writes nothing, even when given a path",
      remote.out.markdown === saved.out.markdown && remote.out.filePath === null && fs.readdirSync(dir).length === 0);
    check("...and says the path was ignored instead of dropping it silently", /output_path was ignored/.test(remote.out.summary), remote.out.summary);
  } finally {
    setRemoteMode(false);
    if (savedDir === undefined) delete process.env.GSC_REPORT_DIR; else process.env.GSC_REPORT_DIR = savedDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
console.log("submit_url: one tool for one URL or many");
{
  const empty = await submitBatch([]).catch((e) => e);
  check("an empty list is refused with a reason", empty instanceof Error && /at least one URL/.test(empty.message));
  const many = await submitBatch(Array.from({ length: 201 }, (_, i) => `https://example.com/${i}`)).catch((e) => e);
  check("more than the daily quota is refused before anything is sent", many instanceof Error && /200/.test(many.message));
}

if (failures.length) {
  console.error(`\nAnalytics tests: ${failures.length} failure(s).`);
  process.exit(1);
}
console.log("\nAnalytics tests: all checks passed.");
