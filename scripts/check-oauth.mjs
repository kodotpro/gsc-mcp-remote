#!/usr/bin/env node
/**
 * Credential-free test suite for OAuth mode.
 *
 * Part 1 drives the provider in-process against a temp database with a fake
 * Google identity: the full sandwich (park -> sign-in -> code -> tokens),
 * PKCE challenge storage, single-use codes, refresh rotation, rotated-token
 * reuse burning the client's sessions, RFC 8707 audience binding, the vault
 * round-trip, and the invalid_grant cascade.
 *
 * Part 2 boots the real HTTP server in oauth mode with dummy Google client
 * credentials (Google is never called) and checks what a connector UI needs:
 * discovery metadata, dynamic client registration, the /authorize redirect to
 * Google, 401 + WWW-Authenticate with resource metadata, and the trailing
 * slash on /mcp. No test-mode backdoors exist in the server.
 *
 * Run: node scripts/check-oauth.mjs   (skips on Node without node:sqlite)
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

try {
  await import("node:sqlite");
} catch {
  console.log(`SKIP: node:sqlite is unavailable on ${process.version}; OAuth mode needs Node 24+. Other modes are unaffected.`);
  process.exit(0);
}

const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
};
const expectThrow = async (label, fn, needle = "") => {
  try {
    await fn();
    check(label, false, "expected an error, got none");
  } catch (err) {
    const msg = err?.message ?? String(err);
    check(label, needle === "" || msg.includes(needle), `threw: ${msg}`);
  }
};

// ---------------------------------------------------------------------------
console.log("Part 1: provider, in process");
// ---------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-oauth-test-"));
const { openAuthDb } = await import("../dist/auth/db.js");
const { loadOrCreateVaultKey, vaultEncrypt, vaultDecrypt } = await import("../dist/auth/crypto.js");
const { GscOAuthProvider } = await import("../dist/auth/provider.js");

const db = openAuthDb(path.join(tmp, "test.db"));
const vaultKey = loadOrCreateVaultKey(path.join(tmp, "vault.key"));

check("vault round-trip", vaultDecrypt(vaultKey, vaultEncrypt(vaultKey, "secret-rt")) === "secret-rt");
check("vault key file is 0600", (fs.statSync(path.join(tmp, "vault.key")).mode & 0o777) === 0o600);

const fakeIdentity = {
  clientId: "fake-google-client",
  clientSecret: "fake-google-secret",
  authUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}&client_id=fake`,
  exchange: async (code) =>
    code === "good-google-code"
      ? { sub: "google-sub-1", email: "user@example.com", refreshToken: "google-rt-1", grantedScopes: "webmasters.readonly" }
      : (() => { throw new Error("bad google code"); })(),
  assertAllowed: () => {},
};

const RESOURCE = "https://gsc.example.com/mcp";
const provider = new GscOAuthProvider({ db, vaultKey, identity: fakeIdentity, resourceUrl: RESOURCE });

// DCR store
const client = {
  client_id: "client-abc",
  client_id_issued_at: Math.floor(Date.now() / 1000),
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  token_endpoint_auth_method: "none",
};
provider.clientsStore.registerClient(client);
check("clientsStore round-trip", provider.clientsStore.getClient("client-abc")?.redirect_uris[0] === client.redirect_uris[0]);

// PKCE pair the way a real client builds it
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

// A minimal express-like response recorder.
const mockRes = () => {
  const r = { html: "", redirected: "", headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.send = (body) => { r.html = body; };
  r.redirect = (url) => { r.redirected = url; };
  return r;
};

// authorize() must NOT go straight to Google: it renders a consent page that
// names the client and where the code would be delivered. This is the gate
// that stops an attacker-registered client from silently harvesting a code.
const res1 = mockRes();
await provider.authorize(client, {
  state: "client-state-xyz",
  codeChallenge: challenge,
  redirectUri: client.redirect_uris[0],
  scopes: [],
  resource: new URL(RESOURCE),
}, res1);
check("authorize does NOT redirect straight to Google", res1.redirected === "", res1.redirected);
check("authorize renders a consent page", res1.html.includes("Connect your Google Search Console"));
check("consent page names the requesting client", res1.html.includes("claude.ai") || res1.html.includes("Unnamed application"));
check("consent page requires a POST to continue", res1.html.includes('method="POST"') && res1.html.includes("/oauth/consent"));

const pid = (res1.html.match(/name="pending_id" value="([^"]+)"/) || [])[1];
check("consent page carries an unguessable pending id", Boolean(pid && pid.startsWith("pend_") && pid.length > 30));

// A client whose redirect target is not a Claude endpoint must be flagged.
const evil = { client_id: "client-evil", client_id_issued_at: 0, redirect_uris: ["https://attacker.example/steal"], token_endpoint_auth_method: "none", client_name: "Google Search Console (official)" };
provider.clientsStore.registerClient(evil);
const res2 = mockRes();
await provider.authorize(evil, { codeChallenge: challenge, redirectUri: evil.redirect_uris[0], scopes: [] }, res2);
check("untrusted redirect host is warned about", res2.html.includes("not a Claude address") && res2.html.includes("attacker.example"));
const evilPid = (res2.html.match(/name="pending_id" value="([^"]+)"/) || [])[1];
provider.denyPending(evilPid);
await expectThrow("denied request cannot be approved afterwards", () => Promise.resolve(provider.approvePending(evilPid)), "expired");

// Approving returns the Google URL and keeps the parked request alive.
const googleRedirect = provider.approvePending(pid);
check("approving sends the person to Google", googleRedirect.startsWith("https://accounts.google.com/"));
const state = new URL(googleRedirect).searchParams.get("state");
check("Google link carries the pending id as state", state === pid);

// Google callback completes the sandwich
const backToClient = await provider.completeGoogleSignIn(state, "good-google-code");
const back = new URL(backToClient);
check("callback returns to the client's redirect_uri", back.origin + back.pathname === client.redirect_uris[0]);
check("client's own state is echoed", back.searchParams.get("state") === "client-state-xyz");
const code = back.searchParams.get("code");
check("a one-time code is issued", Boolean(code && code.startsWith("mcp_code_")));

await expectThrow("state is single-use", () => provider.completeGoogleSignIn(state, "good-google-code"), "expired or was already used");

// The SDK's token handler does exactly this: fetch challenge, verify, exchange.
const storedChallenge = await provider.challengeForAuthorizationCode(client, code);
check("stored PKCE challenge matches", storedChallenge === challenge);
check("PKCE S256 verification would pass", createHash("sha256").update(verifier).digest("base64url") === storedChallenge);

const tokens = await provider.exchangeAuthorizationCode(client, code, verifier, client.redirect_uris[0], new URL(RESOURCE));
check("access token issued", tokens.access_token.startsWith("mcp_at_"));
check("refresh token issued", tokens.refresh_token.startsWith("mcp_rt_"));
check("scope granted", tokens.scope === "gsc:read");

await expectThrow("authorization code is single-use", () => provider.exchangeAuthorizationCode(client, code, verifier), "already used");

// verifyAccessToken → AuthInfo with the user id
const info = await provider.verifyAccessToken(tokens.access_token);
check("verifyAccessToken returns a userId", typeof info.extra?.userId === "string");
check("token bound to our resource", info.resource?.toString().replace(/\/$/, "") === RESOURCE);
await expectThrow("garbage token rejected", () => provider.verifyAccessToken("mcp_at_nonsense"), "invalid or expired");

// Audience binding: a token minted for another resource must not verify here.
const otherProvider = new GscOAuthProvider({ db, vaultKey, identity: fakeIdentity, resourceUrl: "https://other.example.com/mcp" });
await expectThrow("token for another resource is rejected", () => otherProvider.verifyAccessToken(tokens.access_token), "different resource");

// Refresh rotation, then reuse-detection burning the client's sessions.
const rotated = await provider.exchangeRefreshToken(client, tokens.refresh_token);
check("refresh rotates to a new pair", rotated.access_token !== tokens.access_token && rotated.refresh_token !== tokens.refresh_token);
await expectThrow("rotated-out refresh token is rejected", () => provider.exchangeRefreshToken(client, tokens.refresh_token), "revoked as a precaution");
await expectThrow("reuse burned the NEW refresh token too", () => provider.exchangeRefreshToken(client, rotated.refresh_token));
await expectThrow("reuse burned the new access token too", () => provider.verifyAccessToken(rotated.access_token));

// Sign in again, then test the invalid_grant cascade and per-user settings.
const res3 = mockRes();
await provider.authorize(client, { codeChallenge: challenge, redirectUri: client.redirect_uris[0], scopes: [] }, res3);
const pid2 = (res3.html.match(/name="pending_id" value="([^"]+)"/) || [])[1];
const state2 = new URL(provider.approvePending(pid2)).searchParams.get("state");
const code2 = new URL(await provider.completeGoogleSignIn(state2, "good-google-code")).searchParams.get("code");
const tokens2 = await provider.exchangeAuthorizationCode(client, code2, verifier);
const info2 = await provider.verifyAccessToken(tokens2.access_token);
const userId = info2.extra.userId;

check("google refresh token retrievable from vault", provider.getGoogleRefreshToken(userId) === "google-rt-1");
provider.setDefaultProperty(userId, "sc-domain:example.com");
check("per-user default property persists", provider.getDefaultProperty(userId) === "sc-domain:example.com");

provider.markGoogleRevoked(userId);
await expectThrow("cascade: MCP access token dies with the Google grant", () => provider.verifyAccessToken(tokens2.access_token));
await expectThrow("cascade: refresh token dies too", () => provider.exchangeRefreshToken(client, tokens2.refresh_token));
await expectThrow("cascade: vault refuses a revoked connection", () => Promise.resolve(provider.getGoogleRefreshToken(userId)), "reconnect");

// ---------------------------------------------------------------------------
console.log("\nData deletion and export (the promises the privacy policy makes)");
// ---------------------------------------------------------------------------
// The README, the privacy page and the Google verification documents all state
// that disconnecting erases the stored credential. These checks are what make
// that a fact rather than a claim — and a false claim here is a false
// statement to a reviewer, not just a bug.

// A revoked grant must not leave the encrypted credential lying around: it has
// no remaining purpose and real value to whoever steals the database.
const revokedRow = db.prepare("SELECT refresh_token_enc, status FROM google_tokens WHERE user_id = ?").get(userId);
check("a revoked grant erases the stored ciphertext", revokedRow?.refresh_token_enc === "", JSON.stringify(revokedRow));

// Fresh sign-in so there is a complete record to export and then delete.
const res4 = mockRes();
await provider.authorize(client, { codeChallenge: challenge, redirectUri: client.redirect_uris[0], scopes: [] }, res4);
const pid3 = (res4.html.match(/name="pending_id" value="([^"]+)"/) || [])[1];
const state3 = new URL(provider.approvePending(pid3)).searchParams.get("state");
const code3 = new URL(await provider.completeGoogleSignIn(state3, "good-google-code")).searchParams.get("code");
const tokens3 = await provider.exchangeAuthorizationCode(client, code3, verifier);
const info3 = await provider.verifyAccessToken(tokens3.access_token);
const uid3 = info3.extra.userId;
provider.setDefaultProperty(uid3, "sc-domain:export.example.com");

const exported = provider.exportUser(uid3);
check("export returns the user's identity", exported?.identity?.email === "user@example.com", JSON.stringify(exported?.identity));
check("export reports the Google connection status", exported?.google_connection?.status === "active");
check("export includes saved settings", exported?.settings?.default_property === "sc-domain:export.example.com");
check("export counts active tokens", exported?.active_access_tokens >= 1, String(exported?.active_access_tokens));
// The one thing an export must never hand back is the credential the vault
// exists to protect.
const exportedJson = JSON.stringify(exported);
check("export never leaks the stored credential", !exportedJson.includes("refresh_token_enc") && !exportedJson.includes("google-rt-1"), exportedJson);

const { deleted } = provider.disconnectUser(uid3);
check("disconnect reports what it removed", deleted.google_credentials >= 1 && deleted.identity === 1, JSON.stringify(deleted));

// Nothing may survive in ANY table.
const leftovers = [];
for (const [table, column] of [
  ["users", "id"], ["google_tokens", "user_id"], ["access_tokens", "user_id"],
  ["refresh_tokens", "user_id"], ["user_settings", "user_id"], ["auth_codes", "user_id"],
]) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(uid3);
  if (row.n > 0) leftovers.push(`${table}=${row.n}`);
}
check("disconnect leaves no row in any table", leftovers.length === 0, leftovers.join(", "));
await expectThrow("a disconnected user's token stops working", () => provider.verifyAccessToken(tokens3.access_token));
check("export after disconnect returns nothing", provider.exportUser(uid3) === null);

// ---------------------------------------------------------------------------
console.log("\nPart 2: HTTP server in oauth mode (Google never called)");
// ---------------------------------------------------------------------------

const PORT = 21000 + Math.floor(Math.random() * 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const proc = spawn("node", ["dist/index.js", "http"], {
  env: {
    ...process.env,
    GSC_HTTP_AUTH: "oauth",
    GSC_PUBLIC_URL: BASE,
    GSC_HTTP_PORT: String(PORT),
    GSC_HTTP_HOST: "127.0.0.1",
    GSC_GOOGLE_CLIENT_ID: "dummy-client-id",
    GSC_GOOGLE_CLIENT_SECRET: "dummy-client-secret",
    GSC_OAUTH_DB_FILE: path.join(tmp, "http.db"),
    GSC_VAULT_KEY_FILE: path.join(tmp, "http-vault.key"),
    HOME: tmp,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
proc.stderr.on("data", (c) => (stderr += c.toString()));

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    if (proc.exitCode !== null) throw new Error(`server exited early (code ${proc.exitCode}):\n${stderr}`);
    up = await fetch(`${BASE}/healthz`).then((r) => r.ok).catch(() => false);
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) throw new Error(`server did not become healthy:\n${stderr}`);

  const health = await (await fetch(`${BASE}/healthz`)).json();
  check("healthz reports oauth mode", health.auth === "oauth", JSON.stringify(health));

  const asMeta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  const norm = (u) => String(u ?? "").replace(/\/+$/, "");
  check("AS metadata served", norm(asMeta.issuer) === BASE && Boolean(asMeta.authorization_endpoint && asMeta.token_endpoint), `issuer ${asMeta.issuer}`);
  check("AS metadata offers DCR", Boolean(asMeta.registration_endpoint));
  check("AS metadata requires PKCE S256", (asMeta.code_challenge_methods_supported ?? []).includes("S256"));

  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
  check("protected-resource metadata served", prm.resource === `${BASE}/mcp`, JSON.stringify(prm));
  check("PRM names the authorization server", (prm.authorization_servers ?? []).includes(BASE) || (prm.authorization_servers ?? []).includes(`${BASE}/`));

  const reg = await fetch(asMeta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:41419/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  const regBody = await reg.json();
  check("dynamic client registration works", reg.status === 201 || reg.status === 200, JSON.stringify(regBody).slice(0, 200));
  check("DCR returns a client_id", Boolean(regBody.client_id));

  const authorizeUrl = `${asMeta.authorization_endpoint}?response_type=code&client_id=${encodeURIComponent(regBody.client_id)}&redirect_uri=${encodeURIComponent("http://127.0.0.1:41419/callback")}&code_challenge=${challenge}&code_challenge_method=S256&state=cs`;
  const authz = await fetch(authorizeUrl, { redirect: "manual" });
  const authzBody = await authz.text();
  check("/authorize shows a consent page rather than redirecting", authz.status === 200 && authzBody.includes("Connect your Google Search Console"), `status ${authz.status}`);
  // This client registered a loopback redirect, which only the person's own
  // machine can receive — so it is trusted and must NOT be warned about.
  check("loopback redirect is not warned about", !authzBody.includes("not a Claude address"));

  // The consent page's whole purpose is to make one fact refusable: which
  // client receives the result. Framing it would defeat that, so the page
  // that most needs the anti-framing headers is pinned here, not just the
  // public pages covered by check-http.
  check(
    "the consent page refuses to be framed",
    authz.headers.get("x-frame-options") === "DENY",
    `got ${authz.headers.get("x-frame-options")}`
  );
  const consentCsp = authz.headers.get("content-security-policy") ?? "";
  check(
    "the consent page's CSP blocks framing and scripts",
    consentCsp.includes("frame-ancestors 'none'") && consentCsp.includes("default-src 'none'"),
    consentCsp
  );
  check(
    "the consent page can still submit its own form",
    /form-action[^;]*'self'/.test(consentCsp),
    consentCsp
  );

  // The invariant that actually matters, and the one whose absence shipped a
  // dead "Continue to Google" button: whatever host the consent POST redirects
  // to must be permitted by the same page's form-action. Checked against the
  // real Location header rather than a hardcoded hostname, so it keeps holding
  // if the Google endpoint ever moves.
  const pendingId = (authzBody.match(/name="pending_id" value="([^"]+)"/) || [])[1];
  check("the consent page carries a usable pending id", Boolean(pendingId));
  if (pendingId) {
    const submitted = await fetch(`${BASE}/oauth/consent`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ pending_id: pendingId, decision: "allow" }).toString(),
    });
    check("approving consent redirects onward", submitted.status === 302, `got ${submitted.status}`);
    const location = submitted.headers.get("location") ?? "";
    check("consent redirects to Google's sign-in", location.startsWith("https://accounts.google.com/"), location.slice(0, 80));

    let allowed = false;
    try {
      const target = new URL(location);
      const directive = (consentCsp.split(";").find((d) => d.trim().startsWith("form-action")) ?? "");
      allowed = directive.includes(target.origin);
    } catch { /* leave false */ }
    check(
      "the consent page's form-action allows the host it redirects to",
      allowed,
      `form-action does not list ${location.slice(0, 40)}… — the browser will abort the submission silently`
    );
  }
  check("the consent page is not cached", (authz.headers.get("cache-control") ?? "").includes("no-store"));

  // Now the attacker shape: an off-host https redirect must be flagged.
  const evilReg = await fetch(asMeta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Google Search Console (official)", redirect_uris: ["https://attacker.example/steal"], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }),
  });
  const evilBody = await evilReg.json();
  const evilAuthz = await fetch(
    `${asMeta.authorization_endpoint}?response_type=code&client_id=${encodeURIComponent(evilBody.client_id)}&redirect_uri=${encodeURIComponent("https://attacker.example/steal")}&code_challenge=${challenge}&code_challenge_method=S256&state=cs`,
    { redirect: "manual" }
  );
  const evilHtml = await evilAuthz.text();
  check("off-host redirect is warned about on the consent page", evilHtml.includes("not a Claude address") && evilHtml.includes("attacker.example"), `status ${evilAuthz.status}`);
  check("the attacker's client name is shown, not trusted branding", evilHtml.includes("Google Search Console (official)"));

  // Cancelling must discard the parked request.
  const pendId = (authzBody.match(/name="pending_id" value="([^"]+)"/) || [])[1];
  const denied = await fetch(`${BASE}/oauth/consent`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: pendId ?? "", decision: "deny" }).toString(),
    redirect: "manual",
  });
  check("cancelling on the consent page is honoured", denied.status === 200 && (await denied.text()).includes("Request cancelled"), `status ${denied.status}`);

  const reuseDenied = await fetch(`${BASE}/oauth/consent`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: pendId ?? "", decision: "allow" }).toString(),
    redirect: "manual",
  });
  check("a cancelled request cannot then be approved", reuseDenied.status === 400, `got ${reuseDenied.status}`);

  const noTok = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  check("POST /mcp without a token is 401", noTok.status === 401, `got ${noTok.status}`);
  const www = noTok.headers.get("www-authenticate") ?? "";
  check("401 advertises resource metadata for discovery", www.includes("resource_metadata=") && www.includes("/.well-known/oauth-protected-resource/mcp"), www);

  const slash = await fetch(`${BASE}/mcp/`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  check("trailing slash /mcp/ behaves the same (401, not 404)", slash.status === 401, `got ${slash.status}`);

  const garbage = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer mcp_at_garbage" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  check("POST /mcp with a garbage token is 401", garbage.status === 401, `got ${garbage.status}`);

  // ---- multi-user behaviour, tested by seeding the server's own database ----
  // No backdoor: these inserts are byte-for-byte what the provider writes when
  // two people complete sign-in; the server process reads the same SQLite file.
  const { DatabaseSync } = await import("node:sqlite");
  const { createHash: ch } = await import("node:crypto");
  const sha = (v) => ch("sha256").update(v).digest("hex");
  const now = Date.now();
  const seedDb = new DatabaseSync(path.join(tmp, "http.db"));
  const mkUser = (id, sub, email, token) => {
    seedDb.prepare("INSERT INTO users (id, google_sub, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(id, sub, email, now, now);
    seedDb.prepare("INSERT INTO access_tokens (token_hash, user_id, client_id, scopes, resource, expires_at, created_at) VALUES (?, ?, 'seed-client', 'gsc:read', NULL, ?, ?)").run(sha(token), id, now + 3600_000, now);
  };
  const TOKEN_A = "mcp_at_test_user_a_" + randomBytes(8).toString("hex");
  const TOKEN_B = "mcp_at_test_user_b_" + randomBytes(8).toString("hex");
  mkUser("user-a", "sub-a", "a@example.com", TOKEN_A);
  mkUser("user-b", "sub-b", "b@example.com", TOKEN_B);
  seedDb.close();

  const rpc = (token, sessionId, body) =>
    fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(body),
    });

  const initA = await rpc(TOKEN_A, null, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  check("user A can initialize with a database-backed token", initA.status === 200, `got ${initA.status}`);
  const sidA = initA.headers.get("mcp-session-id");
  await rpc(TOKEN_A, sidA, { jsonrpc: "2.0", method: "notifications/initialized" });

  const listA = await (await rpc(TOKEN_A, sidA, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  check("user A sees the full tool set", listA?.result?.tools?.length === 33, `got ${listA?.result?.tools?.length}`);

  // Invariant #1: a session opened by A must reject B's valid token.
  const crossed = await rpc(TOKEN_B, sidA, { jsonrpc: "2.0", id: 3, method: "tools/list" });
  check("user B is rejected on user A's session (403)", crossed.status === 403, `got ${crossed.status}`);

  // ALS context reaches tool handlers: with no default set, the error text is
  // the remote-mode one that mentions set_default_property.
  const noDefault = await (await rpc(TOKEN_A, sidA, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "quick_wins", arguments: {} } })).json();
  const noDefaultText = noDefault?.result?.content?.[0]?.text ?? "";
  check("per-user context reaches tools (remote error text)", noDefaultText.includes("set_default_property"), noDefaultText.slice(0, 140));

  const setDef = await (await rpc(TOKEN_A, sidA, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "set_default_property", arguments: { site_url: "sc-domain:seeded.example" } } })).json();
  check("set_default_property saves for the user", (setDef?.result?.content?.[0]?.text ?? "").includes("sc-domain:seeded.example"));

  // Now the property resolves, and the next stop is the (absent) Google
  // connection — which must fail with the clear reconnect message, not a crash.
  const noGoogle = await (await rpc(TOKEN_A, sidA, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "quick_wins", arguments: {} } })).json();
  const noGoogleText = noGoogle?.result?.content?.[0]?.text ?? JSON.stringify(noGoogle).slice(0, 140);
  check("missing Google connection fails with reconnect guidance", noGoogleText.includes("reconnect") || noGoogleText.includes("No active Google connection"), noGoogleText.slice(0, 140));
} catch (err) {
  console.error(`  FAIL  ${err.message}`);
  failures.push("http harness");
} finally {
  proc.kill("SIGTERM");
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nOAuth test suite: ${failures.length} failure(s).`);
  process.exit(1);
}
console.log("\nOAuth test suite: all checks passed.");
process.exit(0);
