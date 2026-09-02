#!/usr/bin/env node
/**
 * Run the real per-user sign-in flow on this machine, before deploying it.
 *
 * Unlike scripts/check-oauth.mjs — which fakes Google so it can run in CI —
 * this boots the server with YOUR Google client and lets you complete an
 * actual sign-in from an actual Claude client. It is the rehearsal: if the
 * flow works here, the only things that can still differ on the server are
 * TLS, DNS and the reverse proxy.
 *
 * It works because Google makes an exception to its HTTPS-only redirect rule
 * for `http://localhost`, so a Web-application client can carry a loopback
 * callback alongside the production one.
 *
 * Everything it writes goes in a temp directory that is deleted on exit, so
 * this never touches your deployed database, your vault key, or ~/.gsc-mcp.
 *
 * Run: node scripts/try-oauth-local.mjs
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PORT = Number(process.env.PORT ?? 8787);
const BASE = `http://localhost:${PORT}`;

const bold = (s) => `[1m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;
const green = (s) => `[32m${s}[0m`;
const red = (s) => `[31m${s}[0m`;
const yellow = (s) => `[33m${s}[0m`;

function die(message, hint) {
  console.error(`\n${red("Cannot start.")} ${message}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

// ---- prerequisites --------------------------------------------------------

try {
  await import("node:sqlite");
} catch {
  die(
    `OAuth mode stores users in SQLite via node:sqlite, which ${process.version} does not provide.`,
    "Use Node 24 or newer for this test. Local stdio mode and bearer HTTP mode are unaffected."
  );
}

if (!fs.existsSync("dist/index.js")) {
  die("dist/index.js is missing.", "Run:  npm run build");
}

const clientId = process.env.GSC_GOOGLE_CLIENT_ID ?? process.env.GSC_OAUTH_CLIENT_ID;
const clientSecret = process.env.GSC_GOOGLE_CLIENT_SECRET ?? process.env.GSC_OAUTH_CLIENT_SECRET;
const secretsFile = process.env.GSC_OAUTH_SECRETS_FILE;

if (!(clientId && clientSecret) && !(secretsFile && fs.existsSync(secretsFile))) {
  die(
    "No Google OAuth client credentials found.",
    `Create a ${bold("Web application")} OAuth client in Google Cloud Console with this exact
authorised redirect URI:

    ${bold(`${BASE}/oauth/google/callback`)}

Then run this script with the credentials in the environment:

    GSC_GOOGLE_CLIENT_ID=... GSC_GOOGLE_CLIENT_SECRET=... node scripts/try-oauth-local.mjs

You can add the loopback URI to the SAME client that serves production — a
client may hold several redirect URIs, and Google permits http for localhost.

${bold("Also required:")} while the consent screen is in Testing status, the Google
account you sign in with must be listed as a ${bold("test user")} on it. Without
that, Google returns access_denied before this server's consent page is
ever reached, and the failure looks like a bug in the flow rather than a
missing entry in a list.`
  );
}

// ---- isolated state -------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-oauth-local-"));
const cleanup = () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
};

console.log(`\n${bold("Local per-user sign-in test")}`);
console.log(dim(`state in ${tmp} (deleted on exit)`));

const child = spawn("node", ["dist/index.js", "http"], {
  env: {
    ...process.env,
    GSC_HTTP_AUTH: "oauth",
    GSC_PUBLIC_URL: BASE,
    GSC_HTTP_PORT: String(PORT),
    GSC_HTTP_HOST: "127.0.0.1",
    GSC_OAUTH_DB_FILE: path.join(tmp, "oauth-server.db"),
    GSC_VAULT_KEY_FILE: path.join(tmp, "vault.key"),
    HOME: tmp,
    GSC_CONTACT_EMAIL: process.env.GSC_CONTACT_EMAIL ?? "you@example.com",
  },
  stdio: ["ignore", "inherit", "inherit"],
});

const shutdown = () => {
  child.kill("SIGTERM");
  setTimeout(() => {
    child.kill("SIGKILL");
    cleanup();
    process.exit(0);
  }, 700);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code) => {
  cleanup();
  if (code) process.exit(code);
});

// ---- wait, then verify the flow is actually discoverable ------------------

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  if (child.exitCode !== null) {
    cleanup();
    process.exit(child.exitCode ?? 1);
  }
  up = await fetch(`${BASE}/healthz`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!up) await new Promise((r) => setTimeout(r, 250));
}
if (!up) die(`The server did not come up on ${BASE}. Is port ${PORT} already in use?`);

const problems = [];
const asMeta = await fetch(`${BASE}/.well-known/oauth-authorization-server`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const prMeta = await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

if (!asMeta?.registration_endpoint) problems.push("authorization-server metadata is missing its registration endpoint");
if (!asMeta?.code_challenge_methods_supported?.includes("S256")) problems.push("PKCE S256 is not advertised");
if (prMeta?.resource !== `${BASE}/mcp`) problems.push(`protected-resource metadata names ${prMeta?.resource}, expected ${BASE}/mcp`);

const unauth = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
});
if (unauth.status !== 401) problems.push(`an unauthenticated request returned ${unauth.status}, expected 401`);
if (!unauth.headers.get("www-authenticate")?.includes("resource_metadata")) {
  problems.push("the 401 does not point clients at the resource metadata, so discovery will not start");
}

console.log("");
if (problems.length) {
  console.log(`${red("Discovery looks wrong:")}`);
  for (const p of problems) console.log(`  - ${p}`);
  console.log("");
} else {
  console.log(`${green("✓")} Discovery, PKCE and the 401 challenge all look right.`);
}

console.log(`
${bold("Now connect a client.")} In another terminal:

    ${bold(`claude mcp add --transport http gsc-local ${BASE}/mcp`)}

Claude Code discovers OAuth from the URL, opens a browser, and you will see —
in this order:

  1. ${bold("This server's own consent page")}, naming the client asking and where the
     result would be sent. That page is the fix for the account-takeover path
     found in the audit; it should say the redirect is a recognised Claude
     address, with no red warning.
  2. ${bold("Google's sign-in and consent screen")}, asking only for read-only Search
     Console access plus your email. If you get ${bold("access_denied")} here, the
     account is not a listed test user on the consent screen — add it in
     Google Cloud Console; nothing is wrong with the server.
  3. Back to the client, connected.

Then ask it: ${bold('"list my Search Console properties"')} — and try a real question,
e.g. ${bold('"quick wins for the second property"')}. Also worth exercising here, since
these are what a hosted deployment promises:

    ${bold("export_my_data")}        — everything the server stores about you
    ${bold("set_default_property")}  — a per-user default
    ${bold("disconnect_account")}    — erases it all and ends your sessions

Pages a Google reviewer will open (worth reading once yourself):

    ${BASE}/            ${dim("service description")}
    ${BASE}/privacy     ${dim("privacy policy")}

${yellow("When you are done:")} remove the local connector so it cannot shadow the real one:

    ${bold("claude mcp remove gsc-local")}

${dim("Ctrl-C here stops the server and deletes all local test state.")}
`);
