/**
 * Everything the public pages say, kept apart from how they are rendered.
 *
 * Two rules apply to every string here, the same ones web-pages.ts states for
 * the landing page: a claim about the software must be true of the code (tool
 * names, parameters and defaults are copied from the registrations in
 * server-factory.ts, and scripts/check-http.mjs fails if a page names a tool
 * the server does not register), and a claim about the world must carry its
 * source and the date it was checked.
 *
 * The example outputs are real responses from the hosted instance, run against
 * the author's own property (sc-domain:k-o.pro) on the date in `captured`.
 * They are trimmed, never edited: rows are dropped from the end of an array and
 * the caption says so, but no value is changed. Replace them rather than
 * touching them when they go stale.
 *
 * HTML is allowed only in fields whose name ends in `Html`; every other string
 * is escaped where it is rendered.
 */

import { SERVER_VERSION } from "./version.js";

export { SERVER_VERSION };

/** The product's name, used as-is in the title, h1, schema and README. */
export const PRODUCT_NAME = "Google Search Console MCP Server - by k-o.pro (remote)";

/** Bump when page content changes. Feeds dateModified and the sitemap's lastmod. */
export const SITE_UPDATED = "2026-10-13";

/** "13 October 2026", for prose. */
export function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}

export const AUTHOR = {
  name: "Oleksii Khoroshun",
  url: "https://k-o.pro/about",
  sameAs: [
    "https://k-o.pro/",
    "https://github.com/kodotpro",
    "https://www.linkedin.com/in/kodotpro/",
    "https://x.com/kodotpro",
  ],
};

/** This is a fork; the analysis logic is upstream's. See NOTICE. */
export const UPSTREAM = {
  author: "Suganthan Mohanadasan",
  authorUrl: "https://suganthan.com",
  name: "Suganthan's GSC MCP",
  repoUrl: "https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP",
};

export const README_URL = "https://github.com/kodotpro/gsc-mcp-remote#readme";
export const CHANGELOG_URL = "https://github.com/kodotpro/gsc-mcp-remote#changelog";
export const SELF_HOSTING_DOC_URL =
  "https://github.com/kodotpro/gsc-mcp-remote/blob/main/docs/self-hosting.md";

/** Versioned names: /img/ is served immutable, so a new image ships under a new name. */
export const ASSETS = {
  ogImage: "/img/og-card-v1.png",
  icon192: "/img/icon-192-v1.png",
  appleTouchIcon: "/img/apple-touch-icon-v1.png",
  faviconIco: "/img/favicon-v1.ico",
} as const;

// -- the guides ---------------------------------------------------------------

export interface GuideLink {
  path: string;
  /** Short label for footers, breadcrumbs and "related" lists. */
  label: string;
}

/** Every page besides / and /privacy, in the order the footer lists them. */
export const GUIDES: GuideLink[] = [
  { path: "/claude", label: "Connect to Claude" },
  { path: "/claude-code", label: "Use it in Claude Code" },
  { path: "/tools/opportunities", label: "Find opportunities" },
  { path: "/tools/diagnostics", label: "Diagnose drops" },
  { path: "/tools/lookups", label: "Look things up" },
  { path: "/tools/image-search", label: "Image search" },
  { path: "/ai-mode-queries", label: "AI Mode queries" },
  { path: "/self-host", label: "Self-host it" },
];

// -- tools --------------------------------------------------------------------

export interface ToolParam {
  name: string;
  /** The default as registered, or "required". */
  value: string;
  noteHtml?: string;
}

export interface ToolDoc {
  name: string;
  /** One line, for the landing page's tables. */
  what: string;
  /** A question someone would actually type. */
  ask: string;
  /** Longer explanation for the group page. */
  detailHtml: string;
  params: ToolParam[];
}

export interface ToolGroup {
  title: string;
  blurbHtml: string;
  /** The group's own page. */
  path: string;
  tools: ToolDoc[];
}

/** Every property-scoped tool also takes site_url; the pages say so once rather than per row. */
export const SITE_URL_NOTE =
  "Every tool that reads a property also takes <code>site_url</code>, so one connection " +
  "covers every property your Google account can see. Ask for " +
  "<span class=\"tool-name\">list_properties</span> to get the exact strings: " +
  "<code>sc-domain:example.com</code> and <code>https://example.com/</code> are different " +
  "properties with different data.";

export const TOOL_GROUPS: ToolGroup[] = [
  {
    title: "Find the opportunity",
    blurbHtml: "Where the traffic you do not have yet is hiding.",
    path: "/tools/opportunities",
    tools: [
      {
        name: "quick_wins",
        what: "Keywords at positions 4–15 worth pushing to page one",
        ask: "What am I almost ranking for on sc-domain:example.com?",
        detailHtml: "Returns queries at positions 4–15 with enough impressions to matter, " +
          "sorted by the clicks reaching position 3 would add. On a small site the " +
          "default threshold of 100 impressions can return nothing; ask for a lower one.",
        params: [
          { name: "days", value: "28" },
          { name: "min_impressions", value: "100" },
          { name: "max_position", value: "15" },
        ],
      },
      {
        name: "ctr_opportunities",
        what: "Pages with the impressions but a CTR far below par for their position",
        ask: "Which pages get seen but clicked far less than their position should earn?",
        detailHtml: "Pages with plenty of impressions and a click-through rate well under " +
          "what their average position usually earns. These are the title and meta description " +
          "rewrites worth doing first.",
        params: [
          { name: "days", value: "28" },
          { name: "min_impressions", value: "500" },
        ],
      },
      {
        name: "content_gaps",
        what: "Demand you already get impressions for but rank beyond 20",
        ask: "What do I get impressions for but rank beyond page two?",
        detailHtml: "Queries that already show your site but rank worse than position 20. " +
          "Google is matching you to the demand without a page that targets it.",
        params: [
          { name: "days", value: "90" },
          { name: "min_impressions", value: "50" },
          { name: "min_position", value: "20" },
        ],
      },
      {
        name: "content_recommendations",
        what: "Quick wins, gaps and cannibalisation cross-referenced into actions",
        ask: "Give me the ten content changes worth making first.",
        detailHtml: "Runs quick wins, content gaps and the cannibalisation check together and " +
          "returns a prioritised list: pages to update, content to create, pages to consolidate.",
        params: [
          { name: "days", value: "28" },
          { name: "max_recommendations", value: "10" },
        ],
      },
      {
        name: "topic_cluster_performance",
        what: "How a group of pages performs as one thing",
        ask: "How is everything under /blog/seo/ doing as a group?",
        detailHtml: "Adds up clicks, impressions, CTR and position for every page whose URL " +
          "matches a path pattern, and lists the cluster's top five pages and queries.",
        params: [
          { name: "path_pattern", value: "required", noteHtml: "e.g. <code>/blog/seo</code>" },
          { name: "days", value: "28" },
        ],
      },
    ],
  },
  {
    title: "Diagnose the problem",
    blurbHtml: "What changed, and whether it was ranking, CTR or demand.",
    path: "/tools/diagnostics",
    tools: [
      {
        name: "traffic_drops",
        what: "The biggest losses, each with a diagnosed cause",
        ask: "Which pages lost the most traffic in the last 28 days, and why?",
        detailHtml: "Compares the current period with the one before it and labels each loss " +
          "as a ranking loss, a CTR collapse or a demand decline, so you know whether to fix " +
          "the page, the snippet, or nothing.",
        params: [{ name: "days", value: "28", noteHtml: "length of each period" }],
      },
      {
        name: "content_decay",
        what: "Pages declining across three consecutive 30-day periods",
        ask: "Which pages have lost clicks three months in a row?",
        detailHtml: "One bad month is noise. This flags pages whose clicks fell in each of " +
          "three consecutive 30-day periods.",
        params: [],
      },
      {
        name: "cannibalization_check",
        what: "Queries where your own pages compete with each other",
        ask: "Am I cannibalising myself anywhere?",
        detailHtml: "Queries where more than one of your URLs collects impressions, with each " +
          "URL's position and its share of the impressions. Two pages sharing a query is only a " +
          "problem when they serve the same intent; the output shows you where to look.",
        params: [
          { name: "days", value: "28" },
          { name: "min_impressions", value: "50", noteHtml: "combined across the URLs" },
        ],
      },
      {
        name: "check_alerts",
        what: "Position drops, CTR collapses, and pages gone from results",
        ask: "Is there anything I should look at this week?",
        detailHtml: "Severity-rated alerts for position drops, CTR collapses, click losses and " +
          "pages that disappeared from results, comparing the last week with the one before.",
        params: [
          { name: "days", value: "7" },
          { name: "position_drop_threshold", value: "20", noteHtml: "positions" },
          { name: "ctr_drop_threshold", value: "50", noteHtml: "percent" },
          { name: "click_drop_threshold", value: "30", noteHtml: "percent" },
        ],
      },
      {
        name: "ctr_vs_benchmark",
        what: "Your CTR per page against the benchmark for that position",
        ask: "Which pages underperform the usual CTR for where they rank?",
        detailHtml: "Compares each page's CTR with a benchmark for its position and flags the " +
          "ones well below it.",
        params: [
          { name: "days", value: "28" },
          { name: "min_impressions", value: "200" },
        ],
      },
    ],
  },
  {
    title: "Look it up",
    blurbHtml: "The direct questions, answered against live data.",
    path: "/tools/lookups",
    tools: [
      {
        name: "site_snapshot",
        what: "Clicks, impressions, CTR and position against the prior period",
        ask: "How did the last 28 days compare with the 28 before?",
        detailHtml: "Totals for the period and the one before it, with the change in each.",
        params: [{ name: "days", value: "28", noteHtml: "length of each period" }],
      },
      {
        name: "advanced_search_analytics",
        what: "A custom query with your own dimensions and filters",
        ask: "Clicks by country for pages containing /pricing, mobile only, last 90 days.",
        detailHtml: "The raw Search Analytics query, for anything the other tools do not cover: " +
          "any mix of <code>query</code>, <code>page</code>, <code>country</code>, " +
          "<code>device</code> and <code>date</code>, filters with regex, and every search type " +
          "Google exposes.",
        params: [
          { name: "days", value: "28" },
          { name: "dimensions", value: "[\"query\"]" },
          { name: "filters", value: "none", noteHtml: "<code>contains</code>, <code>equals</code>, <code>includingRegex</code> and their negations" },
          { name: "row_limit", value: "100", noteHtml: "maximum 500" },
          { name: "order_by", value: "clicks" },
          { name: "order_direction", value: "descending" },
          { name: "search_type", value: "web", noteHtml: "or <code>image</code>, <code>video</code>, <code>news</code>, <code>discover</code>, <code>googleNews</code>" },
        ],
      },
      {
        name: "inspect_url",
        what: "Whether a URL is indexed, and why it is not",
        ask: "Is https://example.com/page indexed? If not, why not?",
        detailHtml: "Google's URL Inspection result in one answer: indexing state, last crawl, " +
          "the canonical you declared against the one Google chose, robots and noindex, and " +
          "whether the fetch succeeded.",
        params: [{ name: "url", value: "required" }],
      },
      {
        name: "verify_claim",
        what: "Check a number against live data before it goes in the deck",
        ask: "Check that the homepage got 500 clicks last month before I quote it.",
        detailHtml: "Takes a claim, the metric and the value you expect, and checks it against " +
          "live data. It exists so Claude can check its own numbers before presenting them.",
        params: [
          { name: "claim", value: "required" },
          { name: "metric", value: "required", noteHtml: "<code>clicks</code>, <code>impressions</code>, <code>ctr</code> or <code>position</code>" },
          { name: "expected_value", value: "required" },
          { name: "url", value: "optional" },
          { name: "query", value: "optional" },
          { name: "days", value: "28" },
        ],
      },
      {
        name: "generate_report",
        what: "A full markdown performance report",
        ask: "Write me a performance report for the last 28 days.",
        detailHtml: "Snapshot, alerts, quick wins, traffic drops, content decay and " +
          "recommendations in one markdown report. On this hosted instance the report comes " +
          "back in the conversation rather than being written to the server's disk.",
        params: [
          { name: "days", value: "28" },
          { name: "include_sections", value: "all", noteHtml: "any of <code>snapshot</code>, <code>alerts</code>, <code>quick_wins</code>, <code>traffic_drops</code>, <code>content_decay</code>, <code>recommendations</code>" },
        ],
      },
      {
        name: "multi_site_dashboard",
        what: "One health check across many properties at once",
        ask: "Give me a health check across all my properties.",
        detailHtml: "Clicks, impressions, CTR and position for each property against the prior " +
          "period, with a health status per site.",
        params: [
          { name: "site_urls", value: "list of properties" },
          { name: "days", value: "28" },
        ],
      },
      {
        name: "list_properties",
        what: "Every property this account can reach, with permission level",
        ask: "List my Search Console properties.",
        detailHtml: "Every property your Google account can access, with its type (domain or " +
          "URL-prefix) and your permission level. Start here.",
        params: [],
      },
      {
        name: "list_sitemaps",
        what: "Submitted sitemaps with status, errors and indexed counts",
        ask: "Which sitemaps are submitted for this property, and do any have errors?",
        detailHtml: "Every sitemap submitted for the property, with its status, errors, " +
          "warnings and counts.",
        params: [],
      },
    ],
  },
  {
    title: "Image search",
    blurbHtml: "Google's <code>type=image</code> surface, which most tools skip entirely.",
    path: "/tools/image-search",
    tools: [
      {
        name: "image_keyword_overview",
        what: "Top image-search keywords for the site",
        ask: "What are my top Google Images queries for the last 90 days?",
        detailHtml: "Queries the site appears for in Google Images, sorted by impressions, " +
          "clicks or position.",
        params: [
          { name: "days", value: "90" },
          { name: "min_impressions", value: "50" },
          { name: "row_limit", value: "50" },
          { name: "order_by", value: "impressions" },
        ],
      },
      {
        name: "image_search_quick_wins",
        what: "Image queries at positions 4–15 with real impressions",
        ask: "Which image queries are close to the top three?",
        detailHtml: "Image queries at positions 4–15, sorted by the traffic reaching position 3 " +
          "would add, using a CTR baseline for image search rather than web search.",
        params: [
          { name: "days", value: "90" },
          { name: "min_impressions", value: "500" },
          { name: "max_position", value: "15" },
        ],
      },
      {
        name: "image_pages_overview",
        what: "Pages ranked by image-search performance",
        ask: "Which of my pages actually surface in Google Images?",
        detailHtml: "Pages ranked by image-search clicks or impressions. Pairs with the keyword " +
          "overview to map queries back to pages.",
        params: [
          { name: "days", value: "90" },
          { name: "min_impressions", value: "100" },
          { name: "row_limit", value: "50" },
          { name: "order_by", value: "clicks" },
        ],
      },
      {
        name: "image_keyword_trends",
        what: "Period-over-period movement for image queries",
        ask: "Which image queries moved most against the previous 28 days?",
        detailHtml: "Two equal windows joined on query, with impression and position changes.",
        params: [
          { name: "days", value: "28", noteHtml: "length of each window" },
          { name: "min_combined_impressions", value: "100" },
          { name: "row_limit", value: "50" },
          { name: "order_by", value: "impressions_delta" },
        ],
      },
      {
        name: "image_impressions_no_clicks",
        what: "Real image impressions earning effectively zero clicks",
        ask: "Where do my images get seen but not clicked?",
        detailHtml: "Query and page pairs with meaningful image impressions and almost no " +
          "clicks: usually a thumbnail problem.",
        params: [
          { name: "days", value: "90" },
          { name: "min_impressions", value: "500" },
          { name: "max_clicks", value: "2" },
          { name: "row_limit", value: "50" },
        ],
      },
      {
        name: "image_content_decay",
        what: "The decay check, run against image search",
        ask: "Which pages are losing image-search clicks three months running?",
        detailHtml: "The three-window decay check on image search, with a lower click threshold " +
          "than the web version because image clicks run lower.",
        params: [{ name: "min_period3_clicks", value: "5" }],
      },
      {
        name: "compare_web_vs_image",
        what: "Each query side by side across web and image",
        ask: "Compare web and image performance for my top queries.",
        detailHtml: "One Search Analytics request per search type, joined on the query, with an " +
          "impressions ratio that shows where image search carries a large share of the demand.",
        params: [
          { name: "days", value: "90" },
          { name: "min_combined_impressions", value: "100" },
          { name: "row_limit", value: "50" },
        ],
      },
      {
        name: "image_page_audit",
        what: "Audits images on your own pages for what drives image ranking",
        ask: "Audit the images on these two pages.",
        detailHtml: "Fetches up to five of your own pages and checks every image: alt text, " +
          "filenames, width and height attributes, lazy loading on the LCP candidate, " +
          "<code>srcset</code>, format and weight, ImageObject schema, " +
          "<code>max-image-preview</code>, and EXIF, IPTC and XMP metadata in the files. It reads " +
          "pages, not Search Console, so it takes URLs instead of a property.",
        params: [
          { name: "urls", value: "required", noteHtml: "1–5 pages from your own site" },
          { name: "fetch_metadata", value: "true" },
          { name: "max_images_per_page", value: "12", noteHtml: "1–50" },
          { name: "max_images_reported", value: "20" },
        ],
      },
    ],
  },
  {
    title: "AI search, and your account",
    blurbHtml: "The newer surface, plus the controls over your own data.",
    path: "/ai-mode-queries",
    tools: [
      {
        name: "genai_conversation_queries",
        what: "AI-conversation exhaust hiding in ordinary query data",
        ask: "Which of my queries look like AI Mode conversations?",
        detailHtml: "Finds queries shaped like AI conversations and sorts them into seven buckets.",
        params: [
          { name: "days", value: "480", noteHtml: "the full 16 months Search Console keeps" },
          { name: "min_impressions", value: "1" },
          { name: "max_rows_per_bucket", value: "50" },
          { name: "include_timeline", value: "true" },
        ],
      },
      {
        name: "set_default_property",
        what: "Save a default property so later calls can omit it",
        ask: "Make sc-domain:example.com my default property.",
        detailHtml: "Saves a default property for your account, so tool calls that do not name " +
          "one use it.",
        params: [{ name: "site_url", value: "required", noteHtml: "exactly as <span class=\"tool-name\">list_properties</span> reports it" }],
      },
      {
        name: "export_my_data",
        what: "Everything this server stores about you",
        ask: "Show me everything this server stores about me.",
        detailHtml: "Your identity, the status of your Google connection, your saved settings " +
          "and how many active tokens exist. It never includes the stored Google credential.",
        params: [],
      },
      {
        name: "disconnect_account",
        what: "Erase all of it and end your sessions",
        ask: "Disconnect my account and erase what you store.",
        detailHtml: "Erases the stored Google connection, every token and your saved settings, " +
          "and ends your open sessions.",
        params: [],
      },
    ],
  },
];

export const ALL_TOOL_NAMES: string[] = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.name));

/** Present in the software, refused on this hosted instance. */
export const WRITE_TOOLS = ["submit_url", "submit_batch", "submit_sitemap"];

/** Tools with no site_url, matching NO_SITE_URL in scripts/check-tools.mjs (which asserts it). */
export const PROPERTY_INDEPENDENT = [
  "disconnect_account", "export_my_data", "multi_site_dashboard", "submit_url",
  "submit_batch", "list_properties", "image_page_audit",
];

// -- real example output ------------------------------------------------------

export interface Example {
  tool: string;
  /** What was asked, in the words someone would use. */
  asked: string;
  captured: string;
  /** Said plainly when rows were dropped. */
  trimmedNote?: string;
  /** The response as returned, minus dropped rows. */
  output: unknown;
  /** One or two sentences on what the output shows. Plain text. */
  reading: string;
}

const META_NOTE =
  "All numbers in this response come directly from the Google Search Console API. They are exact values, not estimates. Base your analysis only on this data. Do not invent or assume additional context.";

export const EXAMPLES: Record<string, Example> = {
  "/tools/opportunities": {
    tool: "quick_wins",
    asked: "What is k-o.pro almost ranking for? It's a small site, so go down to 5 impressions and position 20.",
    captured: "2026-10-13",
    output: {
      _meta: {
        source: "Google Search Console API (live data)",
        tool: "quick_wins",
        parameters: { days: 90, min_impressions: 5, max_position: 20, site_url: "sc-domain:k-o.pro" },
        note: META_NOTE,
      },
      data: [
        { query: "canonical check", clicks: 0, impressions: 22, ctr: 0, position: 15.6, opportunity: 2 },
      ],
    },
    reading: "One query qualifies on a site this size: \"canonical check\", 22 impressions at an " +
      "average position of 15.6. The parameters Claude actually passed are in _meta, so the " +
      "lowered thresholds are on the record rather than implied.",
  },
  "/tools/diagnostics": {
    tool: "cannibalization_check",
    asked: "Is anything on k-o.pro competing with itself over the last 90 days?",
    captured: "2026-10-13",
    trimmedNote: "first 2 of 7 queries shown",
    output: {
      _meta: {
        source: "Google Search Console API (live data)",
        tool: "cannibalization_check",
        parameters: { days: 90, min_impressions: 10, site_url: "sc-domain:k-o.pro" },
        note: META_NOTE,
      },
      data: [
        {
          query: "bulk redirect checker",
          totalImpressions: 98,
          pages: [
            { page: "https://k-o.pro/bulk-redirect-checker/", clicks: 0, impressions: 21, position: 17.5 },
            { page: "https://k-o.pro/bulk-redirect-checker", clicks: 0, impressions: 77, position: 77.1 },
          ],
        },
        {
          query: "url checker bulk",
          totalImpressions: 48,
          pages: [
            { page: "https://k-o.pro/bulk-redirect-checker/", clicks: 0, impressions: 11, position: 83.9 },
            { page: "https://k-o.pro/bulk-redirect-checker", clicks: 0, impressions: 37, position: 85.7 },
          ],
        },
      ],
    },
    reading: "The competing pages are the same tool at two URLs that differ only by a trailing " +
      "slash. For \"bulk redirect checker\" the slash version averages position 17.5 while the " +
      "other averages 77.1 and takes most of the impressions: a canonicalisation fix, not a " +
      "content one.",
  },
  "/tools/lookups": {
    tool: "inspect_url",
    asked: "Is the k-o.pro homepage indexed, and when was it last crawled?",
    captured: "2026-10-13",
    output: {
      _meta: {
        source: "Google Search Console API (live data)",
        tool: "inspect_url",
        parameters: { url: "https://k-o.pro/", site_url: "sc-domain:k-o.pro" },
        note: META_NOTE,
      },
      data: {
        url: "https://k-o.pro/",
        indexed: true,
        indexingState: "Submitted and indexed",
        lastCrawlTime: "2026-10-02T21:35:12Z",
        crawlAllowed: true,
        indexingAllowed: true,
        pageFetchState: "SUCCESSFUL",
        googleCanonical: "https://k-o.pro/",
        userCanonical: "https://k-o.pro/",
        canonicalMatch: true,
        mobileUsability: "VERDICT_UNSPECIFIED",
        issues: [],
        summary: "This URL is indexed and healthy. Last crawled: 2026-10-02T21:35:12Z.",
      },
    },
    reading: "Indexed, last crawled on 2 October 2026, and Google picked the same canonical the " +
      "page declares. When a URL is not indexed, the same fields say which state it is in.",
  },
  "/tools/image-search": {
    tool: "image_page_audit",
    asked: "Audit the images on the k-o.pro homepage.",
    captured: "2026-10-13",
    output: {
      _meta: {
        source: "Live fetch of the audited pages (the user's own site)",
        tool: "image_page_audit",
        parameters: { urls: ["https://k-o.pro/"], fetch_metadata: true, max_images_per_page: 6, max_images_reported: 6 },
        note: "All findings come from fetching and parsing the listed pages and image files at call time. Alt text, attributes, bytes, and dimensions are read values, not estimates. Base your analysis only on this data. An empty alt (alt=\"\") is correct for decorative images; do not report it as a defect.",
      },
      data: {
        audits: [
          {
            url: "https://k-o.pro/",
            status: "ok",
            http_status: 200,
            page_checks: {
              total_img_tags: 17,
              content_images: 0,
              images_fetched: 0,
              lcp_candidate_src: null,
              lcp_candidate_lazy_loaded: null,
              lcp_candidate_fetchpriority: null,
              inline_background_images: 0,
              max_image_preview: "not_set",
              image_object_schema_count: 0,
              has_licensable_fields: false,
              has_primary_image_of_page: false,
              images_with_srcset: 0,
              modern_format_sources: false,
            },
            images: [],
            images_not_reported: 0,
            issue_counts: {},
            top_fixes: [
              "Add ImageObject schema (with about/mainEntity) for the page's key images",
              "Add max-image-preview:large to the robots meta for full-size previews",
            ],
          },
        ],
        overall: {
          pages_audited: 1,
          pages_failed: 0,
          total_issues: 0,
          note: "empty alt (alt=\"\") is correct for decorative images; it is reported but not counted as an issue.",
        },
      },
    },
    reading: "Of the 17 img tags, none counted as a content image, so no image files were " +
      "fetched. The two page-level fixes it returned are about previews and schema rather than " +
      "the images themselves.",
  },
  "/ai-mode-queries": {
    tool: "genai_conversation_queries",
    asked: "Do any of k-o.pro's queries look like AI conversations?",
    captured: "2026-10-13",
    trimmedNote: "empty buckets, the long-tail bucket and the monthly timeline left out",
    output: {
      _meta: {
        source: "Google Search Console API (live data)",
        tool: "genai_conversation_queries",
        parameters: { days: 480, min_impressions: 1, max_rows_per_bucket: 10, include_timeline: true, site_url: "sc-domain:k-o.pro" },
        note: META_NOTE,
      },
      data: {
        period: { startDate: "2025-06-20", endDate: "2026-10-12" },
        total_conversation_queries: 4,
        total_conversation_impressions: 20,
        buckets: {
          conversational: {
            total_matched: 2,
            rows: [
              {
                query: "how can i implement bulk tracking across chatgpt, perplexity, and gemini for 15+ accounts?",
                impressions: 9, clicks: 0, ctr: 0, position: 89.6,
                top_pages: [{ page: "https://k-o.pro/posts/track-traffic-from-ai-chatbots-ga4", impressions: 9 }],
              },
              {
                query: "is it hard to make a chrome extension",
                impressions: 1, clicks: 0, ctr: 0, position: 51,
                top_pages: [{ page: "https://k-o.pro/posts/how-to-build-a-chrome-extension", impressions: 1 }],
              },
            ],
          },
        },
      },
    },
    reading: "Four queries in 16 months, all low volume: two conversational questions, each " +
      "landing on the post that answers it. No reply artefacts like \"yes\" or \"go on\" on this " +
      "site, which the timeline confirms month by month.",
  },
};

// -- landing-page FAQ ---------------------------------------------------------

/** Answers must stay traceable to the code, the README, or a dated source. */
export const FAQ: [string, string][] = [
  [
    "What is an MCP server?",
    "Model Context Protocol is an open standard for connecting AI clients to " +
    "outside systems. An MCP server exposes a set of tools; the client decides " +
    "when to call them. This one exposes Search Console, so Claude can answer " +
    "questions about your search data without you exporting anything.",
  ],
  [
    "Do I need a Google Cloud project or API keys?",
    "Not for the hosted instance. You add <code>https://gsc.k-o.pro/mcp</code> to " +
    "your client and sign in with Google; the OAuth client belongs to this server. " +
    "Running your own copy does need an OAuth client of your own from Google Cloud " +
    "Console, and the <a href=\"/self-host\">self-hosting guide</a> covers it.",
  ],
  [
    "Is there an official Google Search Console MCP server?",
    "Not as of 13 October 2026. Google's list of " +
    "<a href=\"https://docs.cloud.google.com/mcp/supported-products\" rel=\"noopener\">Google-managed MCP servers</a> " +
    "and its open-source <a href=\"https://github.com/google/mcp\" rel=\"noopener\">google/mcp</a> " +
    "repository do not include Search Console. Servers like this one are built on the public " +
    "Search Console API.",
  ],
  [
    "Do I need to install anything?",
    "No. It runs as a hosted remote MCP server, so you add it by URL and sign " +
    "in with Google. If you would rather your Google token never left your own " +
    "machine, the same server runs locally over stdio — the " +
    "<a href=\"/self-host\">self-hosting guide</a> has the instructions.",
  ],
  [
    "Can it change anything in my Search Console?",
    "No. The hosted service requests one Google permission, " +
    "<code>webmasters.readonly</code>, plus your email address to identify you. " +
    "It cannot edit properties, change sitemaps, or submit URLs for indexing. " +
    "Google's own per-property permissions apply on top, so you see exactly the " +
    "properties Google would show you.",
  ],
  [
    "Does it work across all my properties?",
    "Yes — that is the main reason it exists. Every property-scoped tool takes " +
    "the property as a parameter, so one connection covers your whole account. " +
    "You never edit a config file and restart to look at a different site.",
  ],
  [
    "Is my Search Console data stored anywhere?",
    "No. Each question is answered by fetching live from Google's API and " +
    "handing the result back to your Claude client; nothing is retained " +
    "afterwards. What is stored is your email, your Google account identifier, " +
    "an encrypted refresh token, and your chosen default property.",
  ],
  [
    "Is it free, and is it open source?",
    "The software is open source under Apache 2.0 and the hosted instance is " +
    "free to use. You can read exactly what runs here, or run your own copy.",
  ],
];

/**
 * The comparison, written as the questions worth asking of any Search Console
 * MCP server, answered for this one. Other servers are not named: their specs
 * change, and a table about them would be stale or unverified.
 */
export const COMPARISON: [string, string][] = [
  ["Do you need a Google Cloud project?",
    "No, for the hosted instance. Self-hosting needs your own OAuth client."],
  ["Does it work in claude.ai and Claude Desktop, or only locally?",
    "Both. It is a remote server over Streamable HTTP with its own OAuth, so connector UIs add it by URL; the same code runs locally over stdio."],
  ["One property per config, or all of them?",
    "Every property your Google account can see, from one connection."],
  ["What can it change in your Google account?",
    "Nothing, on the hosted instance: it requests <code>webmasters.readonly</code> only."],
  ["Is your Search Console data stored?",
    "No. It is fetched live for each question and passed back to your client."],
  ["What do the tools return?",
    "Diagnoses with provenance: every answer names the property, the parameters and the date range. 33 tools; 30 run on the hosted instance."],
  ["Does it cover Google Images?",
    "Yes, eight tools on the <code>type=image</code> search type, including an on-page image audit."],
  ["Can it find AI Mode and AI Overview queries?",
    "It finds queries shaped like AI conversations and sorts them into seven buckets. See <a href=\"/ai-mode-queries\">AI Mode queries</a>."],
  ["Price and licence",
    "The hosted instance is free. The code is Apache 2.0 and public on GitHub."],
];
