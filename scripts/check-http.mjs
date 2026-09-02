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
 *
 * Run: node scripts/check-http.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { formatStars, repoLink } from "../dist/web-theme.js";

const TOKEN = "smoke-test-token-not-a-secret-0123456789";
const PORT = 20000 + Math.floor(Math.random() * 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const MAX_SESSIONS = 5;
const RATE_LIMIT = 4;
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
    GSC_RATE_LIMIT_PER_MIN: String(RATE_LIMIT),
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
    check("tools/list over HTTP returns the full tool set", count === 33, `got ${count}`);

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
  check(
    "CSP permits the consent form to reach Google",
    /form-action[^;]*'self'/.test(csp) && csp.includes("https://accounts.google.com"),
    csp
  );

  const privacy = await fetch(`${BASE}/privacy`);
  const privacyBody = await privacy.text();
  check("GET /privacy serves the policy", privacy.ok, `got ${privacy.status}`);
  // Google's reviewer reads this page; these are the claims that must be there
  // AND must stay true of the code.
  check("the policy names the single scope requested", privacyBody.includes("webmasters.readonly"));
  check("the policy names the deletion control that exists", privacyBody.includes("disconnect_account"));
  check("the policy states data is not used for AI training", /train any machine-learning/i.test(privacyBody));
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
  check("an unknown star count still renders the link", unknown.includes(REPO));
  check("a known star count renders the counter", repoLink(REPO, 42).includes("gh-stars"));
  check(
    "star counts are abbreviated the way GitHub abbreviates them",
    formatStars(999) === "999" && formatStars(1200) === "1.2k" && formatStars(12500) === "13k",
    `${formatStars(999)} / ${formatStars(1200)} / ${formatStars(12500)}`
  );

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

  // -- rate limiting ---------------------------------------------------------
  if (held.length > 0) {
    const rlHeaders = { ...auth, "mcp-session-id": held[0] };
    let limited = null;
    for (let i = 0; i < RATE_LIMIT + 3; i++) {
      const r = await post({ jsonrpc: "2.0", id: 10 + i, method: "tools/list" }, rlHeaders);
      if (r.status === 429) { limited = { at: i + 1, retryAfter: r.headers.get("retry-after") }; break; }
    }
    check("the request rate limit engages", limited !== null, `no 429 within ${RATE_LIMIT + 3} requests`);
    check("the 429 carries Retry-After", Boolean(limited?.retryAfter), `got ${limited?.retryAfter}`);
  }

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
