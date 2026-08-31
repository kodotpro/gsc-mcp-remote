# gsc-mcp-remote

A Google Search Console MCP server that answers questions instead of returning API rows — and does it across **every property in your account**, from a **local process or a remote server**.

30 tools. OAuth or service account. Apache-2.0.

Two things make it different from other GSC MCP servers:

- **Multi-property.** Every property-scoped tool takes a `site_url`, and `list_properties` discovers what your credential can see. One install covers a whole account; you never edit config to look at another site.
- **Remote-capable.** Runs locally over stdio, or as a hosted HTTP service so Claude does not have to be on the same machine as the server.

---

## Contents

- [What you can ask](#what-you-can-ask)
- [Quick start (local)](#quick-start-local)
- [Multi-property](#multi-property)
- [Remote mode](#remote-mode)
- [All 30 tools](#all-30-tools)
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

The server can run as a hosted HTTP service, so Claude does not have to be on the same machine. Same 30 tools, same behaviour — a different transport.

### Which Claude clients can connect

Remote mode authenticates with a **single shared bearer token**. That determines where it works:

| Client | Works today | Why |
|--------|-------------|-----|
| **Claude Code** (CLI) | **Yes** | `claude mcp add --transport http` accepts an `Authorization` header |
| claude.ai custom connector | Not yet | The connector UI has no arbitrary-header field; it expects OAuth |
| Claude Desktop connector | Not yet | Same reason |

To try a remote deployment today, use **Claude Code** — from any machine and any Claude account, as long as it has the URL and the token. Support for the claude.ai and Desktop connector UIs needs per-user OAuth, which is the next milestone.

> **Who can see what.** In this phase the server holds **one** Google credential and every request is served with it. Anyone holding the bearer token can read every property that credential can see. Only share it with people allowed to see all of them. Per-user Google sign-in, where Google's own property permissions apply per person, is next.

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

The server logs session open/close events and token refreshes, never tokens or query data. `/healthz` reports active session count. Sessions idle for 30 minutes are closed automatically (`GSC_HTTP_IDLE_TIMEOUT_MS`).

Memory is capped at 512 MB with Node's heap at 384 MB, deliberately: Search Analytics results are accumulated in memory and a large property over a long window can be tens of megabytes, so the cap keeps this service from starving anything else on the box.

### Self-checks

Two smoke tests run without any Google credentials, so they are safe to run anywhere — they are what CI runs:

```bash
node scripts/check-tools.mjs
```

```bash
node scripts/check-http.mjs
```

The first asserts every tool registers over stdio and that the right ones expose `site_url` — it fails if a tool silently loses the parameter. The second boots HTTP mode with a throwaway token and checks the health endpoint, that the bearer token is enforced, that a session lists all 30 tools, and that teardown leaves none behind.

### What remote mode changes

Two tools behave differently when the server is not on your own machine:

- **`generate_report`** returns the markdown inline instead of writing a file, because a file would land on the server's disk where you could not retrieve it.
- **`image_page_audit`** refuses URLs resolving to private, loopback, or link-local addresses, and re-checks each redirect hop. Hosted, that tool fetches from inside the server's network, typically shared with databases and other internal services.

---

## All 30 tools

Every tool marked **P** takes an optional `site_url` to target any property your credential can see.

### Discovery

| Tool | What it answers | P |
|------|-----------------|---|
| `list_properties` | Which properties can this account access, and which is the default | |
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

---

## Credits

A fork of [Suganthan Mohanadasan's GSC MCP](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP), which is where the tool set and analysis logic originate. Licensed under Apache-2.0; see [NOTICE](NOTICE) for attribution and the full list of changes made in this fork.

This project is not affiliated with or endorsed by the original author. Please report problems here, at [kodotpro/gsc-mcp-remote/issues](https://github.com/kodotpro/gsc-mcp-remote/issues), rather than upstream.

The anti-hallucination guardrail approach came from feedback by [Krinal Mehta](https://www.linkedin.com/in/krinal/).

---

## Changelog

**v3.1.0** — Remote mode. Runs as a hosted HTTP service over Streamable HTTP (`node dist/index.js http`), serving the same 30 tools to Claude clients on other machines. Tool registration moved into a `createServer()` factory, because `server.connect()` binds one `McpServer` to one transport and HTTP mode needs a fresh instance per session. Sessions support client teardown via `DELETE /mcp` plus an idle sweeper; `/healthz` reports liveness and active session count without auth. Auth is a shared bearer token (`GSC_HTTP_TOKEN`, constant-time compared, minimum 24 characters, server refuses to start without it) — enough for Claude Code, while the claude.ai and Desktop connector UIs await per-user OAuth. `generate_report` returns markdown inline rather than writing to the server's disk, and `image_page_audit` refuses private, loopback and link-local targets, re-validating every redirect hop. Ships a Dockerfile and compose file publishing to loopback only, running as uid 1000, with memory capped so a large Search Analytics result cannot starve neighbouring services.

**v3.0.0** — Multi-property support, and the fork point. Every property-scoped tool takes an optional `site_url`, so one server process covers a whole account instead of the single property named by `GSC_SITE_URL`; 16 tools gained the parameter that the image-search tools already had. New `list_properties` exposes `sites.list` at runtime, so property strings can be discovered rather than guessed. `generate_report` and `content_recommendations` thread the property into the tools they compose internally. Every response reports the property it used. `GSC_SITE_URL` became optional. Addresses upstream [issue #9](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP/issues/9).

**v2.5.1 and earlier** — upstream history: the 29-tool baseline, the image-search suite, generative-AI conversation-query detection, OAuth and service-account support, and the read-only scope tier. See [upstream's changelog](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP#changelog) for detail.

---

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
