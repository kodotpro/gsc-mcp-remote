# gsc-mcp-remote

A Google Search Console MCP server that answers questions instead of returning API rows — and does it across **every property in your account**, from a **local process or a remote server**.

33 tools. OAuth or service account. Apache-2.0.

Two things make it different from other GSC MCP servers:

- **Multi-property.** Every property-scoped tool takes a `site_url`, and `list_properties` discovers what your credential can see. One install covers a whole account; you never edit config to look at another site.
- **Remote-capable.** Runs locally over stdio, or as a hosted HTTP service — including a full per-user mode where anyone adds the server by URL in Claude and signs in with their own Google account, and Google's own property permissions decide what each person sees.

---

## Contents

- [What you can ask](#what-you-can-ask)
- [Quick start (local)](#quick-start-local)
- [Multi-property](#multi-property)
- [Remote mode](#remote-mode)
  - [Test it locally first](#rehearse-the-real-sign-in-locally)
  - [Backups](#backups)
- [All 33 tools](#all-33-tools)
- [Environment variables](#environment-variables)
- [Credits](#credits)
- [Changelog](#changelog)

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

The tools return analysis, not raw rows: a traffic drop comes back diagnosed as a ranking loss, a CTR collapse, or a demand decline. Every response carries provenance metadata naming the property and the exact parameters used, so an answer is never ambiguous about which site it describes.

---

## Quick start (local)

**Not published to npm.** Install by cloning:

```bash
git clone https://github.com/kodotpro/gsc-mcp-remote.git && cd gsc-mcp-remote
```

```bash
npm ci && npm run build
```

### Authenticate

You need a Google OAuth client (or a service account). Create one in [Google Cloud Console](https://console.cloud.google.com): enable the **Google Search Console API**, then **Credentials → Create credentials → OAuth client ID → Desktop app**, and download the JSON.

The guided setup signs you in, verifies the connection with a live call, and writes your Claude config:

```bash
node dist/index.js setup
```

Or configure it by hand. In Claude Desktop's `claude_desktop_config.json`, or via `claude mcp add` for Claude Code:

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

`GSC_SITE_URL` is optional — it only sets the default property for calls that do not name one. On first use a browser opens for Google sign-in; the token is cached in `~/.gsc-mcp/` and refreshed automatically after that.

### Service account instead

Add the service account's email as a user on each property in Search Console, then:

```json
"env": {
  "GSC_AUTH_MODE": "service_account",
  "GSC_KEY_FILE": "/absolute/path/to/service-account.json"
}
```

### Access level

`GSC_SCOPES=readonly` (recommended) requests a single read-only Google permission. `full` adds sitemap submission and the Indexing API — the write tools explain how to upgrade if you call them without it.

---

## Multi-property

**One server covers your whole account.** Every property-scoped tool takes an optional `site_url`, so you never edit config or run a second process to look at another property:

> "Compare quick wins for sc-domain:primarysite.com and sc-domain:secondsite.com"
>
> "What properties do I have?" → then "run content decay on the second one"

Ask for `list_properties` to get the exact strings. Property identifiers are easy to mistype, and a domain property (`sc-domain:example.com`) is a *different* property from a URL-prefix one (`https://example.com/`), with different data.

Every response reports the property it used in `_meta.parameters.site_url`.

`GSC_SITE_URLS` (comma-separated) feeds `multi_site_dashboard`'s default list.

---

## Remote mode

The server can run as a hosted HTTP service, so Claude does not have to be on the same machine. Same 33 tools, same behaviour — a different transport.

### Two ways to run it

| | `GSC_HTTP_AUTH=oauth` — per-user sign-in | `GSC_HTTP_AUTH=bearer` — shared secret (default) |
|---|---|---|
| Who connects | Anyone you allow: they add the URL and sign in with **their own Google account** | Whoever holds the one token |
| What they see | **Their** properties — Google's own permissions apply per person | Everything the server's single Google credential sees |
| claude.ai / Desktop connector UI | **Yes** — add by URL, OAuth is discovered automatically | No (no header field in those UIs) |
| Claude Code | Yes — `claude mcp add --transport http <url>` and it walks the OAuth flow | Yes — with `--header "Authorization: Bearer ..."` |
| Google credentials on the server | Each user's refresh token, **encrypted at rest** in a local vault | One credential you copied up |
| Runtime | Node 24+ (the Docker image is) | Node 18+ |

Bearer stays the default so an existing deployment keeps working over a plain `git pull && docker compose up -d --build`; OAuth mode is switched on explicitly in `.env`. In OAuth mode the server requests **only the read-only Google scope** and the write tools stay disabled.

### Per-user sign-in: how it works

The server implements the MCP authorization spec — discovery metadata, dynamic client registration, PKCE — so Claude clients onboard by URL alone. Because registration is open to any caller, every authorization stops first at a consent page on this server that names the requesting application and the exact host the result would be sent to, and warns when that host is not a Claude address; nothing proceeds without an explicit click. Only then is the person sent to Google's consent screen ("the sandwich"): the server issues **its own** tokens to Claude and holds the user's Google refresh token server-side, encrypted with a key that never leaves the box. Claude never sees Google credentials; Google never sees MCP tokens. Presenting a stolen rotated refresh token burns every session it belonged to, and a Google-side revocation (myaccount.google.com, password change) cascades: the user's MCP tokens die with it and the next request simply re-runs sign-in.

**Google Cloud setup (one-time, ~10 minutes).** In [console.cloud.google.com](https://console.cloud.google.com), with the Search Console API enabled:

1. **OAuth consent screen:** External. While it is in **Testing** status, only Google accounts you list as **test users** can sign in — that is your beta gate (up to 100 people, refresh tokens expire weekly until the app is verified for production).
2. **Credentials → Create credentials → OAuth client ID → Web application**, with exactly this authorised redirect URI: `https://YOUR_DOMAIN/oauth/google/callback`
3. Put the client id + secret in `.env` (`GSC_GOOGLE_CLIENT_ID` / `GSC_GOOGLE_CLIENT_SECRET`), set `GSC_HTTP_AUTH=oauth` and `GSC_PUBLIC_URL=https://YOUR_DOMAIN`, restart.

**Connecting (what your users do):** in claude.ai → Settings → Connectors → Add custom connector → paste `https://YOUR_DOMAIN/mcp` → sign in with Google when the browser opens. In Claude Code: `claude mcp add --transport http gsc https://YOUR_DOMAIN/mcp` (no header needed — it discovers OAuth and opens the browser). Then: *"list my Search Console properties"*.

Optional gates on top of Google's test-user list: `GSC_ALLOWED_EMAILS` / `GSC_ALLOWED_EMAIL_DOMAINS`. Each user can save a personal default with `set_default_property`, see everything stored about them with `export_my_data`, and erase it with `disconnect_account` — which deletes the stored Google connection, every token, and their settings, and ends their sessions immediately. Revoking at myaccount.google.com/permissions is honoured too: the next request fails, the stored credential is erased, and the client re-runs sign-in.

### Try it locally first

Worth doing before touching a server — it isolates transport problems from deployment problems.

Generate a token:

```bash
openssl rand -hex 32
```

Start it, reusing whatever Google auth you already have configured:

```bash
GSC_HTTP_TOKEN=<paste-token> GSC_AUTH_MODE=oauth GSC_SCOPES=readonly GSC_OAUTH_SECRETS_FILE=/path/to/client_secret.json node dist/index.js http
```

Check it is alive (`/healthz` needs no token):

```bash
curl -s http://127.0.0.1:8787/healthz
```

Then point Claude Code at it:

```bash
claude mcp add --transport http gsc-local http://127.0.0.1:8787/mcp --header "Authorization: Bearer <paste-token>"
```

### Deploy on a server

Written for a VPS running CloudPanel, the reference deployment. Any Docker host with a reverse proxy works the same way; only the proxy step differs.

**1. DNS.** Create an `A` record for your subdomain (e.g. `gsc.example.com`) pointing at the server's IP. On Cloudflare, **set it to DNS-only (grey cloud)** — proxying adds buffering and timeout behaviour you do not want in front of a streaming protocol, and it complicates certificate issuance.

**2. Get the code onto the box.**

```bash
git clone https://github.com/kodotpro/gsc-mcp-remote.git /opt/gsc-mcp && cd /opt/gsc-mcp
```

**3. Google credentials.** The server is headless, so it can never complete an interactive OAuth flow — that needs a browser on the same machine. Mint the token somewhere with a browser (`node dist/index.js setup` on your laptop, or any local run), then copy the cached token up. Refreshes work headlessly from then on.

```bash
mkdir -p /opt/gsc-mcp/data/.gsc-mcp /opt/gsc-mcp/secrets
```

From your laptop:

```bash
scp ~/.gsc-mcp/oauth-token.json root@YOUR_SERVER_IP:/opt/gsc-mcp/data/.gsc-mcp/oauth-token.json
```

```bash
scp /path/to/client_secret.json root@YOUR_SERVER_IP:/opt/gsc-mcp/secrets/client_secret.json
```

Note the scope of the token you copy. One minted with `GSC_SCOPES=full` can submit URLs and change sitemaps; for a hosted deployment prefer a `readonly` one. A service account is the alternative — set `GSC_AUTH_MODE=service_account` and `GSC_KEY_FILE=/secrets/service-account.json`.

**4. Configure.**

```bash
cp .env.example .env && openssl rand -hex 32
```

Put that token in `.env` as `GSC_HTTP_TOKEN`, and set `GSC_HTTP_ALLOWED_HOSTS` to your subdomain. The container runs as uid 1000, so give it ownership of the writable volume:

```bash
chown -R 1000:1000 /opt/gsc-mcp/data
```

**5. Start it.** The container publishes to loopback only — the reverse proxy is the only thing that reaches it.

```bash
docker compose up -d --build
```

```bash
curl -s http://127.0.0.1:8787/healthz
```

**6. Reverse proxy.** In CloudPanel: **Sites → Add Site → Create a Reverse Proxy**, with your domain and `http://127.0.0.1:8787` as the destination. Then **Manage Site → SSL/TLS → New Let's Encrypt Certificate**.

Do **not** install Caddy or another proxy alongside CloudPanel — its nginx already owns ports 80 and 443 and they will collide.

In that site's vhost configuration, make sure the proxy location does not buffer responses:

```nginx
proxy_buffering off;
proxy_read_timeout 300s;
proxy_set_header Host $host;
```

**7. Verify from outside.**

```bash
curl -s https://gsc.example.com/healthz
```

A `403` here almost always means the public hostname is missing from `GSC_HTTP_ALLOWED_HOSTS` — binding `0.0.0.0` inside the container disables the SDK's automatic localhost-only host check, so the hostname must be listed explicitly. A `502` means the proxy cannot reach the container; check `docker compose ps` and `docker compose logs`.

### Connect Claude Code to the deployed server

Run this on whichever machine and account you want to use it from:

```bash
claude mcp add --transport http gsc https://gsc.example.com/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

```bash
claude mcp list
```

Ask *"list my Search Console properties"*, then *"run quick wins for the second one"*. If `list_properties` returns your properties, the whole chain works.

To remove it again:

```bash
claude mcp remove gsc
```

### Operating it

```bash
docker compose logs -f --tail 50
```

```bash
docker compose up -d --build   # after a git pull
```

The server logs session open/close events and token refreshes, never tokens or query data. In OAuth mode, state lives in two files on the data volume: the SQLite database (users, registrations, token hashes, encrypted Google refresh tokens) and the vault key. Losing either is survivable by design — every user just reconnects — but on a service with real users that means signing everyone out at once, so see [Backups](#backups) before a second person depends on it. `/healthz` reports the active session count and the limits in force. Sessions idle for 30 minutes are closed automatically (`GSC_HTTP_IDLE_TIMEOUT_MS`).

Memory is capped at 512 MB with Node's heap at 384 MB, deliberately: Search Analytics results are accumulated in memory and a large property over a long window can be tens of megabytes, so the cap keeps this service from starving anything else on the box.

Four limits stop one caller from taking the process down, since each session holds its own tool registry (~440 KB, so roughly 900 sessions would exhaust the heap):

| Limit | Default | Variable | Applies in |
|---|---|---|---|
| Concurrent sessions, server-wide | 120 | `GSC_MAX_SESSIONS` | both modes |
| Concurrent sessions per user | 8 | `GSC_MAX_SESSIONS_PER_USER` | `oauth` only |
| Requests per user per minute | 60 | `GSC_RATE_LIMIT_PER_MIN` | both modes |
| Rows accumulated per query | 100,000 | `GSC_MAX_TOTAL_ROWS` | both modes |
| Deadline per Google API call | 60 s | `GSC_GOOGLE_TIMEOUT_MS` | both modes |

Exceeding them returns `429` (or `503` at the server-wide session ceiling) with `Retry-After`, rather than an OOM. A query that hits the row ceiling says so in its response instead of silently reporting partial data.

The per-user ceiling needs a per-request identity, so it only means anything in `oauth` mode; bearer mode has one tenant and is bounded by `GSC_MAX_SESSIONS` alone. `/healthz` reports the limits actually in force — including `perUserSessionLimit: null` in bearer mode — so the table above can be checked against a running server rather than trusted.

### The public pages

The server serves two pages of its own, at `/` and `/privacy`: a description of the service, and a privacy policy written from what the code actually does. They are not decoration — Google's verification for a sensitive scope requires a home page **and** a privacy policy reachable over HTTPS on the same domain as the OAuth callback, and serving them from this process means they cannot drift from the deployment they describe.

Set `GSC_CONTACT_EMAIL` before submitting for verification; the privacy page states plainly when no contact address is published. `GSC_REPO_URL` sets the source link.

Both pages, and the authorization consent interstitial, are served with `X-Frame-Options: DENY` and a `default-src 'none'` CSP. The consent page exists to make one fact refusable — which client receives the authorization result — so it must not be frameable.

### Backups

In OAuth mode the SQLite database is the one piece of state that is small but not reproducible: who has connected, and their encrypted Google refresh tokens. Losing it loses nobody's Search Console data — none is stored — but it signs every user out at once with no way to tell them why.

A Litestream sidecar replicates it continuously to any S3-compatible bucket (Cloudflare R2 has no egress charge, which suits a database this size). It is opt-in, so an existing deployment is unaffected until you fill the `LITESTREAM_*` variables in `.env`:

```bash
docker compose --profile backup up -d
```

To restore, stop the app and move any current database aside first — Litestream refuses to restore over an existing file, and `--no-deps` is what stops Compose starting the app (which would create an empty one) as a dependency:

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

The sidecar is passed only the four `LITESTREAM_*` credentials, not the whole `.env` — it has no need of the bearer token or the Google client secret.

**The vault key is deliberately not replicated.** The refresh tokens in that database are encrypted with the key at `data/.gsc-mcp/vault.key`; shipping it to the same bucket as the ciphertext would put the lock and the key in one place and defeat the encryption. Copy its 64 hex characters into a password manager instead. Keep it and a restore is complete; lose it and the restore still works — the stored Google connections are simply dead, and each user reconnects once.

### Self-checks

Four suites run without any Google credentials, so they are safe to run anywhere — they are what CI runs:

```bash
node scripts/check-tools.mjs
```

Asserts every tool registers over stdio and that the right ones expose `site_url` — it fails if a tool silently loses the parameter.

```bash
node scripts/check-http.mjs
```

Boots bearer-mode HTTP with a throwaway token: the health endpoint, token enforcement, a session listing all 33 tools, teardown, the capacity limits (session ceiling → `503`, rate limit → `429`, both with `Retry-After`), the idle sweeper reclaiming abandoned sessions, and the public pages with their anti-framing headers.

```bash
node scripts/check-oauth.mjs
```

Covers OAuth mode end to end without Google: the sandwich, PKCE, single-use codes, refresh rotation and reuse-burning, audience binding, the revocation cascade, discovery metadata, DCR, that one user's session rejects another user's valid token, and that `disconnect_account` leaves no row in any table while `export_my_data` never returns the stored credential.

```bash
node scripts/check-hardening.mjs
```

A regression suite for the hardening fixes, where every check failed before its fix landed: SSRF address classification across 34 address forms, fetch deadlines and byte caps against a deliberately hostile server, redirect re-validation, report-path confinement, and magic-byte format gating before any image reaches the parser.

### Rehearse the real sign-in locally

The suites above fake Google so they can run in CI. To exercise an **actual** sign-in before deploying — the thing that catches a misconfigured OAuth client — run the flow on your own machine. Google permits `http://localhost` redirects for Web-application clients, so you can add a loopback callback to the same client that serves production:

```bash
GSC_GOOGLE_CLIENT_ID=... GSC_GOOGLE_CLIENT_SECRET=... node scripts/try-oauth-local.mjs
```

It boots OAuth mode on `http://localhost:8787` with a throwaway database and vault key in a temp directory (deleted on exit, so your deployment is untouched), self-checks that discovery, PKCE and the `401` challenge are right, then prints what to do next. Add it with `claude mcp add --transport http gsc-local http://localhost:8787/mcp` and complete the flow for real. If it works here, the only things that can still differ on the server are TLS, DNS and the reverse proxy.

### What remote mode changes

Two tools behave differently when the server is not on your own machine:

- **`generate_report`** returns the markdown inline instead of writing a file, because a file would land on the server's disk where you could not retrieve it.
- **`image_page_audit`** refuses URLs resolving to private, loopback, link-local or reserved addresses — including the IPv4-mapped IPv6 forms that URL normalisation hides — validates the address again at connect time so DNS cannot be rebound between check and connect, re-checks every redirect hop, and bounds each fetch with one deadline covering the body plus a hard byte ceiling. Hosted, that tool fetches from inside the server's network, typically shared with databases and other internal services.

---

## All 33 tools

Every tool marked **P** takes an optional `site_url` to target any property your credential can see.

### Discovery

| Tool | What it answers | P |
|------|-----------------|---|
| `list_properties` | Which properties can this account access, and which is the default | |
| `set_default_property` | Save the signed-in user's own default property (hosted per-user mode) | |
| `disconnect_account` | Erase everything the server stores for you and end your sessions (hosted mode) | |
| `export_my_data` | Show everything the server stores about you (hosted mode) | |
| `multi_site_dashboard` | Health check across many properties at once (takes `site_urls`) | |

### Analysis

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

Require `GSC_SCOPES=full`.

| Tool | What it answers | P |
|------|-----------------|---|
| `list_sitemaps` | Submitted sitemaps with status, errors, indexed counts | P |
| `submit_sitemap` | Notify Google of a new or updated sitemap | P |
| `submit_url` | Submit one URL to the Indexing API | |
| `submit_batch` | Submit up to 200 URLs at once | |

`submit_url` and `submit_batch` take no `site_url` because the Indexing API addresses URLs by ownership, not by property. `image_page_audit` takes none because it fetches pages rather than querying Search Console.

### Anti-hallucination

Tool descriptions carry explicit instructions to base analysis only on returned data, and every response is wrapped with `_meta` provenance stating the source, the exact parameters, and the property used. `position` carries a caveat that it is an impression-weighted average, not a rank-tracker rank. `verify_claim` exists so the model can check its own numbers against live data before presenting them.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GSC_AUTH_MODE` | No | `oauth` or `service_account` (default: `service_account`) |
| `GSC_KEY_FILE` | Service account mode | Path to service account JSON key |
| `GSC_OAUTH_SECRETS_FILE` | OAuth mode | Path to OAuth client secrets JSON |
| `GSC_OAUTH_CLIENT_ID` | OAuth mode (alt) | OAuth client ID |
| `GSC_OAUTH_CLIENT_SECRET` | OAuth mode (alt) | OAuth client secret |
| `GSC_SITE_URL` | No | Default property, used only when a tool is called without `site_url`. Optional: callers that always pass `site_url` need no default |
| `GSC_SITE_URLS` | No | Comma-separated list; supplies `multi_site_dashboard`'s default set |
| `GSC_SCOPES` | No | `readonly` or `full` (default: `full`) |

### Remote mode only

| Variable | Required | Description |
|----------|----------|-------------|
| `GSC_HTTP_TOKEN` | Yes, in HTTP mode | Shared bearer token clients must present. Minimum 24 characters; the server refuses to start without it. Generate with `openssl rand -hex 32` |
| `GSC_HTTP_ALLOWED_HOSTS` | Behind a proxy | Comma-separated public hostnames allowed in the `Host` header. Missing entries cause `403` |
| `GSC_HTTP_PORT` | No | Listen port (default `8787`) |
| `GSC_HTTP_HOST` | No | Bind address (default `127.0.0.1`; the container sets `0.0.0.0`) |
| `GSC_HTTP_IDLE_TIMEOUT_MS` | No | Close sessions idle longer than this (default 1800000, i.e. 30 minutes) |

### OAuth (per-user) mode only

| Variable | Required | Description |
|----------|----------|-------------|
| `GSC_HTTP_AUTH` | To enable | `oauth` (default is `bearer`) |
| `GSC_PUBLIC_URL` | Yes | Public base URL, e.g. `https://gsc.example.com` — the OAuth issuer, token audience, and Google-callback base |
| `GSC_GOOGLE_CLIENT_ID` / `GSC_GOOGLE_CLIENT_SECRET` | Yes* | Google **Web application** client with `<GSC_PUBLIC_URL>/oauth/google/callback` registered (*or reuse `GSC_OAUTH_SECRETS_FILE`) |
| `GSC_ALLOWED_EMAILS` / `GSC_ALLOWED_EMAIL_DOMAINS` | No | Extra sign-in allowlist on top of Google's Testing-status test users |
| `GSC_OAUTH_DB_FILE` | No | SQLite path (default `~/.gsc-mcp/oauth-server.db`) |
| `GSC_VAULT_KEY_FILE` | No | Vault key path (default `~/.gsc-mcp/vault.key`, auto-created 0600) |
| `GSC_CONTACT_EMAIL` | For verification | Contact address shown on `/privacy`. Google's reviewers expect one |
| `GSC_REPO_URL` | No | Source link shown on `/` (defaults to this repository) |
| `LITESTREAM_BUCKET` / `LITESTREAM_ENDPOINT` / `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY` | For backups | S3-compatible target for the `backup` compose profile |

### Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `GSC_MAX_SESSIONS` | 120 | Concurrent MCP sessions server-wide; `503` beyond it |
| `GSC_MAX_SESSIONS_PER_USER` | 8 | Concurrent sessions one user may hold; `429` beyond it. `oauth` mode only — bearer has a single tenant |
| `GSC_RATE_LIMIT_PER_MIN` | 60 | Requests per user per minute; `429` with `Retry-After` |
| `GSC_MAX_TOTAL_ROWS` | 100000 | Rows one Search Analytics query may accumulate; results say when truncated |
| `GSC_GOOGLE_TIMEOUT_MS` | 60000 | Deadline on each Google API call. googleapis sets none by default |
| `GSC_REPORT_DIR` | cwd | Directory `generate_report` may write into; paths are confined to it |
| `GSC_HTTP_SWEEP_INTERVAL_MS` | 60000 | How often idle sessions are reclaimed |

---

## Credits

A fork of [Suganthan Mohanadasan's GSC MCP](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP), which is where the tool set and analysis logic originate. Licensed under Apache-2.0; see [NOTICE](NOTICE) for attribution and the full list of changes made in this fork.

This project is not affiliated with or endorsed by the original author. Please report problems here, at [kodotpro/gsc-mcp-remote/issues](https://github.com/kodotpro/gsc-mcp-remote/issues), rather than upstream.

The anti-hallucination guardrail approach came from feedback by [Krinal Mehta](https://www.linkedin.com/in/krinal/).

---

## Changelog

**v3.4.0** — Follow-through on the v3.3.0 audit, plus the pieces a public deployment needs. **A regression in v3.3.0 is fixed:** the session caps applied the *per-user* ceiling to the whole server in bearer mode, because bearer requests carry no identity and every session's owner was therefore `null` — a single-tenant deployment stopped at 8 concurrent sessions while `/healthz` advertised 120. Bearer mode is now bounded by `GSC_MAX_SESSIONS` alone, `/healthz` reports the limits actually in force, and the HTTP suite pins all of it. **Dependencies:** eight of nine advisories cleared, and the MCP SDK moved to 1.30. The ninth, `image-size`, has no fixed release and unpatched infinite loops in its ICNS, JXL and HEIF readers; because that loop is synchronous no timeout can interrupt it, so `image_page_audit` now decides an image's format from its own magic bytes — never from an attacker-controlled `Content-Type` — and refuses to hand those families to the parser at all, reporting why instead of risking the process. **Google calls are now bounded** by `GSC_GOOGLE_TIMEOUT_MS` (googleapis sets no default, so a hung response previously held a session and a rate-limit slot indefinitely). **New public pages** at `/` and `/privacy`, served by the server itself, because Google's sensitive-scope verification requires a home page and a privacy policy on the callback's own domain; the policy is written from what the code does, and the test suite asserts the claims it makes are the ones the code keeps. The consent interstitial and both pages now carry `X-Frame-Options: DENY` and a `default-src 'none'` CSP. **Continuous backups** via an opt-in Litestream sidecar (`docker compose --profile backup up -d`), with the vault key deliberately excluded from replication so the key and the ciphertext it protects never share a bucket. **Regression tests for everything v3.3.0 shipped untested:** the session ceiling and its `503`, the rate limit and its `429`, both `Retry-After` headers, the idle sweeper, and that `disconnect_account` leaves no row in any table while `export_my_data` never returns the stored credential. And `scripts/try-oauth-local.mjs` rehearses a real Google sign-in on `http://localhost` against a throwaway database, so the flow can be proven before it is deployed. The repository no longer hardcodes the maintainer's own hostname in its templates.

**v3.3.0** — Security and resource hardening, from a production-readiness audit of v3.2.0 (seven independent reviewers, every finding adversarially verified). Each fix below was reproduced before and after. The SSRF guard missed IPv4-mapped IPv6 entirely: `http://[::ffff:127.0.0.1]/` normalises to the hex form `::ffff:7f00:1`, which the dotted-decimal check never matched, so loopback and the cloud metadata endpoint were both reachable from the hosted server. Address classification now works on expanded 16-bit groups and covers mapped, compatible, translated and NAT64 forms. All fetching moved behind one helper that owns the whole request: the deadline now covers the response body (it previously ended when headers arrived, leaving downloads unbounded in time and size), bytes are capped while streaming rather than after buffering, addresses are re-validated at connect time so DNS cannot be rebound between check and connect, and every redirect hop is re-checked. `/authorize` no longer forwards straight to Google — because dynamic client registration is open to any caller, it stops at a consent page naming the requesting application and the exact host that would receive the result, warning when that host is not a Claude address. Session and rate limits (`GSC_MAX_SESSIONS`, `GSC_MAX_SESSIONS_PER_USER`, `GSC_RATE_LIMIT_PER_MIN`) stop one caller exhausting the heap: each session costs ~440 KB, so ~900 of them previously aborted the process and took every other tenant with it. Search Analytics pagination gained a row ceiling (`GSC_MAX_TOTAL_ROWS`) that reports truncation instead of accumulating without limit. `generate_report` writes only inside `GSC_REPORT_DIR` (default cwd). New `disconnect_account` and `export_my_data` tools make the deletion and access controls the documentation already described actually exist; revoking a Google grant now erases the stored credential rather than only flagging it, and unused client registrations are swept. `multi_site_dashboard` no longer throws when `GSC_SITE_URL` is unset — it was broken for exactly the multi-property configuration this fork exists to support — and its fan-out is bounded. `submit_url`/`submit_batch` refuse to run in hosted per-user mode rather than silently using the server's own credential. New regression suite: `scripts/check-hardening.mjs`.

**v3.2.0** — Per-user Google sign-in. `GSC_HTTP_AUTH=oauth` turns the remote server into a full MCP OAuth authorization + resource server (discovery metadata, dynamic client registration, PKCE via the official SDK's auth router), so anyone can add it by URL in claude.ai, Claude Desktop, or Claude Code and sign in with their own Google account — Google's own property permissions then decide what each person sees. Architecture: the server mints its own opaque, hashed, rotating tokens for Claude; the user's Google refresh token is held server-side, AES-256-GCM-encrypted under a key file beside the SQLite database (`node:sqlite`, no native deps). Refresh-token reuse burns the client's sessions; a Google-side revocation cascades so the next request re-runs sign-in. Per-request user context flows through AsyncLocalStorage into the same two functions every tool already used, so all 31 tools became per-user without changing — plus the new `set_default_property` for a personal default. Sessions are owner-bound: a valid token belonging to another user is rejected with 403. Bearer mode remains the default and unchanged; OAuth mode forces the read-only scope. Runtime for OAuth mode: Node 24+ (Docker image bumped). 47-check credential-free test suite in `scripts/check-oauth.mjs`.

**v3.1.0** — Remote mode. Runs as a hosted HTTP service over Streamable HTTP (`node dist/index.js http`), serving the same 30 tools to Claude clients on other machines. Tool registration moved into a `createServer()` factory, because `server.connect()` binds one `McpServer` to one transport and HTTP mode needs a fresh instance per session. Sessions support client teardown via `DELETE /mcp` plus an idle sweeper; `/healthz` reports liveness and active session count without auth. Auth is a shared bearer token (`GSC_HTTP_TOKEN`, constant-time compared, minimum 24 characters, server refuses to start without it) — enough for Claude Code, while the claude.ai and Desktop connector UIs await per-user OAuth. `generate_report` returns markdown inline rather than writing to the server's disk, and `image_page_audit` refuses private, loopback and link-local targets, re-validating every redirect hop. Ships a Dockerfile and compose file publishing to loopback only, running as uid 1000, with memory capped so a large Search Analytics result cannot starve neighbouring services.

**v3.0.0** — Multi-property support, and the fork point. Every property-scoped tool takes an optional `site_url`, so one server process covers a whole account instead of the single property named by `GSC_SITE_URL`; 16 tools gained the parameter that the image-search tools already had. New `list_properties` exposes `sites.list` at runtime, so property strings can be discovered rather than guessed. `generate_report` and `content_recommendations` thread the property into the tools they compose internally. Every response reports the property it used. `GSC_SITE_URL` became optional. Addresses upstream [issue #9](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP/issues/9).

**v2.5.1 and earlier** — upstream history: the 29-tool baseline, the image-search suite, generative-AI conversation-query detection, OAuth and service-account support, and the read-only scope tier. See [upstream's changelog](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP#changelog) for detail.

---

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
