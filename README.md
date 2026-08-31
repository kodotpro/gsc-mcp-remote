# GSC MCP (multi-property)

An MCP server for Google Search Console that lets you ask Claude questions about your search data and get real answers. Not raw API rows. Actual analysis.

30 tools, **all of them able to target any property in your account**. OAuth or service account. Free and open source. Runs on your machine: your data goes straight from this computer to Google, and nothing passes through anyone else's servers.

---

## About this fork

This is a **modified fork** of [Suganthan Mohanadasan's GSC MCP](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP) (Apache-2.0). All the analysis work is his; see [NOTICE](NOTICE) for attribution. It is not affiliated with or endorsed by the original author. Please report problems with this fork at [kodotpro/gsc-mcp-remote/issues](https://github.com/kodotpro/gsc-mcp-remote/issues) rather than upstream.

**What changed in v3.0.0 — multi-property support.** Upstream pinned most tools to a single `GSC_SITE_URL`, so covering an account with several properties meant running one server process per property. Of its 29 tools, 9 accepted a `site_url` override (the newer image-search and `advanced_search_analytics` tools) and the original web-analysis suite never got it. This fork closes that gap:

- **`site_url` on every property-scoped tool** — 16 tools gained it, including `quick_wins`, `traffic_drops`, `content_decay`, `cannibalization_check`, `site_snapshot`, `check_alerts`, `ctr_opportunities`, `ctr_vs_benchmark`, `content_gaps`, `topic_cluster_performance`, `verify_claim`, `inspect_url`, `list_sitemaps`, `submit_sitemap`, and the two composite tools below. Omit it and you get the configured default, exactly as before — nothing about existing single-property setups changes.
- **`list_properties`** (new tool) — asks Google which properties your credential can actually see, with permission level and type. Upstream called `sites.list` only inside the interactive setup wizard, so at runtime Claude had no way to discover properties; it had to be told the exact strings, which are easy to get wrong (`sc-domain:example.com` vs `https://example.com/`).
- **The composite tools thread the property through their callees.** `generate_report` and `content_recommendations` each call several other tools internally, so a `site_url` on the signature alone would have left the sub-analyses reporting on the default property. Both now pass it down.
- **The resolved property is reported back** in every tool's `_meta.parameters.site_url`, so an answer can never quietly be about a different property than you meant.
- **A configured default is now optional.** If callers always pass `site_url`, the server needs no `GSC_SITE_URL` at all — which is what allows one process to serve a whole account, and later many users.

This corresponds to upstream [issue #9](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP/issues/9).

**What changed in v3.1.0 — remote mode.** The server can now also run as a hosted HTTP service over Streamable HTTP, so Claude does not have to sit on the same machine. Auth is a shared bearer token at this stage, which Claude Code supports directly; the claude.ai and Desktop connector UIs need per-user OAuth, which is the next phase. See [Remote mode](#remote-mode-v310) for the full runbook. Local stdio mode is untouched and remains the default.

> **Original project's setup guide with screenshots** (still accurate for auth):
> [suganthan.com/blog/google-search-console-mcp-server/](https://suganthan.com/blog/google-search-console-mcp-server/)

---

> **v2.5.0 update (August 2026):** new tool `image_page_audit` closes the image SEO loop. The v2.3 suite tells you which pages fail in image search; this one fetches those pages from your own site and tells you why: alt text, filenames, dimension attributes, lazy loading on the LCP image, formats and weights, the ~250x200 indexing minimum, ImageObject/licensable schema, max-image-preview, and the metadata inside the image files (camera EXIF to strip, IPTC to keep, DigitalSourceType on AI images). It only ever fetches the URLs you give it. Launch post with the whole 8-tool workflow on real client data: ["One Page Earned 102,657 Image Impressions and 2 Clicks"](https://suganthan.com/blog/gsc-mcp-image-seo-tools/).

> **v2.4.0 update (August 2026):** new tool `genai_conversation_queries` finds the AI conversations leaking into your query report. People reply to Google's AI with things like "yes, go on", Google logs every follow-up as a new query, and this tool sorts all of it into seven classified buckets with landing pages and a monthly timeline. Full method and findings: ["Yes, Go On": The AI Conversations Leaking Into Your Search Console](https://suganthan.com/blog/ai-mode-queries-search-console/).

## See it in action

**"Audit the images on these pages"**

![Per-image findings from image_page_audit: alt status, filename, loading, weight and metadata per image, with an ordered fix list per page](screenshots/image-page-audit.jpg)

**"Which of my queries are actually AI conversations?"**

![Reply artefacts like yes and sure classified with impressions, clicks and landing pages](screenshots/genai-conversation-queries.jpg)

**"How is my site doing?"**

![Site snapshot with period comparison](screenshots/snapshot.jpg)

**"What are my quick win keywords?"**

![Quick wins analysis showing positions 4-15 with opportunity scores](screenshots/quick%20wins2.jpg)

**"Which pages are cannibalising each other?"**

![Cannibalisation detection across the site](screenshots/canni.jpg)

**"What content is slowly dying?"**

![Content decay detection over three consecutive periods](screenshots/dying.jpg)

**"Which pages lost traffic and why?"**

![Traffic drop diagnosis: ranking loss vs CTR collapse vs demand decline](screenshots/lost.jpg)

**"How does my CTR compare to benchmarks?"**

![CTR vs industry benchmarks by position](screenshots/CTR.jpg)

**"How is my blog cluster performing?"**

![Topic cluster performance for a URL path pattern](screenshots/topics.jpg)

## What you can ask

```
"What are my quick win keywords?"
"Which pages lost traffic this month and why?"
"What content is decaying?"
"Which pages are cannibalising each other?"
"Check for any SEO alerts in the last 7 days"
"Give me content recommendations"
"How does my CTR compare to benchmarks?"
"How is my /blog/ cluster performing?"
"Show me US mobile traffic for the last 90 days"
"Is /blog/my-post/ indexed? If not, why?"
"Generate a full performance report and save it"
"Show me a dashboard across all my sites"
"Submit this URL for indexing: https://mysite.com/new-post/"
"Batch submit all my new blog posts for indexing"
"List my sitemaps and their status"
"Verify that claim about my homepage clicks"
```

## Quick start

### One command setup (new in v2.3)

```bash
npx -y suganthan-gsc-mcp setup
```

The wizard signs you in with Google, verifies the connection with a live API call, lets you pick your property from a list, and writes the config for Claude Desktop and Claude Code. No config files to edit.

Read only by default: the standard consent screen asks for a single view permission. Choose full access during setup if you want the sitemap and URL submission tools.

For now you still need your own Google OAuth client JSON one time (steps 1 to 3 under Manual OAuth below); the wizard takes it from there. Built in Google sign in, with no Google Cloud steps at all, ships the moment Google finishes verifying the shared client.

Useful flags: `--client desktop|code|both|print`, `--scopes readonly|full`, `--site <property>`, `--secrets <path>`, `--reauth`, `--force`, `--dry-run`, `--help`.

### One click desktop install

Prefer no terminal at all? Download the `.mcpb` bundle from the [releases page](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP/releases) and double click it. Claude Desktop installs the server with a small settings screen.

### Option A: OAuth (manual)

1. Create a Google Cloud project and enable the **Search Console API**
2. Go to **Credentials > Create Credentials > OAuth client ID**, choose **Desktop app**
3. Download the client secrets JSON
4. Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gsc": {
      "command": "npx",
      "args": ["-y", "suganthan-gsc-mcp"],
      "env": {
        "GSC_AUTH_MODE": "oauth",
        "GSC_OAUTH_SECRETS_FILE": "/path/to/client_secrets.json",
        "GSC_SITE_URL": "sc-domain:yoursite.com",
        "GSC_SCOPES": "readonly"
      }
    }
  }
}
```

First use opens a browser for Google sign in. Token is cached after that (locally, at `~/.gsc-mcp/`). Set `GSC_SCOPES` to `full` if you want the submission tools; omit it and you get full access, matching pre 2.3 behaviour. Running from a git checkout instead of npm? Use `"command": "node", "args": ["/path/to/Suganthans-GSC-MCP/dist/index.js"]`.

### Option B: Service Account

1. Create a Google Cloud project and enable the **Search Console API**
2. Go to **IAM & Admin > Service Accounts**, create one, download the JSON key
3. Add the service account email to your GSC property (Settings > Users and permissions > Full access)
4. Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "gsc": {
      "command": "node",
      "args": ["/path/to/Suganthans-GSC-MCP/dist/index.js"],
      "env": {
        "GSC_KEY_FILE": "/path/to/service-account.json",
        "GSC_SITE_URL": "sc-domain:yoursite.com"
      }
    }
  }
}
```

### Generative AI (v2.4)

Google's Generative AI performance report has no API, no BigQuery export, and no searchAppearance value. But Google counts every AI Mode follow-up as a brand-new query and folds AI Mode and AI Overviews into the web search type, so AI-conversation exhaust leaks into the regular query dimension with real impressions, positions and clicks. This tool mines it.

| Tool | What it answers |
|---|---|
| `genai_conversation_queries` | Which of your queries are actually AI-conversation exhaust: bare replies to the AI ("yes", "go on"), "what about X" pivot follow-ups, conversational questions, AI-visibility tracker probes, and full agent prompts logged as queries. Seven classified buckets with landing pages, plus a monthly timeline showing when reply-artefacts first appeared on your property |

### Indexing API (optional)

To use `submit_url`, `submit_batch`, and `submit_sitemap`:

1. Enable the **Web Search Indexing API** in your [Google Cloud console](https://console.cloud.google.com/apis/library/indexing.googleapis.com)
2. Your service account (or OAuth credentials) need owner-level access in Search Console

Note: Google officially says the Indexing API is for JobPosting and BroadcastEvent schema types. In practice, it processes requests for all page types.

### Multi-property

**One server covers your whole account.** Every property-scoped tool takes an optional `site_url`, so you never need to edit config or run a second process to look at another property. Just name it:

> "Compare quick wins for sc-domain:primarysite.com and sc-domain:secondsite.com"
>
> "What properties do I have?" → then "run content decay on the second one"

`GSC_SITE_URL` is now **optional**, and sets only the fallback used when a tool is called without `site_url`:

```json
"env": {
  "GSC_SITE_URL": "sc-domain:primarysite.com"
}
```

Ask Claude to list your properties (`list_properties`) to get the exact strings — property identifiers are easy to mistype, and a domain property (`sc-domain:example.com`) is a different property from a URL-prefix one (`https://example.com/`) with different data.

Every response reports the property it used in `_meta.parameters.site_url`, so an answer is never ambiguous about which site it describes.

`GSC_SITE_URLS` (comma-separated) remains available and feeds `multi_site_dashboard`'s default list. Note that in upstream it *looked* like it made every tool multi-property but did not: the pinned tools silently used only the first entry. That is the bug this fork fixes.

---

## Remote mode (v3.1.0)

The server can also run as a hosted HTTP service, so Claude does not have to be on the same machine as the server. Same 30 tools, same behaviour — a different transport.

### Read this first: which Claude clients can connect

Remote mode currently authenticates with a **single shared bearer token**. That determines where it works:

| Client | Works today | Why |
|--------|-------------|-----|
| **Claude Code** (CLI) | **Yes** | `claude mcp add --transport http` accepts an `Authorization` header |
| claude.ai custom connector | Not yet | The connector UI has no arbitrary-header field; it expects OAuth |
| Claude Desktop connector | Not yet | Same reason |

So to try a remote deployment today, use **Claude Code** — from any machine and any Claude account, as long as it has the URL and the token. Support for the claude.ai and Desktop connector UIs needs per-user OAuth, which is the next phase of this fork.

> **Who can see what.** In this phase the server holds **one** Google credential and every request is served with it. Anyone holding the bearer token can read every property that credential can see. Only share it with people who are allowed to see all of them. Per-user Google sign-in, where Google's own property permissions apply per person, is the next phase.

### Try it locally first

Worth doing before touching a server — it isolates transport problems from deployment problems.

```bash
npm install && npm run build
```

Generate a token:

```bash
openssl rand -hex 32
```

Start it, reusing whatever Google auth you already have configured locally:

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

The runbook below is written for a Hetzner VPS running CloudPanel, which is the reference deployment. Any Docker host with a reverse proxy works the same way; only the proxy step differs.

**1. DNS.** Create an `A` record for your subdomain (e.g. `gsc.example.com`) pointing at the server's IP. If you use Cloudflare, **set it to DNS-only (grey cloud)** — proxying adds buffering and timeout behaviour you do not want in front of a streaming protocol, and it complicates certificate issuance.

**2. Get the code onto the box.**

```bash
git clone https://github.com/kodotpro/gsc-mcp-remote.git /opt/gsc-mcp && cd /opt/gsc-mcp
```

**3. Google credentials.** The server is headless, so it can never complete an interactive OAuth flow — that needs a browser on the same machine. Mint the token somewhere with a browser (your laptop, via `npx gsc-mcp-remote setup` or any local run), then copy the cached token up. Refreshes work headlessly from then on.

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

Note the scope of the token you copy. A token minted with `GSC_SCOPES=full` can submit URLs and change sitemaps; for a hosted deployment prefer a `readonly` one. A service account is the alternative — set `GSC_AUTH_MODE=service_account` and `GSC_KEY_FILE=/secrets/service-account.json`, and add the account as a user on each property.

**4. Configure.**

```bash
cp .env.example .env && openssl rand -hex 32
```

Put that token in `.env` as `GSC_HTTP_TOKEN`, and set `GSC_HTTP_ALLOWED_HOSTS` to your subdomain. The container runs as uid 1000, so give it ownership of the writable volume:

```bash
chown -R 1000:1000 /opt/gsc-mcp/data
```

**5. Start it.** The container publishes to loopback only — nginx is the only thing that reaches it.

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

A `403` here almost always means the public hostname is missing from `GSC_HTTP_ALLOWED_HOSTS` — binding `0.0.0.0` inside the container disables the SDK's automatic localhost-only host check, so the hostname must be listed explicitly. A `502` means nginx cannot reach the container; check `docker compose ps` and `docker compose logs`.

### Connect Claude Code to the deployed server

This is the step you run on whichever machine and account you want to use it from:

```bash
claude mcp add --transport http gsc https://gsc.example.com/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

Verify, then try it:

```bash
claude mcp list
```

Ask *"list my Search Console properties"*, then *"run quick wins for the second one"*. If `list_properties` returns your properties, the whole chain is working.

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

The server logs session open/close events and refresh activity, never tokens or query data. `/healthz` reports active session count. Sessions idle for 30 minutes are closed automatically (`GSC_HTTP_IDLE_TIMEOUT_MS`).

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
- **`image_page_audit`** refuses URLs that resolve to private, loopback, or link-local addresses, and re-checks each redirect hop. Hosted, that tool fetches from inside the server's network, which is typically shared with databases and other internal services.

## All 30 tools

### Analysis

| Tool | What it answers |
|---|---|
| `site_snapshot` | How is the site doing overall? Clicks, impressions, CTR, position with period comparison |
| `quick_wins` | Keywords at positions 4-15 with high impressions, scored by opportunity |
| `ctr_opportunities` | Pages with high impressions but CTR below expected for their position |
| `traffic_drops` | What lost traffic, and whether it's a ranking loss, CTR collapse, or demand decline |
| `content_gaps` | Topics with search demand but no real content targeting them |
| `cannibalization_check` | Keywords where multiple pages compete against each other |
| `content_decay` | Pages declining across three consecutive 30-day periods |
| `topic_cluster_performance` | Aggregated performance for all pages matching a URL path pattern |
| `ctr_vs_benchmark` | Your actual CTR per position vs industry benchmarks |
| `inspect_url` | Is this URL indexed? Last crawl date, canonical, robots/noindex issues |
| `check_alerts` | Position drops, CTR collapses, click losses, disappeared pages. Severity-rated |
| `content_recommendations` | Prioritised actions: pages to update, content to create, pages to consolidate |
| `advanced_search_analytics` | Custom queries with flexible dimensions and filters |
| `generate_report` | Full markdown report saved to disk |
| `multi_site_dashboard` | Health check across all properties in one command |
| `list_properties` | Every property your credential can access, with permission level and type (new in this fork) |

### Image SEO (v2.3 + v2.5)

These tools pass `type=image` to the GSC Search Analytics API, which most third-party tools never expose. They cover the visual-search surface end-to-end.

| Tool | What it answers |
|---|---|
| `image_keyword_overview` | Top image-search queries on the site, sorted by impressions, clicks, or position |
| `image_search_quick_wins` | Image queries at positions 4-15 with high impressions, scored by image-CTR opportunity. The CTR baseline is calibrated for image search, which runs roughly 5-6x lower than web at equivalent positions |
| `compare_web_vs_image` | Same query, side-by-side performance across web and image surfaces, with an impressions ratio that surfaces where image search carries disproportionate volume |
| `image_pages_overview` | Pages on the site ranked by image-search performance. Pairs with `image_keyword_overview` to map queries back to the pages carrying them |
| `image_keyword_trends` | Period-over-period deltas for image-search queries. Impressions delta and position delta (negative position delta means the query improved its average rank) |
| `image_impressions_no_clicks` | Query and page pairs earning meaningful image impressions but near-zero clicks. The textbook thumbnail-not-converting pattern |
| `image_content_decay` | Image-search version of `content_decay`. Pages losing image-search traffic across 3 consecutive 30-day periods, sorted by total click loss |
| `image_page_audit` | Fetches pages from your own site and audits every image on them: alt text, filenames, width/height attributes, lazy loading on the LCP candidate, srcset, format and weight, intrinsic dimensions vs the ~250x200 indexing minimum, ImageObject and licensable schema, max-image-preview, and in-file metadata (camera EXIF, IPTC editorial fields, XMP DigitalSourceType). The bridge from "which pages fail" to "why they fail" (v2.5) |

### Indexing

| Tool | What it does |
|---|---|
| `submit_url` | Submit a URL to Google's Indexing API for crawling |
| `submit_batch` | Batch submit up to 200 URLs (daily quota) |
| `submit_sitemap` | Notify Google of a new or updated sitemap |
| `list_sitemaps` | All submitted sitemaps with status, errors, and indexed counts |

### Safety

| Tool | What it does |
|---|---|
| `verify_claim` | Self-check: re-queries GSC data to verify a numeric claim before presenting it |

## What makes this different from other Google Search Console MCP servers

**Analysis, not just API access.** Most Google Search Console MCP servers wrap the raw API. This one ships with pre-built analysis: opportunity scoring, cannibalisation detection, decay tracking, CTR benchmarking, traffic drop diagnosis. You ask a question, it runs the analysis and tells you what to do.

**Local and private.** No hosted middleman, no account, no plan. The server runs on your machine, tokens are cached on your machine, and your Search Console data travels directly between your machine and Google. The developer operates no servers and receives nothing. Read only scope by default.

**Hallucination guardrails.** Every tool instructs Claude to base analysis only on returned data. Provenance metadata in every response. The `verify_claim` tool lets Claude fact-check its own numbers. Credit to [Krinal Mehta](https://www.linkedin.com/in/krinal/) for pushing this.

**Visual dashboards.** Results render as rich, interactive visualisations in Claude Desktop. Summary cards, colour coded indicators, bar charts, and tabbed sections. Not plain text dumps.

**Fresh data.** Uses `dataState: 'all'` so data matches the GSC dashboard, not 2-3 days stale.

**Proactive, not reactive.** Alerting, content recommendations, and scheduled reports catch problems before you think to look.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GSC_AUTH_MODE` | No | `oauth` or `service_account` (default: `service_account`) |
| `GSC_KEY_FILE` | Service account mode | Path to service account JSON key |
| `GSC_OAUTH_SECRETS_FILE` | OAuth mode | Path to OAuth client secrets JSON |
| `GSC_OAUTH_CLIENT_ID` | OAuth mode (alt) | OAuth client ID |
| `GSC_OAUTH_CLIENT_SECRET` | OAuth mode (alt) | OAuth client secret |
| `GSC_SITE_URL` | No | Default GSC property, used only when a tool is called without `site_url`. Optional since v3.0.0: callers that always pass `site_url` need no default |
| `GSC_SITE_URLS` | No | Comma-separated list; supplies `multi_site_dashboard`'s default set of properties |
| `GSC_SCOPES` | No | `readonly` or `full` (default: `full`). Read only keeps the Google consent to a single view permission; submission tools then explain how to upgrade |

### Remote mode only

| Variable | Required | Description |
|----------|----------|-------------|
| `GSC_HTTP_TOKEN` | Yes, in HTTP mode | Shared bearer token clients must present. Minimum 24 characters; the server refuses to start without it. Generate with `openssl rand -hex 32` |
| `GSC_HTTP_ALLOWED_HOSTS` | Behind a proxy | Comma-separated public hostnames allowed in the `Host` header. Missing entries cause `403` |
| `GSC_HTTP_PORT` | No | Listen port (default `8787`) |
| `GSC_HTTP_HOST` | No | Bind address (default `127.0.0.1`; the container sets `0.0.0.0`) |
| `GSC_HTTP_IDLE_TIMEOUT_MS` | No | Close sessions idle longer than this (default 1800000, i.e. 30 minutes) |

## Full guide

Step-by-step setup with screenshots, use cases, and examples:

**[suganthan.com/blog/google-search-console-mcp-server/](https://suganthan.com/blog/google-search-console-mcp-server/)**

## Changelog

*Versions 3.x are this fork; 2.x and earlier are upstream's.*

**v3.1.0** Remote mode. The server can run as a hosted HTTP service over Streamable HTTP (`node dist/index.js http`), serving the same 30 tools to Claude clients that are not on the same machine. Tool registration moved into a `createServer()` factory because each session needs its own `McpServer` instance — `server.connect()` binds one server to one transport. Sessions are tracked with client-initiated teardown via `DELETE /mcp` and an idle sweeper; `/healthz` reports liveness and active session count without auth. Auth is a shared bearer token (`GSC_HTTP_TOKEN`, constant-time compared, minimum 24 characters, server refuses to start without it) — enough for Claude Code, while the claude.ai and Desktop connector UIs need the per-user OAuth of the next phase. Two tools adapt to being remote: `generate_report` returns markdown inline rather than writing to the server's disk, and `image_page_audit` resolves every target and refuses private, loopback, and link-local addresses, re-checking each redirect hop, because hosted it fetches from inside a network usually shared with internal services. Ships a Dockerfile and compose file that publish to loopback only for a reverse proxy to terminate TLS, with memory capped so a large Search Analytics result cannot starve neighbouring services. Full runbook in [Remote mode](#remote-mode-v310).

**v3.0.0** Multi-property support, and the fork point. Every property-scoped tool takes an optional `site_url`, so one server process covers a whole Search Console account instead of the single property named by `GSC_SITE_URL`; 16 tools gained the parameter that the newer image-search tools already had. New `list_properties` exposes `sites.list` at runtime, which upstream only called inside its setup wizard, so the exact property strings can be discovered rather than guessed. `generate_report` and `content_recommendations` thread the property into the tools they compose internally. Every response reports the property it used in `_meta.parameters.site_url`. `GSC_SITE_URL` became optional. Addresses upstream [issue #9](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP/issues/9).

**v2.5.1** Three fixes from the issue queue. The sitemaps tools now call `sc-domain:` properties as-is, which the Sitemaps API supports and always has; the old URL-prefix rewrite manufactured a 403, blamed the API for it, and on some accounts silently returned a stale URL-prefix property's sitemap list instead of the domain property's. The rewrite survives only as a fallback for accounts whose permission genuinely lives on a URL-prefix property. Credit to [pauljlange](https://github.com/pauljlange) for proving the premise wrong with raw API calls. Service-account mode now requests the same scope set as the OAuth flow, so `submit_url` and `submit_batch` work with service accounts and the `GSC_SCOPES=readonly` tier applies there too; the OAuth half of this shipped earlier via [tomschmidty12-sys](https://github.com/tomschmidty12-sys)'s PR after [stuli1989](https://github.com/stuli1989) reported it. And the Google client libraries are bumped (googleapis 144 to 176, google-auth-library 10, gaxios 7) so token fetches use Node's native fetch; the old node-fetch path failed to decompress Google's gzip token responses on Node 22 and newer, which broke service accounts, most visibly on Windows. Credit to [wilotas](https://github.com/wilotas) for the full diagnosis and the verified fix. Also fixed: the one-click desktop bundle. Every previous `.mcpb` shipped without the googleapis package internals (the packer silently pruned them), so the extension could never start, and "Unable to connect to extension server" was this bug, not your config. The v2.5.1 bundle carries the complete production dependency tree and was runtime-tested against the live API before upload, which is why it is bigger. Credit to [VeloWulf](https://github.com/VeloWulf) for the report.

**v2.5.0** Image page audit. `image_page_audit` fetches up to 5 pages from your own site and audits every image on them against the on-page factors that decide image-search performance: missing, empty, generic, filename-as-alt or duplicate alt text, camera-default and stock-agency-default filenames (shutterstock_524347192.jpg tells Google nothing), missing width/height attributes, lazy loading on the LCP candidate, srcset coverage, file format and weight (flags photos shipped as PNG and anything over 500KB), intrinsic dimensions against Google's ~250x200 indexing minimum, ImageObject and licensable-field schema, primaryImageOfPage, max-image-preview, inline background images, and the metadata inside the image files via exifr: camera EXIF and GPS that should be stripped, IPTC Creator/Copyright/Caption that should survive your CMS, and XMP DigitalSourceType on AI-generated images. Returns per-image findings, page-level checks, and an ordered top_fixes list. Pairs with `image_impressions_no_clicks` and `image_search_quick_wins`: those name the pages, this names the reasons. Fetches only the URLs it is given, so the privacy model is unchanged: your data goes to Google and your own site and nowhere else. New dependencies: node-html-parser, image-size, exifr (all pure JS, no native builds). The 7 image-search analysis tools also gain the optional `site_url` override that `advanced_search_analytics` already had, so any of them can be pointed at any property your credentials can see without editing the config. Launch post with the full workflow on real client data: ["One Page Earned 102,657 Image Impressions and 2 Clicks"](https://suganthan.com/blog/gsc-mcp-image-seo-tools/).

![Per-image findings from image_page_audit](screenshots/image-page-audit.jpg)

**v2.4.0** Generative AI conversation queries. `genai_conversation_queries` finds the AI conversation fragments hiding in your regular query data and sorts them into seven kinds: reply artefacts ("yes", "go on"), pivot follow-ups ("what about resend?"), conversational questions, tracker probes, agent harnesses, pasted strings, and a review pile. Google counts every AI Mode follow-up as a brand new query, so these rows carry real impressions, positions and clicks, and the dedicated Generative AI report has no query view, which makes this the only query-level AI evidence available anywhere. One call classifies sixteen months of your queries, attaches landing pages via query and page grouping, and returns a monthly reply-artefact timeline. Plain Search Analytics API, no BigQuery, no new permissions. Full method and findings: [the launch post](https://suganthan.com/blog/ai-mode-queries-search-console/). Sparked by [Anastasia Kourou surfacing the queries](https://www.linkedin.com/posts/anastasia-kourou-4b393034_hi-john-mueller-i-am-noticing-some-unusual-share-7489988919229353984-FJ0m/) with John Mueller confirming the mechanism, and by [Ross Tavendale asking](https://x.com/rtavs/status/2084710985298780579) how to reverse engineer it.

![Reply artefact queries classified by the new tool](screenshots/genai-conversation-queries.jpg)

**v2.3.0** Image SEO suite and one command setup. 7 new tools that pass `type=image` to the GSC Search Analytics API, plus a `type` parameter on `advanced_search_analytics` covering all 6 GSC search surfaces (web, image, video, news, discover, googleNews). The image-search surface was invisible to most third-party SEO tools because they default to `type=web` and never expose the others; v2.3 makes it queryable end-to-end. Also new: `npx suganthan-gsc-mcp setup`, a wizard that signs you in, verifies the connection with a live call, and writes your Claude Desktop and Claude Code configs; a read only scope tier (`GSC_SCOPES=readonly`, now the setup default) so the standard consent asks for one view permission; and a one click Claude Desktop bundle (`.mcpb`) on the releases page.

**v2.2.2** Published to npm as `suganthan-gsc-mcp`. Config can now use `npx` instead of a local checkout path.

**v2.2.1** Fixed OAuth EADDRINUSE crash when multiple tool calls triggered concurrent authentication flows. The server now reuses the active auth session instead of spawning duplicate listeners. Thanks to [Rushabh Rathod](https://github.com/rushabhhh) for finding and reporting this.

**v2.2.0** Visual dashboard rendering. All analysis tools now produce rich, interactive visualisations in Claude Desktop with summary cards, colour coded indicators, bar charts, and tabbed sections instead of plain text output. No reinstall needed, just restart Claude Desktop.

![Visual dashboard rendering in Claude Desktop](screenshots/visual-dashboard.jpg)

**v2.1.0** Added Indexing API tools: submit\_url, submit\_batch, submit\_sitemap, list\_sitemaps. Request Google to crawl and index pages directly from Claude.

**v2.0.0** Added OAuth authentication, advanced search analytics, check\_alerts, content\_recommendations, generate\_report, multi\_site\_dashboard, verify\_claim. Server grew from 10 to 16 tools.

**v1.1.0** Added hallucination guardrails: explicit prompts in tool descriptions, data provenance metadata in responses, and verify\_claim self-checking tool. Thanks to [Krinal Mehta](https://www.linkedin.com/in/krinal/) for the feedback.

**v1.0.0** Initial release with 10 analysis tools and service account authentication.

## Licence

Apache 2.0

Built by [Suganthan Mohanadasan](https://suganthan.com). If you find it useful, star it.
