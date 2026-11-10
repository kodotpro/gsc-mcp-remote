#!/usr/bin/env node
/**
 * Credential-free smoke test for remote (HTTP) mode.
 *
 * Boots the HTTP entry point with a throwaway token and checks the things that
 * can be checked without Google credentials: the health endpoint, that the
 * bearer token is actually enforced, that a session can be opened and lists the
 * full tool set, and that teardown removes it. No call reaches Google, because
 * initialize and tools/list are answered locally.
 *
 * It also covers the capacity limits and the public pages, both of which
 * shipped without a regression guard:
 *
 *  - The session ceiling in bearer mode is GSC_MAX_SESSIONS, NOT the per-user
 *    one. v3.3.0 regressed here: bearer requests carry no identity, so every
 *    session's owner was null and the per-user cap (8) was applied to the
 *    whole server, while /healthz still advertised 120. This suite pins the
 *    correct behaviour so it cannot come back.
 *  - Rate limiting answers 429 with Retry-After.
 *  - The idle sweeper actually reclaims sessions.
 *  - / and /privacy render, and the anti-framing headers are present.
 *  - Every self-hosted font the pages reference is actually served, which is
 *    what catches a build or Dockerfile that stops copying them into dist/.
 *  - Every page in the public-page registry is served, every internal link on
 *    every page resolves, the trailing-slash duplicate of a page redirects to
 *    it, and the sitemap and /llms.txt list exactly what is served.
 *
 * Run: node scripts/check-http.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { formatStars, markdownPathFor, repoLink } from "../dist/web-theme.js";
import { landingPage } from "../dist/web-pages.js";
import { parse as parseHtml } from "node-html-parser";
import { PUBLIC_PAGES, sitemapXml } from "../dist/web-guides.js";
import { GUIDES, PRODUCT_NAME } from "../dist/site-content.js";

const TOKEN = "smoke-test-token-not-a-secret-0123456789";
const PORT = 20000 + Math.floor(Math.random() * 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const MAX_SESSIONS = 5;
const RATE_LIMIT = 4; // used only by the dedicated rate-limit servers below
const CONTACT = "ops@example.invalid";

const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
};

const proc = spawn("node", ["dist/index.js", "http"], {
  env: {
    ...process.env,
    GSC_HTTP_TOKEN: TOKEN,
    GSC_HTTP_PORT: String(PORT),
    GSC_HTTP_HOST: "127.0.0.1",
    // Small enough to exercise the limits quickly, and a fast sweep so the
    // idle check does not have to wait a real minute.
    GSC_MAX_SESSIONS: String(MAX_SESSIONS),
    // High on this server: the session-ceiling checks above open many sessions
    // with initialize, which the limiter now counts. The limiter itself is
    // exercised on dedicated servers further down.
    GSC_RATE_LIMIT_PER_MIN: "1000",
    GSC_HTTP_IDLE_TIMEOUT_MS: "1000",
    GSC_HTTP_SWEEP_INTERVAL_MS: "250",
    GSC_CONTACT_EMAIL: CONTACT,
  },
  stdio: ["ignore", "ignore", "pipe"],
});

let stderr = "";
proc.stderr.on("data", (c) => {
  stderr += c.toString();
});

const post = (body, headers = {}) =>
  fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const auth = { Authorization: `Bearer ${TOKEN}` };

async function waitForBoot(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (proc.exitCode !== null) {
      throw new Error(`server exited early (code ${proc.exitCode}):\n${stderr}`);
    }
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not become healthy on port ${PORT}:\n${stderr}`);
}

try {
  await waitForBoot();

  const health = await (await fetch(`${BASE}/healthz`)).json();
  check("/healthz responds without auth", health.status === "ok", JSON.stringify(health));
  check("/healthz reports the transport", health.transport === "streamable-http");

  // Memory reporting exists so real pressure can be watched rather than
  // inferred: the heap ceiling is what aborts the process, and concurrent
  // large queries are what approach it.
  const mem = health.memory ?? {};
  check("/healthz reports heap usage", typeof mem.heapUsedMb === "number" && mem.heapUsedMb > 0, JSON.stringify(mem));
  check("/healthz reports the heap ceiling", typeof mem.heapLimitMb === "number" && mem.heapLimitMb > mem.heapUsedMb, JSON.stringify(mem));
  check(
    "/healthz reports heap pressure as a percentage",
    typeof mem.heapUsedPercent === "number" && mem.heapUsedPercent > 0 && mem.heapUsedPercent < 100,
    String(mem.heapUsedPercent)
  );
  check("/healthz reports rss", typeof mem.rssMb === "number" && mem.rssMb > 0, String(mem.rssMb));
  // RSS against the cgroup limit is the number to alert on: off-heap image
  // buffers drove a container to an OOM kill while heapUsedPercent read 2.1%.
  check(
    "/healthz reports rss against the container limit",
    "containerLimitMb" in mem && "rssPercentOfLimit" in mem,
    JSON.stringify(mem)
  );
  check("/healthz reports off-heap bytes", typeof mem.externalMb === "number", String(mem.externalMb));
  // Saturation of the ceilings is the early warning that was previously invisible.
  const lim = health.limiters ?? {};
  check(
    "/healthz reports the concurrency ceilings and their saturation",
    typeof lim.outboundFetch?.limit === "number" && typeof lim.searchConsoleQuery?.limit === "number"
      && typeof lim.outboundFetch?.queued === "number",
    JSON.stringify(lim)
  );
  // The row ceiling is the single biggest driver of peak memory, so it is
  // reported alongside it rather than left to be read out of the config.
  check("/healthz reports the row ceiling in force", health.maxRowsPerQuery === 25000, String(health.maxRowsPerQuery));

  const noToken = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  check("POST /mcp without a token is rejected", noToken.status === 401, `got ${noToken.status}`);

  const badToken = await post(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { Authorization: "Bearer wrong-token-wrong-token-wrong-token" }
  );
  check("POST /mcp with a wrong token is rejected", badToken.status === 401, `got ${badToken.status}`);

  const initRes = await post(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "check-http", version: "1.0" },
      },
    },
    auth
  );
  check("initialize with a valid token succeeds", initRes.ok, `got ${initRes.status}`);

  const sessionId = initRes.headers.get("mcp-session-id");
  check("initialize returns an mcp-session-id", Boolean(sessionId));

  if (sessionId) {
    const sessionHeaders = { ...auth, "mcp-session-id": sessionId };
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionHeaders);

    const listRes = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, sessionHeaders);
    const listed = await listRes.json();
    const count = listed?.result?.tools?.length ?? 0;
    check("tools/list over HTTP returns the full tool set", count === 32, `got ${count}`);

    const afterOpen = await (await fetch(`${BASE}/healthz`)).json();
    check("the open session is counted", afterOpen.activeSessions === 1, `got ${afterOpen.activeSessions}`);

    const del = await fetch(`${BASE}/mcp`, { method: "DELETE", headers: sessionHeaders });
    check("DELETE /mcp closes the session", del.ok, `got ${del.status}`);

    const afterClose = await (await fetch(`${BASE}/healthz`)).json();
    check("no sessions remain after teardown", afterClose.activeSessions === 0, `got ${afterClose.activeSessions}`);

    const reuse = await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, sessionHeaders);
    check("a closed session cannot be reused", reuse.status === 404, `got ${reuse.status}`);
  }

  // -- the public pages, and anti-framing ------------------------------------
  const root = await fetch(`${BASE}/`);
  const rootBody = await root.text();
  check("GET / serves the service description", root.ok && /text\/html/.test(root.headers.get("content-type") ?? ""), `got ${root.status}`);
  check("the landing page links to the privacy policy", rootBody.includes('href="/privacy"'));
  check("the consent-page origin refuses framing", root.headers.get("x-frame-options") === "DENY", `got ${root.headers.get("x-frame-options")}`);
  const csp = root.headers.get("content-security-policy") ?? "";
  check("CSP blocks scripts and framing", csp.includes("default-src 'none'") && csp.includes("frame-ancestors 'none'"), csp);
  // NOT just "form-action 'self'": that assertion passed while the consent
  // form was completely broken. The form posts to this origin, but that route
  // answers 302 to accounts.google.com, and browsers apply form-action across
  // the whole navigation — so 'self' alone silently aborted the submission.
  // Parse form-action into its source expressions rather than substring-matching
  // the header: "https://accounts.google.com.evil.com" contains the string we
  // want but is a different origin. This test guards the CSP whose earlier,
  // stricter form silently aborted the consent POST, so it should be exact.
  const formAction = (csp.split(";").find((d) => d.trim().startsWith("form-action")) ?? "")
    .trim()
    .split(/\s+/)
    .slice(1);
  check(
    "CSP permits the consent form to reach Google",
    // === rather than .includes(): formAction is already split into source
    // expressions, so this is an exact match either way, but comparing
    // explicitly says so to both the reader and the scanner.
    formAction.some((src) => src === "'self'") &&
      formAction.some((src) => src === "https://accounts.google.com"),
    `form-action sources: ${JSON.stringify(formAction)}`
  );

  const privacy = await fetch(`${BASE}/privacy`);
  const privacyBody = await privacy.text();
  check("GET /privacy serves the policy", privacy.ok, `got ${privacy.status}`);
  // Google's reviewer reads this page; these are the claims that must be there
  // AND must stay true of the code.
  check("the policy names the single scope requested", privacyBody.includes("webmasters.readonly"));
  check("the policy names the deletion control that exists", privacyBody.includes("disconnect_account"));
  // Google's verification for a sensitive scope requires this statement on the
  // privacy page, and docs/verification/scope-justifications.md says it is there.
  check("the policy carries the Google API Services User Data Policy / Limited Use statement", /Google API Services User Data Policy/i.test(privacyBody) && /Limited Use/i.test(privacyBody));
  check("...and links to the policy itself", /<a href="https:\/\/developers\.google\.com\/terms\/api-services-user-data-policy"/.test(privacyBody));
  check("the policy says plainly that sign-in also uses openid and email", /openid/i.test(privacyBody) && /email/i.test(privacyBody) && !/One Google permission only/i.test(privacyBody));
  check("the policy no longer claims a database copy yields no credentials at all", !/does not yield working credentials/i.test(privacyBody));
  check("the policy discloses that backups can retain erased data until they expire", /backups/i.test(privacyBody) && /30 days/i.test(privacyBody));
  check("the policy states data is not used for AI training", /train any machine-learning/i.test(privacyBody));
  // The server sets a flow cookie for the OAuth browser binding. A privacy
  // page claiming otherwise would be a false statement on the page Google's
  // reviewer reads, so the disclosure and the code are pinned together here.
  check(
    "the policy discloses the sign-in cookie the server actually sets",
    /exactly one cookie/i.test(privacyBody) && /HttpOnly/i.test(privacyBody),
    "privacy page must disclose the gsc_auth_flow cookie"
  );
  check("the policy renders the configured contact address", privacyBody.includes(CONTACT));

  // -- the self-hosted web fonts ---------------------------------------------
  // Asserted against what the page actually asks for rather than a hardcoded
  // list: `npm run build` copies these out of src/ as a separate step, and the
  // Dockerfile ships only dist/, so a font that stops being copied would load
  // fine from the repo in dev and 404 in production. Every url(/fonts/...) in
  // the rendered CSS must resolve, or the pages silently fall back to system
  // fonts everywhere they are actually deployed.
  const fontUrls = [...new Set([...rootBody.matchAll(/url\((\/fonts\/[^)]+)\)/g)].map((m) => m[1]))];
  check("the landing page references self-hosted fonts", fontUrls.length > 0, "no url(/fonts/...) in the CSS");
  for (const url of fontUrls) {
    const res = await fetch(`${BASE}${url}`);
    check(
      `${url} is served`,
      res.ok && (res.headers.get("content-type") ?? "").startsWith("font/"),
      `got ${res.status} ${res.headers.get("content-type")}`
    );
  }
  // The fonts are same-origin, so 'self' is what makes them loadable at all.
  check("CSP permits the self-hosted fonts", /font-src[^;]*'self'/.test(csp), csp);
  // The filename is matched against an allow-list, never joined onto a path,
  // so nothing outside dist/fonts is reachable through this route.
  const strayFont = await fetch(`${BASE}/fonts/not-a-font.woff2`);
  check("an unknown font name is refused", strayFont.status === 404, `got ${strayFont.status}`);
  const card = await fetch(`${BASE}/img/og-card-v2.png`);
  check("the redrawn social card is served, and the old one still is for links already shared",
    card.status === 200 && card.headers.get("content-type") === "image/png" && (await fetch(`${BASE}/img/og-card-v1.png`)).status === 200);
  // The MCP Apps view runs in a client's sandboxed iframe (an opaque origin)
  // and fonts are always fetched in CORS mode, so without this header the view
  // on a hosted deployment silently falls back to the system font.
  const viewFont = await fetch(`${BASE}/fonts/host-grotesk-latin.woff2`);
  check("the MCP Apps view's font is served, and readable from any origin",
    viewFont.status === 200 && viewFont.headers.get("access-control-allow-origin") === "*" && viewFont.headers.get("content-type") === "font/woff2",
    `${viewFont.status} ${viewFont.headers.get("access-control-allow-origin")}`);
  const pageImage = await fetch(`${BASE}/img/k-o-pro.png`);
  check("...and that header is on the fonts only, not on the rest of the site",
    pageImage.headers.get("access-control-allow-origin") === null && (await fetch(`${BASE}/healthz`)).headers.get("access-control-allow-origin") === null);

  // Same reasoning for the images the pages reference — the wordmark travels
  // through the same build-copy step the fonts do.
  const imgUrls = [...new Set([...rootBody.matchAll(/src="(\/img\/[^"]+)"/g)].map((m) => m[1]))];
  check("the landing page references the wordmark", imgUrls.length > 0, "no /img/ reference in the markup");
  for (const url of imgUrls) {
    const res = await fetch(`${BASE}${url}`);
    check(
      `${url} is served`,
      res.ok && (res.headers.get("content-type") ?? "").startsWith("image/"),
      `got ${res.status} ${res.headers.get("content-type")}`
    );
  }
  check("CSP permits the same-origin wordmark", /img-src[^;]*'self'/.test(csp), csp);

  // The same concern one layer up, and this one shipped broken: `npm run build`
  // gained `node scripts/copy-assets.mjs`, but the Dockerfile's build stage
  // copied only src/, so the image build died on MODULE_NOT_FOUND while every
  // local build passed. Any path the build script runs must be COPYed before
  // `RUN npm run build`, or the failure appears only on a deploy.
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const buildScript = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts.build;
  const buildStage = dockerfile.slice(0, dockerfile.indexOf("RUN npm run build"));
  const neededDirs = [...new Set([...buildScript.matchAll(/\bnode\s+([\w.-]+)\//g)].map((m) => m[1]))];
  check("the build script runs something from a directory", neededDirs.length > 0, buildScript);
  for (const dir of neededDirs) {
    check(
      `the Dockerfile copies ${dir}/ before building`,
      new RegExp(`^COPY\\s+${dir}\\s`, "m").test(buildStage),
      `\`npm run build\` runs node ${dir}/… but no \`COPY ${dir}\` precedes RUN npm run build`
    );
  }

  // -- the GitHub star counter -----------------------------------------------
  // The count is polled in the background, so a render can always land before
  // the first poll returns — or after every poll has failed. That case must
  // produce a link with no counter, never a "0", which would read as a real
  // and untrue number.
  const REPO = "https://github.com/kodotpro/gsc-mcp-remote";
  const unknown = repoLink(REPO, undefined);
  check("an unknown star count renders no counter", !unknown.includes("gh-stars"), unknown);
  check(
    "an unknown star count still renders the link",
    unknown.includes(`href="${REPO}"`),
    unknown
  );
  check("a known star count renders the counter", repoLink(REPO, 42).includes("gh-stars"));
  check(
    "star counts are abbreviated the way GitHub abbreviates them",
    formatStars(999) === "999" && formatStars(1200) === "1.2k" && formatStars(12500) === "13k",
    `${formatStars(999)} / ${formatStars(1200)} / ${formatStars(12500)}`
  );

  // -- crawler-facing metadata -----------------------------------------------
  // JSON-LD lives in a <script> body, which is raw text: HTML entities are not
  // decoded there, so escaping it the way the rest of the page is escaped
  // yields `&quot;` and JSON no consumer can parse. It rendered "fine" and was
  // silently broken. Parse it rather than grepping for it.
  const ldBlocks = [...rootBody.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]);
  check("the landing page emits structured data", ldBlocks.length >= 2, `${ldBlocks.length} block(s)`);
  let ldTypes = [];
  try {
    ldTypes = ldBlocks.map((b) => JSON.parse(b)["@type"]);
    check("every JSON-LD block parses as JSON", true);
  } catch (err) {
    check("every JSON-LD block parses as JSON", false, err.message);
  }
  check("structured data describes the software and the site",
    ldTypes.includes("SoftwareApplication") && ldTypes.includes("WebSite"), ldTypes.join(","));
  // The questions moved to their own page, and their markup moved with them:
  // FAQPage belongs on the page that shows the FAQ.
  const faqBody = await (await fetch(`${BASE}/faq`)).text();
  const faqLd = [...faqBody.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faqPage = faqLd.find((d) => d["@type"] === "FAQPage");
  check("/faq carries FAQPage markup with one entry per question shown",
    faqPage?.mainEntity?.length === (faqBody.match(/class="faq/g) ?? []).length && faqPage.mainEntity.length >= 8,
    `${faqPage?.mainEntity?.length} entries`);
  check("the landing page no longer claims a FAQ it does not show", !ldTypes.includes("FAQPage"));
  // No `</script>` may survive into the block, or the element closes early.
  check("structured data cannot break out of its element",
    !ldBlocks.some((b) => b.toLowerCase().includes("</script")));

  // This deployment has no GSC_PUBLIC_URL, so publicUrl is a loopback address.
  // Announcing that as canonical would tell a crawler the page really lives on
  // 127.0.0.1, so the absolute-URL metadata must be omitted entirely.
  check("no canonical is claimed without a public https origin", !/rel="canonical"/.test(rootBody));
  check("no og:url is claimed without a public https origin", !/property="og:url"/.test(rootBody));
  const noSitemap = await fetch(`${BASE}/sitemap.xml`);
  check("no sitemap is served without a public https origin", noSitemap.status === 404, `got ${noSitemap.status}`);

  const robots = await fetch(`${BASE}/robots.txt`);
  const robotsBody = await robots.text();
  check("robots.txt is served", robots.ok, `got ${robots.status}`);
  check("robots.txt keeps crawlers out of the auth and MCP routes",
    /Disallow: \/oauth\//.test(robotsBody) && /Disallow: \/mcp/.test(robotsBody), robotsBody);

  // The published shape, rendered directly: with a real https origin the same
  // page must claim itself as canonical.
  const published = landingPage({
    publicUrl: "https://gsc.example.com",
    perUserSignIn: true,
    repoUrl: "https://github.com/kodotpro/gsc-mcp-remote",
  });
  check("a published deployment claims its own canonical",
    published.includes('<link rel="canonical" href="https://gsc.example.com/">'));
  check("the install link carries the connector URL, encoded",
    published.includes("connectorUrl=https%3A%2F%2Fgsc.example.com%2Fmcp"),
    "claude.ai deep link missing or unencoded");

  // The social card needs an absolute URL, so it rides on the same https
  // gate as the canonical — and the file it names must actually be served.
  const ogImage = published.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? "";
  check("a published deployment names an absolute social image",
    ogImage.startsWith("https://gsc.example.com/img/"), ogImage || "no og:image");
  check("the social card is announced as a large image",
    published.includes('<meta name="twitter:card" content="summary_large_image">'));
  if (ogImage) {
    const res = await fetch(`${BASE}${new URL(ogImage).pathname}`);
    check("the social image is served", res.ok && (res.headers.get("content-type") ?? "").startsWith("image/png"),
      `got ${res.status} ${res.headers.get("content-type")}`);
  }
  check("no og:image is claimed without a public https origin", !/property="og:image"/.test(rootBody));
  const publishedLd = [...published.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]));
  const software = publishedLd.find((d) => d["@type"] === "SoftwareApplication") ?? {};
  check("the software is named by its product name in structured data", software.name === PRODUCT_NAME, software.name);
  check("the structured data carries the running version", software.softwareVersion === health.version,
    `${software.softwareVersion} vs ${health.version}`);
  check("the structured data URL matches the canonical", software.url === "https://gsc.example.com/", software.url);

  // -- the landing page stays a landing page ------------------------------------
  // It had grown to ten sections, six tables and about 2,800 words, with the full
  // tool reference, the comparison and the FAQ on it. Those live on /tools,
  // /compare and /faq now; these ceilings keep them from drifting back.
  {
    const main = rootBody.slice(rootBody.indexOf("<main>"), rootBody.indexOf("</main>"));
    const words = parseHtml(main).text.split(/\s+/).filter(Boolean).length;
    check("the landing page is under 1,400 words", words < 1400, `${words} words`);
    check("...has at most six sections", (main.match(/<h2[\s>]/g) ?? []).length <= 6, `${(main.match(/<h2[\s>]/g) ?? []).length} h2`);
    check("...and shows what a result looks like before how to connect",
      main.indexOf('id="what-you-get"') > 0 && main.indexOf('id="what-you-get"') < main.indexOf('id="connecting"'));
    for (const path of ["/tools", "/compare", "/faq", "/privacy"]) {
      check(`the landing page links to ${path}`, main.includes(`href="${path}`));
    }
  }

  // -- illustrations are labelled as illustrations --------------------------------
  // Everything else on these pages that looks like output is real and dated.
  // The view mock-ups are not, so each one must say so where it is shown.
  for (const path of ["/", "/tools"]) {
    const body = path === "/" ? rootBody : await (await fetch(`${BASE}${path}`)).text();
    const figures = body.match(/<figure class="demo[\s\S]*?<\/figure>/g) ?? [];
    check(`${path} shows view illustrations`, figures.length >= 2, `${figures.length}`);
    check(`${path}: every illustration says it is sample data and uses example.com`,
      figures.every((f) => /Sample data/.test(f) && /example\.com/.test(f) && !/k-o\.pro/.test(f)));
  }
  {
    const toolsBody = await (await fetch(`${BASE}/tools`)).text();
    const { VIEW_TOOLS } = await import("../dist/apps.js");
    const section = toolsBody.slice(toolsBody.indexOf('id="interactive-views"'), toolsBody.indexOf('id="results"'));
    check("/tools names every tool that has a view, and no other, in that section's table",
      [...VIEW_TOOLS].every((t) => section.includes(`<span class="tool-name">${t}</span></td>`)) &&
      (section.match(/<tr><td><span class="tool-name">/g) ?? []).length === VIEW_TOOLS.size);
    check("/tools says how many tools have a view, from the code", section.includes(`${VIEW_TOOLS.size} tools come with a view`));
    const diag = await (await fetch(`${BASE}/tools/diagnostics`)).text();
    check("a tool's own page marks it when it has a view", /id="traffic_drops"[\s\S]{0,900}Interactive view/.test(diag) && !/id="list_properties"[\s\S]{0,600}Interactive view/.test(await (await fetch(`${BASE}/ai-mode-queries`)).text()));
  }

  // -- motion ----------------------------------------------------------------------
  // k-o.pro's animations, in CSS only. Two properties matter more than how they
  // look: nothing may be left invisible for someone who asked for less motion or
  // whose browser lacks scroll-driven animation, and the values are k-o.pro's.
  {
    const css = rootBody.match(/<style>([\s\S]*?)<\/style>/)[1];
    const start = css.indexOf("@media (prefers-reduced-motion:no-preference){");
    let depth = 0, end = start;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) { end = i + 1; break; }
    }
    const inside = css.slice(start, end);
    const outside = css.slice(0, start) + css.slice(end);
    check("the motion rules exist", start > 0 && /@keyframes hw/.test(inside) && /@keyframes st/.test(inside));
    check("nothing outside the no-preference block hides or animates content",
      !/opacity:0/.test(outside) && !/@keyframes/.test(outside) && !/[^-]animation:/.test(outside) && !/filter:blur/.test(outside.replace(/backdrop-filter:blur/g, "")),
      (outside.match(/opacity:0|@keyframes \w+|[^-]animation:[^;}]+/g) ?? []).join(" | "));
    check("the scroll reveal is behind @supports, so a browser without it shows the content",
      /@supports \(animation-timeline:view\(\)\)\{[^@]*\.st\{/.test(inside) && !/\.st\{[^}]*opacity:0/.test(inside.replace(/@supports[\s\S]*$/, "")));
    for (const [what, rule] of [
      ["headline words", ".95s cubic-bezier(.2,.7,.2,1) both hw"],
      ["the 42ms stagger", "calc(var(--i,0) * 42ms + .12s)"],
      ["the underline draw", "1.1s cubic-bezier(.2,.7,.2,1) 1.15s forwards mark"],
      ["the hero fade", ".9s cubic-bezier(.2,.7,.2,1) both fade"],
      ["the status ping", "2.4s ease-out infinite ping"],
      ["the reveal's start state", "0%{opacity:0;filter:blur(6px);transform:translateY(32px)}"],
    ]) check(`${what} use k-o.pro's own timing`, css.includes(rule), rule);
    check("the card lift and the link underline match k-o.pro's hover",
      css.includes(".lift:hover{transform:translateY(-4px);box-shadow:0 28px 56px -32px #14141261}") && css.includes("background-size .5s cubic-bezier(.2,.7,.2,1)"));
    check("the headline is still ordinary words: one span per word, spaces between them",
      /<h1><span class="hw" style="--i:0">Google<\/span> <span class="hw" style="--i:1">Search<\/span> /.test(rootBody));
    check("pages still carry no script except data blocks", !/<script(?! type="application\/ld\+json")/.test(rootBody));
  }

  // -- the public-page registry ------------------------------------------------
  // One registry feeds the routes, the sitemap and /llms.txt. These checks are
  // what make "a page cannot exist without being listed" true rather than hoped.
  const servedPaths = new Set(PUBLIC_PAGES.map((p) => p.path));
  check("every guide in the footer is a registered page", GUIDES.every((g) => servedPaths.has(g.path)),
    GUIDES.filter((g) => !servedPaths.has(g.path)).map((g) => g.path).join(", "));
  const pageBodies = new Map();
  for (const { path } of PUBLIC_PAGES) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    const body = await res.text();
    pageBodies.set(path, body);
    check(`GET ${path} serves a page`, res.status === 200 && /text\/html/.test(res.headers.get("content-type") ?? ""),
      `got ${res.status}`);
    check(`${path} has exactly one h1`, (body.match(/<h1[\s>]/g) ?? []).length === 1);
    let ldOk = true;
    for (const m of body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(m[1]); } catch { ldOk = false; }
    }
    check(`${path} structured data parses`, ldOk);
    const published = PUBLIC_PAGES.find((p) => p.path === path).render({
      publicUrl: "https://gsc.example.com", perUserSignIn: true, repoUrl: REPO,
    });
    check(`${path} claims its own canonical when published`,
      published.includes(`<link rel="canonical" href="https://gsc.example.com${path}">`));
  }

  // Every same-origin link on every page must resolve. A page renamed in one
  // place and not another fails here instead of shipping a 404.
  const internal = new Set();
  for (const body of pageBodies.values()) {
    for (const m of body.matchAll(/href="(\/[^"#?]*)/g)) internal.add(m[1]);
  }
  for (const href of internal) {
    const res = await fetch(`${BASE}${href}`, { redirect: "manual" });
    check(`internal link ${href} resolves`, res.status === 200, `got ${res.status}`);
  }

  // Express would otherwise serve /claude/ as a second copy of /claude.
  const slash = await fetch(`${BASE}/claude/?ref=test`, { redirect: "manual" });
  check("the trailing-slash duplicate of a page redirects permanently",
    slash.status === 301 && slash.headers.get("location") === "/claude?ref=test",
    `got ${slash.status} -> ${slash.headers.get("location")}`);
  const mcpSlash = await fetch(`${BASE}/mcp/`, { redirect: "manual" });
  check("/mcp/ is not caught by the page redirect", mcpSlash.status !== 301, `got ${mcpSlash.status}`);

  const sitemap = sitemapXml("https://gsc.example.com");
  const sitemapLocs = [...sitemap.matchAll(/<loc>https:\/\/gsc\.example\.com([^<]*)<\/loc>/g)].map((m) => m[1]);
  check("the sitemap lists every public page and nothing else",
    sitemapLocs.length === servedPaths.size && sitemapLocs.every((p) => servedPaths.has(p)),
    sitemapLocs.join(", "));

  const llms = await fetch(`${BASE}/llms.txt`);
  const llmsBody = await llms.text();
  check("/llms.txt is served as text", llms.ok && /text\/plain/.test(llms.headers.get("content-type") ?? ""),
    `got ${llms.status} ${llms.headers.get("content-type")}`);
  check("/llms.txt names the MCP endpoint", llmsBody.includes("/mcp "));
  // Pointed at the Markdown, not the HTML: an agent following the index should
  // land on the clean form without having to negotiate for it.
  const guideLink = (g) => `${markdownPathFor(g.path)})`;
  check("/llms.txt links every guide, as Markdown", GUIDES.every((g) => llmsBody.includes(guideLink(g))),
    GUIDES.filter((g) => !llmsBody.includes(guideLink(g))).map((g) => g.path).join(", "));
  check("/llms.txt links no HTML page", !GUIDES.some((g) => llmsBody.includes(`${g.path})`)));
  for (const target of new Set([...llmsBody.matchAll(/\]\((\/[^)]*)\)/g)].map((m) => m[1]))) {
    const res = await fetch(`${BASE}${target}`);
    check(`/llms.txt link ${target} resolves`, res.status === 200, `got ${res.status}`);
  }

  // -- Markdown representations ------------------------------------------------
  // Every page is also Markdown, for the coding agents that ask for it. How the
  // choice is made has its own suite (check-markdown.mjs); what is checked here
  // is what only a running server can show: the headers, the routes, and that
  // the two ways of asking return the same document.
  const varies = (res) => /(^|,\s*)Accept(\s*,|$)/i.test(res.headers.get("vary") ?? "");
  for (const { path } of PUBLIC_PAGES) {
    const mdPath = markdownPathFor(path);
    const md = await fetch(`${BASE}${mdPath}`);
    const mdBody = await md.text();
    check(`${mdPath} serves Markdown`, md.status === 200 && /^text\/markdown/.test(md.headers.get("content-type") ?? ""),
      `got ${md.status} ${md.headers.get("content-type")}`);
    check(`${mdPath} has content`, /^#{1} \S/m.test(mdBody), mdBody.slice(0, 80));
    check(`${mdPath} says Vary: Accept`, varies(md), md.headers.get("vary"));
    check(`${mdPath} points back at the HTML page`,
      (md.headers.get("link") ?? "").includes(`<${path}>; rel="alternate"; type="text/html"`), md.headers.get("link"));

    const html = await fetch(`${BASE}${path}`);
    const htmlBody = await html.text();
    check(`${path} says Vary: Accept`, varies(html), html.headers.get("vary"));
    check(`${path} advertises its Markdown in a Link header`,
      (html.headers.get("link") ?? "").includes(`<${mdPath}>; rel="alternate"; type="text/markdown"`), html.headers.get("link"));
    check(`${path} advertises its Markdown in the document head`,
      htmlBody.includes(`<link rel="alternate" type="text/markdown" href="${mdPath}">`));

    const negotiated = await fetch(`${BASE}${path}`, { headers: { Accept: "text/markdown" } });
    check(`${path} with Accept: text/markdown is the same document as ${mdPath}`,
      /^text\/markdown/.test(negotiated.headers.get("content-type") ?? "") && (await negotiated.text()) === mdBody);
    check(`${path} says Vary: Accept on the Markdown too`, varies(negotiated), negotiated.headers.get("vary"));
  }

  const browserAccept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  const asBrowser = await fetch(`${BASE}/claude`, { headers: { Accept: browserAccept } });
  check("a browser's Accept header still gets HTML", /^text\/html/.test(asBrowser.headers.get("content-type") ?? ""));
  const preferHtml = await fetch(`${BASE}/claude`, { headers: { Accept: "text/html, text/markdown;q=0.5" } });
  check("a client that prefers HTML over Markdown gets HTML", /^text\/html/.test(preferHtml.headers.get("content-type") ?? ""));
  const agent = await fetch(`${BASE}/claude`, { headers: { Accept: "text/markdown, text/html" } });
  check("a coding agent that lists Markdown first, both at q=1, gets Markdown",
    /^text\/markdown/.test(agent.headers.get("content-type") ?? ""));
  const none = await fetch(`${BASE}/claude`, { headers: { Accept: "image/png" } });
  check("a client that accepts neither gets 406, not a silent substitute", none.status === 406, `got ${none.status}`);
  check("the 406 still says Vary: Accept", varies(none), none.headers.get("vary"));
  const explicit = await fetch(`${BASE}/claude.md`, { headers: { Accept: "image/png" } });
  check("an explicit .md address is not subject to negotiation", explicit.status === 200
    && /^text\/markdown/.test(explicit.headers.get("content-type") ?? ""), `got ${explicit.status}`);
  const missingMd = await fetch(`${BASE}/not-a-page.md`);
  check("a .md address for no page is a 404", missingMd.status === 404, `got ${missingMd.status}`);

  // The root is /index.md, so there is no page called "index" to collide with.
  const rootMd = await (await fetch(`${BASE}/index.md`)).text();
  check("/index.md carries the landing page", rootMd.includes(`# ${PRODUCT_NAME}`), rootMd.slice(0, 100));

  // The whole site in one request: shipped, not redirected, because the guides
  // document every tool's parameters and defaults.
  const full = await fetch(`${BASE}/llms-full.txt`);
  const fullBody = await full.text();
  check("/llms-full.txt is served as text", full.ok && /^text\/plain/.test(full.headers.get("content-type") ?? ""),
    `got ${full.status} ${full.headers.get("content-type")}`);
  check("/llms-full.txt contains every page", PUBLIC_PAGES.every((p) => fullBody.includes(`Source: ${p.path}\n`)),
    PUBLIC_PAGES.filter((p) => !fullBody.includes(`Source: ${p.path}\n`)).map((p) => p.path).join(", "));
  check("/llms-full.txt ends with the trademark notice, stated once",
    /trademarks of Google LLC\.\s*$/.test(fullBody) && (fullBody.match(/trademarks of Google LLC/g) ?? []).length === 1);

  // What AI systems may do with the pages, in the one place crawlers look.
  const robotLines = robotsBody.split("\n");
  check("robots.txt carries a Content-Signal inside the * group, before its rules",
    robotLines[0] === "User-agent: *" && robotLines[1] === "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    robotLines.slice(0, 3).join(" | "));
  check("robots.txt does not block the Markdown pages", !/Disallow: \/(index|[a-z-]+)\.md/.test(robotsBody));

  const favicon = await fetch(`${BASE}/favicon.ico`);
  check("/favicon.ico is served", favicon.ok && (favicon.headers.get("content-type") ?? "").startsWith("image/"),
    `got ${favicon.status} ${favicon.headers.get("content-type")}`);

  // -- capacity limits -------------------------------------------------------
  const openSession = async () => {
    const r = await post(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cap", version: "1" } } },
      auth
    );
    return { status: r.status, id: r.headers.get("mcp-session-id"), retryAfter: r.headers.get("retry-after") };
  };

  const held = [];
  let overflow = null;
  for (let i = 0; i < MAX_SESSIONS + 2; i++) {
    const r = await openSession();
    if (r.status === 200 && r.id) held.push(r.id);
    else if (!overflow) overflow = r;
  }
  // The regression: this used to stop at 8 (the per-user cap) regardless of
  // GSC_MAX_SESSIONS, because bearer sessions all share a null owner.
  check(
    `bearer mode fills the server-wide ceiling (${MAX_SESSIONS}), not the per-user one`,
    held.length === MAX_SESSIONS,
    `opened ${held.length} of ${MAX_SESSIONS}`
  );
  check("the session ceiling answers 503", overflow?.status === 503, `got ${overflow?.status}`);
  check("the 503 carries Retry-After", Boolean(overflow?.retryAfter), `got ${overflow?.retryAfter}`);

  const healthAtCap = await (await fetch(`${BASE}/healthz`)).json();
  check("/healthz reports the real ceiling", healthAtCap.sessionLimit === MAX_SESSIONS, `got ${healthAtCap.sessionLimit}`);
  check(
    "/healthz reports no per-user ceiling in bearer mode",
    healthAtCap.perUserSessionLimit === null,
    `got ${JSON.stringify(healthAtCap.perUserSessionLimit)}`
  );

  // -- the trailing-slash middleware ---------------------------------------
  // It runs on the raw path of every unauthenticated GET, so it must stay cheap
  // and correct for hostile paths as well as ordinary ones.
  {
    const noFollow = { redirect: "manual" };
    const slashed = await fetch(`${BASE}/claude///`, noFollow);
    check("a known page with trailing slashes still answers 301 to the canonical URL", slashed.status === 301 && new URL(slashed.headers.get("location") ?? "", BASE).pathname === "/claude", `${slashed.status} ${slashed.headers.get("location")}`);
    const t0 = performance.now();
    const hostile = await fetch(`${BASE}/${"/".repeat(12_000)}x/`, noFollow);
    const ms = performance.now() - t0;
    // Sanity, not proof: Node caps a request line near 16 KB, where the old regex
    // cost tens of milliseconds. The linear-time guarantee is asserted on the
    // helper in check-hardening.mjs.
    check("a path of 12,000 slashes is answered promptly and is not redirected", hostile.status !== 301 && ms < 1500, `${hostile.status} in ${ms.toFixed(0)} ms`);
    const mcpSlash = await fetch(`${BASE}/mcp/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    check("/mcp/ keeps working as before (401 without a token, not a redirect)", mcpSlash.status === 401, String(mcpSlash.status));
  }

  // -- rate limiting ---------------------------------------------------------
  // Each scenario gets its own short-lived server so it starts with a fresh
  // budget. Every one of them is an attack that used to go uncounted: the
  // limiter sat inside the "request carries a session id" branch and charged one
  // unit per HTTP request, so initialize, GET, DELETE and unknown-session
  // probes were free and a 100-message JSON-RPC batch cost the same as one.
  const withServer = async (rate, fn) => {
    const rp = 20000 + Math.floor(Math.random() * 9000);
    const rbase = `http://127.0.0.1:${rp}`;
    const child = spawn("node", ["dist/index.js", "http"], {
      env: { ...process.env, GSC_HTTP_TOKEN: TOKEN, GSC_HTTP_PORT: String(rp), GSC_HTTP_HOST: "127.0.0.1", GSC_RATE_LIMIT_PER_MIN: String(rate), GSC_CONTACT_EMAIL: CONTACT },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (c) => (err += c.toString()));
    try {
      let up = false;
      for (let i = 0; i < 60 && !up; i++) {
        if (child.exitCode !== null) throw new Error(`rate-limit server exited early:\n${err}`);
        up = await fetch(`${rbase}/healthz`).then((r) => r.ok).catch(() => false);
        if (!up) await new Promise((r) => setTimeout(r, 250));
      }
      if (!up) throw new Error(`rate-limit server did not become healthy:\n${err}`);
      const rpost = (body, headers = {}) => fetch(`${rbase}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...auth, ...headers },
        body: JSON.stringify(body),
      });
      return await fn({ rbase, rpost });
    } finally {
      child.kill("SIGTERM");
    }
  };
  const initBody = (id) => ({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "rl", version: "1" } } });

  await withServer(RATE_LIMIT, async ({ rpost }) => {
    // ordinary traffic still engages the limiter and says when to retry
    const init = await rpost(initBody(1));
    const sid = init.headers.get("mcp-session-id");
    await init.text();
    let limited = null;
    for (let i = 0; i < RATE_LIMIT + 3; i++) {
      const r = await rpost({ jsonrpc: "2.0", id: 10 + i, method: "tools/list" }, { "mcp-session-id": sid });
      if (r.status === 429) { limited = { at: i + 1, retryAfter: r.headers.get("retry-after") }; break; }
    }
    check("the request rate limit engages", limited !== null, `no 429 within ${RATE_LIMIT + 3} requests`);
    check("the 429 carries Retry-After", Boolean(limited?.retryAfter), `got ${limited?.retryAfter}`);
  });

  await withServer(RATE_LIMIT, async ({ rpost }) => {
    // ATTACK: session churn. initialize allocates a whole McpServer with every
    // tool registered and carries no session id, so it used to bypass the limit.
    let firstLimit = null, accepted = 0;
    for (let i = 0; i < RATE_LIMIT + 6; i++) {
      const r = await rpost(initBody(100 + i));
      await r.text();
      if (r.status === 429) { firstLimit = i + 1; break; }
      accepted++;
    }
    check("ATTACK: initialize (session churn) is rate limited", firstLimit !== null && accepted <= RATE_LIMIT, `accepted ${accepted}, first 429 at ${firstLimit}`);
  });

  await withServer(10, async ({ rpost }) => {
    // ATTACK: a JSON-RPC batch. The unit of account is the message.
    const init = await rpost(initBody(200));
    const sid = init.headers.get("mcp-session-id");
    await init.text();
    const pings = (n, base) => Array.from({ length: n }, (_, i) => ({ jsonrpc: "2.0", id: base + i, method: "ping" }));
    const big = await rpost(pings(11, 300), { "mcp-session-id": sid });
    const bigBody = await big.json().catch(() => ({}));
    check("ATTACK: one batch of more messages than the budget is refused, and says why", big.status === 413 && /smaller batches/.test(bigBody?.error?.message ?? ""), `got ${big.status} ${JSON.stringify(bigBody).slice(0, 100)}`);
    const within = await rpost(pings(9, 350), { "mcp-session-id": sid });
    await within.text();
    check("...and an oversize batch is not charged against the budget (a legitimate batch of 9 still fits after the 1-unit initialize)", within.status !== 429 && within.status !== 413, `got ${within.status}`);
  });

  await withServer(10, async ({ rpost }) => {
    const init = await rpost(initBody(400));
    const sid = init.headers.get("mcp-session-id");
    await init.text();
    const pings = (n, base) => Array.from({ length: n }, (_, i) => ({ jsonrpc: "2.0", id: base + i, method: "ping" }));
    const first = await rpost(pings(5, 500), { "mcp-session-id": sid });
    await first.text();
    const second = await rpost(pings(5, 600), { "mcp-session-id": sid });
    await second.text();
    const third = await rpost(pings(1, 700), { "mcp-session-id": sid });
    check("batches are charged per message: 1 + 5 + 5 + 1 exceeds a budget of 10", first.status !== 429 && third.status === 429, `first ${first.status}, third ${third.status}`);
  });

  await withServer(3, async ({ rbase }) => {
    // ATTACK: probing with requests that never reach the session branch.
    let limited = false;
    for (let i = 0; i < 8; i++) {
      const r = await fetch(`${rbase}/mcp`, { method: "DELETE", headers: { ...auth, "mcp-session-id": "does-not-exist" } });
      await r.text();
      if (r.status === 429) { limited = true; break; }
    }
    check("ATTACK: DELETE/GET probes against unknown sessions are rate limited", limited);
  });

  // -- the idle sweeper ------------------------------------------------------
  // Idle timeout is 1s and the sweep runs every 250ms, so everything still
  // held must be reclaimed without any client action.
  await new Promise((r) => setTimeout(r, 2000));
  const afterSweep = await (await fetch(`${BASE}/healthz`)).json();
  check("the idle sweeper reclaims abandoned sessions", afterSweep.activeSessions === 0, `${afterSweep.activeSessions} still open`);
} catch (err) {
  console.error(`  FAIL  ${err.message}`);
  failures.push("harness");
} finally {
  proc.kill("SIGTERM");
}

if (failures.length > 0) {
  console.error(`\nHTTP smoke test: ${failures.length} failure(s).`);
  process.exit(1);
}
console.log("\nHTTP smoke test: all checks passed.");
process.exit(0);
