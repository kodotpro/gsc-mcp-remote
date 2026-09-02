# Google Search Console MCP Server

**A Google Search Console MCP server that answers SEO questions instead of returning API rows — across every property in your account, from your own machine or as a remote MCP server your whole team connects to.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](#requirements)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP%20%2B%20stdio-orange.svg)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Ask Claude *"which pages lost the most traffic last month, and why?"* and get a diagnosis — a ranking loss, a CTR collapse, or a demand decline — not a spreadsheet you still have to read.

> **A fork with credit due.** The 29-tool foundation and the analysis logic behind it are [Suganthan Mohanadasan's](https://suganthan.com) work, from [Suganthan's GSC MCP](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP). This fork adds multi-property access and remote hosting on top. See [Credits](#credits).

---

## Contents

- [Why this one](#why-this-one)
- [What you can ask](#what-you-can-ask)
- [Install](#install) — [remote](#option-a--connect-to-a-remote-server-easiest) · [local](#option-b--run-it-locally-stdio) · [self-host](#option-c--host-your-own-remote-server)
- [All 33 tools](#all-33-tools)
- [Configuration](#configuration)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Credits](#credits)
- [Changelog](#changelog)

---

## Why this one

There are several Google Search Console MCP servers, and a growing number of SEO MCP servers generally. Two things make this one different.

**It covers your whole account, not one property.** Every property-scoped tool takes a `site_url` argument, and `list_properties` discovers what your credential can actually see. One install answers questions about all your sites — you never edit a config file and restart to look at a different one. (This is what upstream [issue #9](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP/issues/9) asked for.)

**It runs as a remote MCP server, with per-user Google sign-in.** Most MCP servers are local-only: one process, on one laptop, with one credential. This one also runs as a hosted service over Streamable HTTP. Add it as an MCP connector by URL, sign in with your own Google account, and Google's own Search Console permissions decide what you see. Ten people can share one deployment and each see only their own properties — nobody copies a credential anywhere.

It is a full [MCP OAuth](https://modelcontextprotocol.io/specification) authorization server: dynamic client registration, PKCE, rotating tokens, and a consent screen of its own. That is what lets the claude.ai and Claude Desktop connector UIs onboard it from nothing but a URL.

**Also:** it returns SEO analysis rather than rows, every answer states which property it came from, and it exposes Google's `type=image` surface that most third-party tools skip entirely.

It is built for the people who live in Search Console — in-house SEOs, consultants, and agencies running many client properties from one place.

---

## What you can ask

> "What keywords am I almost ranking for?"
>
> "Which pages lost the most traffic in the last month, and why?"
>
> "Do I have any pages cannibalising each other?"
>
> "Compare quick wins across all my properties."
>
> "Which pages get image impressions but no clicks?"
>
> "Is this URL indexed, and if not, why not?"
>
> "Check that 40% CTR figure before I put it in the deck."

Answers carry `_meta` provenance naming the source, the exact parameters, and the property used — so an answer is never ambiguous about which site it describes. `position` is labelled as the impression-weighted average it actually is, not a rank-tracker position.

---

## Install

Three ways in, depending on whether you want to run anything yourself.

| | [A — Remote](#option-a--connect-to-a-remote-server-easiest) | [B — Local](#option-b--run-it-locally-stdio) | [C — Self-hosted remote](#option-c--host-your-own-remote-server) |
|---|---|---|---|
| **Setup** | Paste a URL, sign in with Google | Clone, build, add a Google client | Clone onto a server, deploy |
| **Runs where** | Someone else's server | Your machine | Your server |
| **Google credentials** | Yours, held server-side encrypted | Yours, on your own disk | Each user's, encrypted |
| **Good for** | Trying it; teams | Solo use; full control; write tools | Running it for others |
| **Works with** | claude.ai, Desktop, Claude Code | Any MCP client | claude.ai, Desktop, Claude Code |

### Requirements

- **Node 18+** for local (stdio) and shared-token remote mode.
- **Node 24+** for per-user OAuth mode — it stores users in SQLite via `node:sqlite`. The Docker image already is.
- A Google account with access to at least one Search Console property.

---

### Option A — Connect to a remote server (easiest)

If someone has already deployed this and given you a URL, there is nothing to install.

**claude.ai / Claude Desktop:** Settings → Connectors → **Add custom connector** → paste the URL:

```
https://gsc.example.com/mcp
```

**Claude Code:**

```bash
claude mcp add --transport http gsc https://gsc.example.com/mcp
```

Either way your browser opens, you approve the connection on the server's consent page, sign in with Google, and you are done. No token to paste, no config file to edit. Then ask: *"list my Search Console properties"*.

You can revoke access at any time — ask for `disconnect_account`, or remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

### Option B — Run it locally (stdio)

The server runs on your machine and talks to Claude over stdio. This is the mode that supports the write tools (sitemap submission and the Indexing API).

**1. Clone and build.** Not published to npm yet, so install from source:

```bash
git clone https://github.com/kodotpro/gsc-mcp-remote.git && cd gsc-mcp-remote
```

```bash
npm ci && npm run build
```

**2. Get a Google OAuth client.** In [Google Cloud Console](https://console.cloud.google.com): enable the **Google Search Console API**, then **Credentials → Create credentials → OAuth client ID → Desktop app**, and download the JSON.

**3. Run the guided setup.** It signs you in, verifies the connection with a live API call, and writes your Claude config for you:

```bash
node dist/index.js setup
```

<details>
<summary><strong>Or configure it by hand</strong></summary>

In Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gsc": {
      "command": "node",
      "args": ["/absolute/path/to/gsc-mcp-remote/dist/index.js"],
      "env": {
        "GSC_AUTH_MODE": "oauth",
        "GSC_OAUTH_SECRETS_FILE": "/absolute/path/to/client_secret.json",
        "GSC_SCOPES": "readonly",
        "GSC_SITE_URL": "sc-domain:example.com"
      }
    }
  }
}
```

`GSC_SITE_URL` is optional — it only sets a default property for calls that do not name one. On first use a browser opens for Google sign-in; the token is cached in `~/.gsc-mcp/` and refreshed automatically after that.

</details>

<details>
<summary><strong>Or use a service account</strong></summary>

Add the service account's email as a user on each property in Search Console, then:

```json
"env": {
  "GSC_AUTH_MODE": "service_account",
  "GSC_KEY_FILE": "/absolute/path/to/service-account.json"
}
```

</details>

**Access level.** `GSC_SCOPES=readonly` (recommended) requests a single read-only Google permission. `full` adds sitemap submission and the Indexing API; the write tools explain how to upgrade if you call them without it.

---

### Option C — Host your own remote server

Run it as a service so other people — or your other machines — can use it without installing anything.

Pick an auth mode first:

| | `GSC_HTTP_AUTH=oauth` — per-user sign-in | `GSC_HTTP_AUTH=bearer` — shared secret (default) |
|---|---|---|
| Who connects | Anyone you allow, with **their own Google account** | Whoever holds the one token |
| What they see | **Their** properties; Google's permissions apply per person | Everything the server's single credential sees |
| claude.ai / Desktop connector UI | **Yes** — add by URL, OAuth is discovered | No (those UIs have no header field) |
| Claude Code | Yes, walks the OAuth flow | Yes, with `--header "Authorization: Bearer …"` |
| Runtime | Node 24+ | Node 18+ |

Bearer is the default so an existing deployment keeps working across an upgrade. OAuth mode is switched on explicitly, and forces the read-only Google scope.

#### Try it locally before deploying

Worth doing — it separates transport problems from deployment problems.

```bash
openssl rand -hex 32
```

```bash
GSC_HTTP_TOKEN=<paste> GSC_AUTH_MODE=oauth GSC_SCOPES=readonly GSC_OAUTH_SECRETS_FILE=/path/to/client_secret.json node dist/index.js http
```

```bash
curl -s http://127.0.0.1:8787/healthz
```

```bash
claude mcp add --transport http gsc-local http://127.0.0.1:8787/mcp --header "Authorization: Bearer <paste>"
```

To rehearse the **per-user OAuth flow** with a real Google sign-in before it is public, see [Rehearse the real sign-in locally](#rehearse-the-real-sign-in-locally).

#### Deploy with Docker

Written against a VPS running CloudPanel, the reference deployment; any Docker host with a reverse proxy works the same way, and only the proxy step differs.

**1. DNS.** Point an `A` record at the server. On Cloudflare, set it to **DNS-only (grey cloud)** — the proxy adds buffering and a 100-second hard timeout you do not want in front of a streaming protocol, and it complicates certificate issuance.

**2. Get the code on the box:**

```bash
git clone https://github.com/kodotpro/gsc-mcp-remote.git /opt/gsc-mcp && cd /opt/gsc-mcp
```

**3. Configure:**

```bash
cp .env.example .env && openssl rand -hex 32
```

Set at minimum `GSC_HTTP_TOKEN` (bearer mode) and `GSC_HTTP_ALLOWED_HOSTS` to your public hostname. The container runs as uid 1000, so give it the volume:

```bash
mkdir -p data secrets && chown -R 1000:1000 data
```

**4. Google credentials.** A headless server cannot complete an interactive OAuth flow — that needs a browser on the same machine. In bearer mode, mint the token somewhere with a browser and copy it up:

```bash
scp ~/.gsc-mcp/oauth-token.json root@YOUR_SERVER:/opt/gsc-mcp/data/.gsc-mcp/oauth-token.json
```

```bash
scp /path/to/client_secret.json root@YOUR_SERVER:/opt/gsc-mcp/secrets/client_secret.json
```

Prefer a `readonly` token for a hosted deployment. A service account is the alternative (`GSC_AUTH_MODE=service_account`, `GSC_KEY_FILE=/secrets/service-account.json`). **In OAuth mode none of this applies** — each user signs in for themselves.

**5. Start it.** The container publishes to loopback only; the reverse proxy is the only thing that reaches it.

```bash
docker compose up -d --build && curl -s http://127.0.0.1:8787/healthz
```

**6. Reverse proxy.** In CloudPanel: **Sites → Add Site → Create a Reverse Proxy**, destination `http://127.0.0.1:8787`, then **Manage Site → SSL/TLS → New Let's Encrypt Certificate**. Do **not** install Caddy or another proxy alongside CloudPanel — its nginx already owns ports 80 and 443.

Make sure the proxy does not buffer:

```nginx
proxy_buffering off;
proxy_read_timeout 300s;
proxy_set_header Host $host;
```

**7. Verify from outside:**

```bash
curl -s https://gsc.example.com/healthz
```

#### Turn on per-user Google sign-in

This is what makes the server usable by anyone with a Google account.

1. **OAuth consent screen:** External. While it is in **Testing** status only accounts you list as **test users** can sign in — that is your beta gate (100 users max, and refresh tokens expire weekly until the app is verified).
2. **Credentials → Create credentials → OAuth client ID → Web application**, with exactly this authorised redirect URI:
   ```
   https://gsc.example.com/oauth/google/callback
   ```
3. In `.env`: `GSC_HTTP_AUTH=oauth`, `GSC_PUBLIC_URL=https://gsc.example.com`, `GSC_GOOGLE_CLIENT_ID`, `GSC_GOOGLE_CLIENT_SECRET`, and `GSC_CONTACT_EMAIL`.
4. `docker compose up -d --build`

Optional extra gates: `GSC_ALLOWED_EMAILS`, `GSC_ALLOWED_EMAIL_DOMAINS`.

Going fully public also needs Google's verification for the sensitive Search Console scope. The server already serves the two pages that requires — a home page at `/` and a privacy policy at `/privacy` — and [`docs/verification/`](docs/verification/) has the runbook, scope justifications and demo-video script.

#### Backups

In OAuth mode the SQLite database is small but not reproducible: who has connected, and their encrypted Google refresh tokens. Losing it loses nobody's Search Console data — none is stored — but it signs every user out at once. An opt-in Litestream sidecar replicates it continuously:

```bash
docker compose --profile backup up -d
```

To restore, stop the app and move the current database aside first (Litestream refuses to write over an existing file, and `--no-deps` is what stops Compose starting the app and creating an empty one):

```bash
docker compose stop gsc-mcp
```

```bash
mv data/.gsc-mcp/oauth-server.db data/.gsc-mcp/oauth-server.db.old; rm -f data/.gsc-mcp/oauth-server.db-wal data/.gsc-mcp/oauth-server.db-shm
```

```bash
docker compose --profile backup run --rm --no-deps --entrypoint litestream litestream restore -config /etc/litestream.yml /data/.gsc-mcp/oauth-server.db
```

```bash
docker compose up -d
```

**The vault key is deliberately not replicated.** Those refresh tokens are encrypted with the key at `data/.gsc-mcp/vault.key`; shipping it to the same bucket as the ciphertext would put the lock and the key in one place. Copy its 64 hex characters into a password manager instead. Keep it and a restore is complete; lose it and the restore still works — the stored Google connections are simply dead, and each user reconnects once.

#### Operating it

```bash
docker compose logs -f --tail 50
```

```bash
git pull && docker compose up -d --build
```

Logs record session open/close and token refreshes, never tokens or query data. `/healthz` reports liveness, the active session count and the limits actually in force. Sessions idle for 30 minutes close automatically.

Memory is capped at 512 MB with Node's heap at 384 MB, deliberately: Search Analytics results accumulate in memory, and the cap stops this service starving its neighbours. Four limits stop one caller taking the process down, since each session holds its own tool registry (~440 KB):

| Limit | Default | Variable | Applies in |
|---|---|---|---|
| Concurrent sessions, server-wide | 120 | `GSC_MAX_SESSIONS` | both modes |
| Concurrent sessions per user | 8 | `GSC_MAX_SESSIONS_PER_USER` | `oauth` only |
| Requests per user per minute | 60 | `GSC_RATE_LIMIT_PER_MIN` | both modes |
| Rows accumulated per query | 100,000 | `GSC_MAX_TOTAL_ROWS` | both modes |
| Deadline per Google API call | 60 s | `GSC_GOOGLE_TIMEOUT_MS` | both modes |

Exceeding them returns `429`, or `503` at the server-wide ceiling, with `Retry-After` — rather than an OOM. A query that hits the row ceiling says so in its response instead of quietly reporting partial data. The per-user ceiling needs a per-request identity, so it only means anything in `oauth` mode; bearer mode has one tenant and is bounded by `GSC_MAX_SESSIONS` alone.

#### What remote mode changes

Two tools behave differently when the server is not on your own machine:

- **`generate_report`** returns markdown inline instead of writing a file, because a file would land on the server's disk where you could not retrieve it. When it does write, paths are confined to `GSC_REPORT_DIR`.
- **`image_page_audit`** refuses URLs resolving to private, loopback, link-local or reserved addresses — including the IPv4-mapped IPv6 forms that URL normalisation hides — re-validates the address at connect time so DNS cannot be rebound between check and connect, re-checks every redirect hop, and bounds each fetch with one deadline covering the body plus a byte ceiling.

`submit_url` and `submit_batch` refuse to run in per-user mode rather than quietly acting as the server's own credential.

---

## All 33 tools

Thirty-three SEO analysis tools, grouped by what you would reach for them to do.

Tools marked **P** take an optional `site_url` to target any property your credential can see. 26 do; 7 are property-independent by design.

### Discovery

| Tool | What it answers | P |
|------|-----------------|---|
| `list_properties` | Which properties this account can access, and which is the default | |
| `multi_site_dashboard` | Health check across many properties at once (takes `site_urls`) | |
| `set_default_property` | Save your own default property (hosted per-user mode) | |
| `export_my_data` | Everything the server stores about you (hosted mode) | |
| `disconnect_account` | Erase it all and end your sessions (hosted mode) | |

### Analysis

The core SEO workflows — each returns a diagnosis rather than a table.

| Tool | What it answers | P |
|------|-----------------|---|
| `quick_wins` | Keywords at positions 4–15 worth pushing to page one | P |
| `ctr_opportunities` | Pages whose CTR is far below par for their position | P |
| `traffic_drops` | Biggest traffic losses, each diagnosed by cause | P |
| `content_gaps` | Demand you get impressions for but rank beyond 20 | P |
| `site_snapshot` | Clicks, impressions, CTR, position vs the prior period | P |
| `cannibalization_check` | Keywords where your own pages compete | P |
| `content_decay` | Pages declining across three consecutive 30-day periods | P |
| `topic_cluster_performance` | How a group of pages performs as a whole | P |
| `ctr_vs_benchmark` | Actual CTR against position benchmarks | P |
| `check_alerts` | Severity-rated position, CTR, click and disappearance alerts | P |
| `content_recommendations` | Prioritised update / create / consolidate actions | P |
| `advanced_search_analytics` | Custom queries with arbitrary dimensions and filters | P |
| `verify_claim` | Checks a numeric claim against live data before you state it | P |
| `generate_report` | Full markdown performance report | P |
| `inspect_url` | Whether a URL is indexed, and why or why not | P |
| `genai_conversation_queries` | AI-conversation artefacts hiding in your query data | P |

### Image search

These pass `type=image` to the Search Analytics API — a surface most third-party tools never expose, because they default to `type=web`.

| Tool | What it answers | P |
|------|-----------------|---|
| `image_keyword_overview` | Top image-search keywords | P |
| `image_search_quick_wins` | Image queries worth pushing, on an image-CTR baseline | P |
| `compare_web_vs_image` | Per-query web vs image performance, joined | P |
| `image_pages_overview` | Which pages actually surface in Google Images | P |
| `image_keyword_trends` | Period-over-period image query movement | P |
| `image_impressions_no_clicks` | The "thumbnail is not converting" pattern | P |
| `image_content_decay` | Image-search decay across three windows | P |
| `image_page_audit` | Fetches your pages and audits every on-page image factor | |

### Indexing and sitemaps

Require `GSC_SCOPES=full`, and are unavailable in hosted per-user mode.

| Tool | What it answers | P |
|------|-----------------|---|
| `list_sitemaps` | Submitted sitemaps with status, errors, indexed counts | P |
| `submit_sitemap` | Notify Google of a new or updated sitemap | P |
| `submit_url` | Submit one URL to the Indexing API | |
| `submit_batch` | Submit up to 200 URLs at once | |

`submit_url` and `submit_batch` take no `site_url` because the Indexing API addresses URLs by ownership, not by property. `image_page_audit` takes none because it fetches pages rather than querying Search Console.

### Working across properties

```
"Compare quick wins for sc-domain:primarysite.com and sc-domain:secondsite.com"

"What properties do I have?" → then "run content decay on the second one"
```

Ask for `list_properties` to get exact strings. Property identifiers are easy to mistype, and a domain property (`sc-domain:example.com`) is a *different* property from a URL-prefix one (`https://example.com/`), with different data. `GSC_SITE_URLS` (comma-separated) feeds `multi_site_dashboard`'s default list.

### Anti-hallucination

Tool descriptions instruct the model to base analysis only on returned data, and every response is wrapped with `_meta` provenance stating the source, the exact parameters, and the property used. `position` carries a caveat that it is an impression-weighted average, not a rank-tracker rank. `verify_claim` exists so the model can check its own numbers against live data before presenting them.

---

## Configuration

### Core

| Variable | Required | Description |
|----------|----------|-------------|
| `GSC_AUTH_MODE` | No | `oauth` or `service_account` (default: `service_account`) |
| `GSC_KEY_FILE` | Service account mode | Path to service account JSON key |
| `GSC_OAUTH_SECRETS_FILE` | OAuth mode | Path to OAuth client secrets JSON |
| `GSC_OAUTH_CLIENT_ID` / `GSC_OAUTH_CLIENT_SECRET` | OAuth mode (alt) | Client credentials as a pair |
| `GSC_SITE_URL` | No | Default property, used only when a tool is called without `site_url` |
| `GSC_SITE_URLS` | No | Comma-separated; supplies `multi_site_dashboard`'s default set |
| `GSC_SCOPES` | No | `readonly` or `full` (default: `full`) |

### Remote mode

| Variable | Required | Description |
|----------|----------|-------------|
| `GSC_HTTP_TOKEN` | Bearer mode | Shared token clients must present. Minimum 24 characters; the server refuses to start without it |
| `GSC_HTTP_ALLOWED_HOSTS` | Behind a proxy | Comma-separated public hostnames allowed in the `Host` header. Missing entries cause `403` |
| `GSC_HTTP_PORT` | No | Listen port (default `8787`) |
| `GSC_HTTP_HOST` | No | Bind address (default `127.0.0.1`; the container sets `0.0.0.0`) |
| `GSC_HTTP_IDLE_TIMEOUT_MS` | No | Close sessions idle longer than this (default 30 minutes) |
| `GSC_HTTP_SWEEP_INTERVAL_MS` | No | How often idle sessions are reclaimed (default 60 s) |

### Per-user OAuth mode

| Variable | Required | Description |
|----------|----------|-------------|
| `GSC_HTTP_AUTH` | To enable | `oauth` (default is `bearer`) |
| `GSC_PUBLIC_URL` | Yes | Public base URL — the OAuth issuer, token audience, and Google-callback base |
| `GSC_GOOGLE_CLIENT_ID` / `GSC_GOOGLE_CLIENT_SECRET` | Yes* | Google **Web application** client with `<GSC_PUBLIC_URL>/oauth/google/callback` registered (*or reuse `GSC_OAUTH_SECRETS_FILE`) |
| `GSC_CONTACT_EMAIL` | For verification | Contact address shown on `/privacy`; Google's reviewers expect one |
| `GSC_REPO_URL` | No | Source link shown on `/` |
| `GSC_ALLOWED_EMAILS` / `GSC_ALLOWED_EMAIL_DOMAINS` | No | Extra sign-in allowlist on top of Google's test-user list |
| `GSC_OAUTH_DB_FILE` | No | SQLite path (default `~/.gsc-mcp/oauth-server.db`) |
| `GSC_VAULT_KEY_FILE` | No | Vault key path (default `~/.gsc-mcp/vault.key`, auto-created `0600`) |
| `LITESTREAM_*` | For backups | `BUCKET`, `ENDPOINT`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY` for the `backup` profile |

### Limits

See the [table above](#operating-it). Also `GSC_REPORT_DIR` (default cwd) — the only directory `generate_report` may write into.

---

## Security

This server holds other people's Google credentials, so the design is worth stating plainly. Full policy and reporting instructions: [SECURITY.md](SECURITY.md).

**The OAuth sandwich.** In per-user mode the server issues **its own** opaque tokens to Claude, and holds your Google refresh token server-side, encrypted with AES-256-GCM under a key file kept outside the database. Claude never sees Google credentials; Google never sees MCP tokens.

**Token discipline.** MCP tokens are random and stored only as SHA-256 hashes, so a stolen database yields no working credentials. Access tokens live an hour; refresh tokens rotate on every use, and presenting an already-rotated one is treated as theft and burns every session it belonged to. Tokens are audience-bound per [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707).

**A consent screen of its own.** Dynamic client registration is open to any caller by design, so `/authorize` does not forward straight to Google. It stops at a page naming the requesting application and the exact host that would receive the result, warning when that host is not a Claude address. Google's own screen cannot show you that — it is branded with *this server's* app name. That page is unframeable (`X-Frame-Options: DENY`, `frame-ancestors 'none'`).

**Read-only by default.** Per-user mode requests exactly one Google scope, `webmasters.readonly`, and the write tools refuse to run in it.

**Your data, removable.** `export_my_data` shows everything held about you; `disconnect_account` erases the stored credential, every token and your settings, and ends your sessions. Revoking at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) cascades too: the next request fails, the stored credential is erased, and the client re-runs sign-in.

**Egress is guarded.** The one tool that fetches caller-supplied URLs classifies addresses on expanded IPv6 groups (covering the mapped, compatible, translated and NAT64 forms), validates at connect time to close the DNS-rebinding window, re-checks every redirect hop, and caps time and bytes. Image bytes are format-gated by magic number before any parser sees them.

### Self-checks

Four suites run with no Google credentials, so they are safe anywhere — and they are what CI runs:

```bash
npm test
```

| Suite | Covers |
|---|---|
| `check-tools.mjs` | Every tool registers over stdio; the right ones expose `site_url` |
| `check-http.mjs` | Health, token enforcement, sessions, the capacity limits and their `Retry-After`, the idle sweeper, the public pages and their anti-framing headers |
| `check-oauth.mjs` | The sandwich, PKCE, single-use codes, refresh rotation and reuse-burning, audience binding, the revocation cascade, DCR, cross-user session rejection, and that `disconnect_account` leaves no row anywhere |
| `check-hardening.mjs` | SSRF classification across 34 address forms, fetch deadlines and byte caps against a hostile server, redirect re-validation, report-path confinement, image format gating |

Every check in the hardening suite failed before its fix landed.

### Rehearse the real sign-in locally

The suites above fake Google so they can run in CI. To exercise an **actual** sign-in before deploying, run the flow on your own machine — Google permits `http://localhost` redirects for Web-application clients, so you can add a loopback URI to the same client that serves production:

```bash
GSC_GOOGLE_CLIENT_ID=... GSC_GOOGLE_CLIENT_SECRET=... npm run try:oauth
```

It boots OAuth mode on `http://localhost:8787` with a throwaway database and vault key in a temp directory (deleted on exit, so your deployment is untouched), self-checks discovery, PKCE and the `401` challenge, then prints exactly what to do next. Register `http://localhost:8787/oauth/google/callback` on the client, and make sure your account is a listed **test user** — otherwise Google returns `access_denied` before the server's consent page is ever reached.

If the flow works there, the only things that can still differ on a server are TLS, DNS and the reverse proxy.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `403` from a deployed server | The public hostname is missing from `GSC_HTTP_ALLOWED_HOSTS`. Binding `0.0.0.0` disables the SDK's localhost-only host check, so it must be listed explicitly |
| `502` from the proxy | The proxy cannot reach the container. Check `docker compose ps` and `docker compose logs` |
| `525` behind Cloudflare | Cloudflare cannot complete TLS to your origin — usually a missing or lapsed origin certificate for that hostname |
| `access_denied` at Google | The account is not a listed test user on the consent screen |
| `GSC_SITE_URL environment variable is required` | A tool was called with no `site_url` and no default is set. Pass one, or set `GSC_SITE_URL` |
| Connector UI won't accept the URL | Those UIs need OAuth; a shared bearer token has no header field there. Use `GSC_HTTP_AUTH=oauth` |
| `node:sqlite` error on start | OAuth mode needs Node 24+. Bearer mode and stdio work on 18+ |
| `429` / `503` with `Retry-After` | A capacity limit. See [Operating it](#operating-it) |
| Compose refuses to start | `GSC_HTTP_ALLOWED_HOSTS` is unset in `.env` — it is required rather than defaulted |

---

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, and please report problems **here** rather than upstream, since the two projects have diverged.

```bash
npm ci && npm run build && npm test
```

---

## Credits

**This project is a fork of [Suganthan's GSC MCP](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP) by [Suganthan Mohanadasan](https://suganthan.com)**, and that is where the tool set and the analysis logic originate — the quick-wins scoring, the traffic-drop diagnosis, the content-decay windows, the image-search suite, the generative-AI query detection, and the anti-hallucination provenance approach are all his design. If this server is useful to you, the credit for most of what it *does* belongs upstream. Please star [the original repository](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP) too.

What this fork adds, on top of that foundation:

- Multi-property access — every property-scoped tool takes a `site_url`, addressing upstream [issue #9](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP/issues/9)
- `list_properties` for runtime property discovery
- A remote MCP transport (Streamable HTTP), containerised
- Per-user Google sign-in: a full MCP OAuth authorization server with DCR, PKCE, an encrypted per-user token vault, and per-request user context
- Security and resource hardening, its own public pages, and continuous backups

Licensed under Apache-2.0; see [NOTICE](NOTICE) for the attribution and the complete list of changes. This fork is **not affiliated with or endorsed by** the original author.

The anti-hallucination guardrail approach came from feedback by [Krinal Mehta](https://www.linkedin.com/in/krinal/).

Not affiliated with or endorsed by Google or Anthropic. "Google" and "Google Search Console" are trademarks of Google LLC.

---

## Changelog

**v3.4.0** — Follow-through on the v3.3.0 audit, plus the pieces a public deployment needs. **A regression in v3.3.0 is fixed:** the session caps applied the *per-user* ceiling to the whole server in bearer mode, because bearer requests carry no identity and every session's owner was therefore `null` — a single-tenant deployment stopped at 8 concurrent sessions while `/healthz` advertised 120. Bearer mode is now bounded by `GSC_MAX_SESSIONS` alone, `/healthz` reports the limits actually in force, and the HTTP suite pins all of it. **Dependencies:** eight of nine advisories cleared, and the MCP SDK moved to 1.30. The ninth, `image-size`, has no fixed release and unpatched infinite loops in its ICNS, JXL and HEIF readers; because that loop is synchronous no timeout can interrupt it, so `image_page_audit` now decides an image's format from its own magic bytes — never from an attacker-controlled `Content-Type` — and refuses to hand those families to the parser at all, reporting why instead of risking the process. **Google calls are now bounded** by `GSC_GOOGLE_TIMEOUT_MS`. **New public pages** at `/` and `/privacy`, served by the server itself, because Google's sensitive-scope verification requires a home page and a privacy policy on the callback's own domain; the test suite asserts the claims the policy makes are the ones the code keeps. The consent interstitial and both pages now carry `X-Frame-Options: DENY` and a `default-src 'none'` CSP. **Continuous backups** via an opt-in Litestream sidecar, with the vault key deliberately excluded from replication. **Regression tests for everything v3.3.0 shipped untested:** the session ceiling and its `503`, the rate limit and its `429`, both `Retry-After` headers, the idle sweeper, and the deletion/export guarantees. And `scripts/try-oauth-local.mjs` rehearses a real Google sign-in on `http://localhost` against a throwaway database.

**v3.3.0** — Security and resource hardening, from a production-readiness audit of v3.2.0 (seven independent reviewers, every finding adversarially verified). The SSRF guard missed IPv4-mapped IPv6 entirely: `http://[::ffff:127.0.0.1]/` normalises to the hex form `::ffff:7f00:1`, which the dotted-decimal check never matched, so loopback and the cloud metadata endpoint were both reachable from the hosted server. Address classification now works on expanded 16-bit groups. All fetching moved behind one helper that owns the whole request: the deadline now covers the response body, bytes are capped while streaming, addresses are re-validated at connect time, and every redirect hop is re-checked. `/authorize` gained the consent interstitial. Session and rate limits stop one caller exhausting the heap. Search Analytics pagination gained a row ceiling. `generate_report` writes only inside `GSC_REPORT_DIR`. New `disconnect_account` and `export_my_data` make the deletion and access controls the documentation described actually exist. `multi_site_dashboard` no longer throws when `GSC_SITE_URL` is unset — it was broken for exactly the multi-property configuration this fork exists to support. `submit_url`/`submit_batch` refuse to run in hosted per-user mode.

**v3.2.0** — Per-user Google sign-in. `GSC_HTTP_AUTH=oauth` turns the remote server into a full MCP OAuth authorization + resource server (discovery metadata, dynamic client registration, PKCE), so anyone can add it by URL in claude.ai, Claude Desktop, or Claude Code and sign in with their own Google account. The server mints its own opaque, hashed, rotating tokens; the user's Google refresh token is held server-side, AES-256-GCM-encrypted beside the SQLite database. Refresh-token reuse burns the client's sessions; a Google-side revocation cascades. Per-request user context flows through `AsyncLocalStorage`, so every tool became per-user without changing. Sessions are owner-bound. Requires Node 24+.

**v3.1.0** — Remote mode over Streamable HTTP. Tool registration moved into a `createServer()` factory, because `server.connect()` binds one server to one transport and HTTP mode needs a fresh instance per session. Sessions support client teardown plus an idle sweeper; `/healthz` reports liveness without auth. Auth is a shared bearer token, constant-time compared. `generate_report` returns markdown inline rather than writing to the server's disk, and `image_page_audit` refuses private targets. Ships a Dockerfile and compose file publishing to loopback only.

**v3.0.0** — Multi-property support, and the fork point. Every property-scoped tool takes an optional `site_url`, so one process covers a whole account instead of the single property named by `GSC_SITE_URL`; 16 tools gained the parameter the image-search tools already had. New `list_properties` exposes `sites.list` at runtime. `GSC_SITE_URL` became optional.

**v2.5.1 and earlier** — upstream history: the 29-tool baseline, the image-search suite, generative-AI conversation-query detection, OAuth and service-account support, and the read-only scope tier. See [upstream's changelog](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP#changelog).

---

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
