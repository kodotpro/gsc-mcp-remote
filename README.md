# Google Search Console MCP Server

**A Google Search Console MCP server that answers SEO questions instead of returning API rows — across every property in your account. Connect it to Claude by URL and sign in with Google. Nothing to install.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](#run-it-on-your-own-machine)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP%20%2B%20stdio-orange.svg)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

```
https://gsc.k-o.pro/mcp
```

Paste that into Claude as a custom connector, sign in with your Google account, and ask *"which pages lost the most traffic last month, and why?"* — you get a diagnosis: a ranking loss, a CTR collapse, or a demand decline. Not a spreadsheet you still have to read.

> **A fork with credit due.** The 29-tool foundation and the analysis logic behind it are [Suganthan Mohanadasan's](https://suganthan.com) work, from [Suganthan's GSC MCP](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP). This fork adds multi-property access and remote hosting on top. See [Credits](#credits).

---

## Contents

- [Why this one](#why-this-one)
- [What you can ask](#what-you-can-ask)
- [**Get connected**](#get-connected)
- [All 33 tools](#all-33-tools)
- [Run it on your own machine](#run-it-on-your-own-machine)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Credits](#credits)
- [Changelog](#changelog)

---

## Why this one

There are several Google Search Console MCP servers, and a growing number of SEO MCP servers generally. Two things make this one different.

**It covers your whole account, not one property.** Every property-scoped tool takes a `site_url` argument, and `list_properties` discovers what your credential can actually see. One install answers questions about all your sites — you never edit a config file and restart to look at a different one. (This is what upstream [issue #9](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP/issues/9) asked for.)

**It runs as a remote MCP server, with per-user Google sign-in.** Most MCP servers are local-only: one process, on one laptop, with one credential — which is why they cannot be shared, and why the claude.ai and Claude Desktop connector UIs cannot add them at all. This one runs as a hosted service over Streamable HTTP at [gsc.k-o.pro](https://gsc.k-o.pro): add it as an MCP connector by URL, sign in with your own Google account, and Google's own Search Console permissions decide what you see. Ten people share one deployment and each sees only their own properties — nobody copies a credential anywhere.

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

## Get connected

The server is hosted at **`https://gsc.k-o.pro/mcp`**. There is nothing to download, no API key to generate, and no config file to edit.

### claude.ai and Claude Desktop

**Settings → Connectors → Add custom connector**, then paste:

```
https://gsc.k-o.pro/mcp
```

### Claude Code

```bash
claude mcp add --transport http gsc https://gsc.k-o.pro/mcp
```

### What happens next

Your browser opens and you will see two screens, in this order:

1. **This server's own consent page**, naming the application that asked and the exact address the result goes to. Read it — it exists so that a connection request you did not start is refusable. Cancel if anything looks wrong.
2. **Google's sign-in**, asking for read-only Search Console access and your email address. Nothing else.

Then you are connected. Ask:

> "List my Search Console properties."

and go from there. Google's own Search Console permissions decide what you can see — this server cannot show you a property Google would not, and it never gains write access to anything.

### While it is in beta

Google requires an app to be verified before it can offer this kind of sign-in to the general public, and verification takes weeks. Until it completes, Google itself limits sign-in to accounts on an approved list (100 maximum). If sign-in fails with `access_denied`, that is why — [open an issue](https://github.com/kodotpro/gsc-mcp-remote/issues) to ask for access, and you will be added.

If you would rather not wait, or would rather your Google token never left your own machine, [run it locally](#run-it-on-your-own-machine) — it is the same 33 tools.

### Leaving

Two ways, either is enough:

- Ask Claude to run **`disconnect_account`**. It erases the stored Google connection, every token, and your saved settings, and ends your sessions immediately.
- Remove the app at **[myaccount.google.com/permissions](https://myaccount.google.com/permissions)**. The stored credential stops working, and the server erases it the next time it tries to use it.

`export_my_data` shows everything held about you at any time. Details in [Security and privacy](#security-and-privacy).

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

## Run it on your own machine

Everything above works without installing anything. But this is open source, and there are two good reasons to run it yourself: your Google token never leaves your machine, and local mode is the only mode with the **write tools** (sitemap submission and the Indexing API), which the hosted service deliberately does not offer.

Same 33 tools, running over stdio.

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

That is it — restart Claude and ask *"list my Search Console properties"*.

<details>
<summary><strong>Or configure it by hand</strong></summary>

In Claude Desktop's `claude_desktop_config.json`, or via `claude mcp add` for Claude Code:

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

**Requirements:** Node 18+. **Access level:** `GSC_SCOPES=readonly` (recommended) requests a single read-only Google permission; `full` adds the write tools.

### Or host it for other people

The same server runs as a remote MCP server with per-user Google sign-in — that is exactly what `gsc.k-o.pro` is. If you would rather your users' tokens sat on your own hardware, [docs/self-hosting.md](docs/self-hosting.md) covers the whole thing: Docker deployment, the reverse proxy, turning on per-user sign-in, Google verification, backups and the capacity limits.

---

## Configuration

These apply when you [run the server yourself](#run-it-on-your-own-machine). Using the hosted instance needs none of them.

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

The variables a hosted deployment adds — transport, per-user OAuth, capacity limits and backups — are documented in [docs/self-hosting.md](docs/self-hosting.md#environment-variables).

---

## Security and privacy

This server holds other people's Google credentials, so the design is worth stating plainly. Full policy and reporting instructions: [SECURITY.md](SECURITY.md).

**The OAuth sandwich.** In per-user mode the server issues **its own** opaque tokens to Claude, and holds your Google refresh token server-side, encrypted with AES-256-GCM under a key file kept outside the database. Claude never sees Google credentials; Google never sees MCP tokens.

**Token discipline.** MCP tokens are random and stored only as SHA-256 hashes, so a stolen database yields no working credentials. Access tokens live an hour; refresh tokens rotate on every use, and presenting an already-rotated one is treated as theft and burns every session it belonged to. Tokens are audience-bound per [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707).

**A consent screen of its own.** Dynamic client registration is open to any caller by design, so `/authorize` does not forward straight to Google. It stops at a page naming the requesting application and the exact host that would receive the result, warning when that host is not a Claude address. Google's own screen cannot show you that — it is branded with *this server's* app name. That page is unframeable (`X-Frame-Options: DENY`, `frame-ancestors 'none'`).

**Read-only by default.** Per-user mode requests exactly one Google scope, `webmasters.readonly`, and the write tools refuse to run in it.

**Your data, removable.** `export_my_data` shows everything held about you; `disconnect_account` erases the stored credential, every token and your settings, and ends your sessions. Revoking at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) cascades too: the next request fails, the stored credential is erased, and the client re-runs sign-in.

**Egress is guarded.** The one tool that fetches caller-supplied URLs classifies addresses on expanded IPv6 groups (covering the mapped, compatible, translated and NAT64 forms), validates at connect time to close the DNS-rebinding window, re-checks every redirect hop, and caps time and bytes. Image bytes are format-gated by magic number before any parser sees them.

### Self-checks

Four suites run with no Google credentials, so they are safe to run anywhere, and CI runs them on every push across Node 18, 20, 22 and 24:

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

---

## Troubleshooting

Using the hosted instance:

| Symptom | Cause |
|---|---|
| `access_denied` from Google | Your account is not yet on the approved list. See [While it is in beta](#while-it-is-in-beta) |
| The connector UI rejects the URL | Check it is exactly `https://gsc.k-o.pro/mcp`. Both `/mcp` and `/mcp/` work |
| "This session belongs to a different user" | A stale connector entry. Remove and re-add it |
| A tool says a property is not available | Google's own permissions apply. Confirm the account you signed in with has access in Search Console itself |
| `GSC_SITE_URL environment variable is required` | A tool was called without naming a property and you have no default. Name one, or run `set_default_property` |
| `429` or `503` with `Retry-After` | A capacity limit; wait the stated interval. See [the limits](docs/self-hosting.md#limits) |

Running it yourself: see [docs/self-hosting.md#troubleshooting](docs/self-hosting.md#troubleshooting).

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

**v3.5.0** — Capacity tuning, from measuring rather than guessing. The Search Analytics row ceiling now defaults to **25,000** instead of 100,000. Measured against the container's 384 MB heap, 100,000 rows cost ~24 MB as objects plus ~44 MB transient while the tool serialises its result — roughly 68 MB for one query, so four concurrent ones came within reach of the ceiling. At 25,000 the same query costs ~17 MB all-in, four times the headroom, and it shortens the event-loop stall that serialising a large payload causes on a shared vCPU. Google's own per-page maximum is 25,000, so this is still more than an analysis question needs, and truncation was always reported rather than hidden — raise `GSC_MAX_TOTAL_ROWS` on a box with memory to spare. `/healthz` now also reports process memory (heap used, the real V8 ceiling, the percentage between them, RSS) plus the row ceiling in force, so pressure can be watched instead of inferred; `heapUsedPercent` is the number worth alerting on.

**v3.4.1** — Fixes a dead "Continue to Google" button in per-user mode, introduced by v3.4.0's security headers. The consent form posts to `/oauth/consent` on the server's own origin, and that route answers `302` to `accounts.google.com` — but browsers apply `form-action` across the whole navigation, so `form-action 'self'` aborted the submission before it left the browser. Clicking the button did nothing at all, with only a CSP violation in the console to say why. `form-action` now lists Google explicitly, which is the only cross-origin navigation any form here performs. The test that should have caught this asserted the presence of `form-action 'self'` — the exact string that was wrong — so it passed throughout; it now checks that whatever host the consent POST actually redirects to is permitted by that same page's `form-action`, read from the live `Location` header rather than a hardcoded hostname. Both suites fail on the old header and pass on the new one.

**v3.4.0** — Follow-through on the v3.3.0 audit, plus the pieces a public deployment needs. **A regression in v3.3.0 is fixed:** the session caps applied the *per-user* ceiling to the whole server in bearer mode, because bearer requests carry no identity and every session's owner was therefore `null` — a single-tenant deployment stopped at 8 concurrent sessions while `/healthz` advertised 120. Bearer mode is now bounded by `GSC_MAX_SESSIONS` alone, `/healthz` reports the limits actually in force, and the HTTP suite pins all of it. **Dependencies:** eight of nine advisories cleared, and the MCP SDK moved to 1.30. The ninth, `image-size`, has no fixed release and unpatched infinite loops in its ICNS, JXL and HEIF readers; because that loop is synchronous no timeout can interrupt it, so `image_page_audit` now decides an image's format from its own magic bytes — never from an attacker-controlled `Content-Type` — and refuses to hand those families to the parser at all, reporting why instead of risking the process. **Google calls are now bounded** by `GSC_GOOGLE_TIMEOUT_MS`. **New public pages** at `/` and `/privacy`, served by the server itself, because Google's sensitive-scope verification requires a home page and a privacy policy on the callback's own domain; the test suite asserts the claims the policy makes are the ones the code keeps. The consent interstitial and both pages now carry `X-Frame-Options: DENY` and a `default-src 'none'` CSP. **Continuous backups** via an opt-in Litestream sidecar, with the vault key deliberately excluded from replication. **Regression tests for everything v3.3.0 shipped untested:** the session ceiling and its `503`, the rate limit and its `429`, both `Retry-After` headers, the idle sweeper, and the deletion/export guarantees. And `scripts/try-oauth-local.mjs` rehearses a real Google sign-in on `http://localhost` against a throwaway database.

**v3.3.0** — Security and resource hardening, from a production-readiness audit of v3.2.0 (seven independent reviewers, every finding adversarially verified). The SSRF guard missed IPv4-mapped IPv6 entirely: `http://[::ffff:127.0.0.1]/` normalises to the hex form `::ffff:7f00:1`, which the dotted-decimal check never matched, so loopback and the cloud metadata endpoint were both reachable from the hosted server. Address classification now works on expanded 16-bit groups. All fetching moved behind one helper that owns the whole request: the deadline now covers the response body, bytes are capped while streaming, addresses are re-validated at connect time, and every redirect hop is re-checked. `/authorize` gained the consent interstitial. Session and rate limits stop one caller exhausting the heap. Search Analytics pagination gained a row ceiling. `generate_report` writes only inside `GSC_REPORT_DIR`. New `disconnect_account` and `export_my_data` make the deletion and access controls the documentation described actually exist. `multi_site_dashboard` no longer throws when `GSC_SITE_URL` is unset — it was broken for exactly the multi-property configuration this fork exists to support. `submit_url`/`submit_batch` refuse to run in hosted per-user mode.

**v3.2.0** — Per-user Google sign-in. `GSC_HTTP_AUTH=oauth` turns the remote server into a full MCP OAuth authorization + resource server (discovery metadata, dynamic client registration, PKCE), so anyone can add it by URL in claude.ai, Claude Desktop, or Claude Code and sign in with their own Google account. The server mints its own opaque, hashed, rotating tokens; the user's Google refresh token is held server-side, AES-256-GCM-encrypted beside the SQLite database. Refresh-token reuse burns the client's sessions; a Google-side revocation cascades. Per-request user context flows through `AsyncLocalStorage`, so every tool became per-user without changing. Sessions are owner-bound. Requires Node 24+.

**v3.1.0** — Remote mode over Streamable HTTP. Tool registration moved into a `createServer()` factory, because `server.connect()` binds one server to one transport and HTTP mode needs a fresh instance per session. Sessions support client teardown plus an idle sweeper; `/healthz` reports liveness without auth. Auth is a shared bearer token, constant-time compared. `generate_report` returns markdown inline rather than writing to the server's disk, and `image_page_audit` refuses private targets. Ships a Dockerfile and compose file publishing to loopback only.

**v3.0.0** — Multi-property support, and the fork point. Every property-scoped tool takes an optional `site_url`, so one process covers a whole account instead of the single property named by `GSC_SITE_URL`; 16 tools gained the parameter the image-search tools already had. New `list_properties` exposes `sites.list` at runtime. `GSC_SITE_URL` became optional.

**v2.5.1 and earlier** — upstream history: the 29-tool baseline, the image-search suite, generative-AI conversation-query detection, OAuth and service-account support, and the read-only scope tier. See [upstream's changelog](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP#changelog).

---

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
