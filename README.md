# Google Search Console MCP Server - by k-o.pro (remote)

**A Google Search Console Remote MCP server that answers SEO questions instead of returning API rows — across every property in your account. Connect it to Claude by URL and sign in with Google. Nothing to install.**

[![build](https://github.com/kodotpro/gsc-mcp-remote/actions/workflows/build.yml/badge.svg)](https://github.com/kodotpro/gsc-mcp-remote/actions/workflows/build.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](#run-it-on-your-own-machine)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP%20%2B%20stdio-orange.svg)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

```
https://gsc.k-o.pro/mcp
```

Paste that into Claude as a custom connector, sign in with your Google account, and ask *"which pages lost the most traffic last month, and why?"* — you get a diagnosis: a ranking loss, a CTR collapse, or a demand decline. Not a spreadsheet you still have to read.

Guides on [gsc.k-o.pro](https://gsc.k-o.pro/): [claude.ai and Claude Desktop](https://gsc.k-o.pro/claude) · [Claude Code](https://gsc.k-o.pro/claude-code) · [AI Mode queries](https://gsc.k-o.pro/ai-mode-queries) · [self-hosting](https://gsc.k-o.pro/self-host)

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

[**Add to Claude**](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Google+Search+Console&connectorUrl=https%3A%2F%2Fgsc.k-o.pro%2Fmcp) opens claude.ai with the connector pre-filled; you confirm the address before anything connects.

Or by hand: **Settings → Connectors → Add custom connector**, then paste:

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

If you would rather your Google token never left your own machine, [run it locally](#run-it-on-your-own-machine) — it is the same 33 tools.

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
| `list_sitemaps` | Submitted sitemaps with status, errors, indexed counts | P |
| `set_default_property` | Save your own default property (hosted per-user mode) | P |
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

### Indexing and sitemaps (write tools)

These change something in Google, so they require `GSC_SCOPES=full` and are unavailable in hosted per-user mode, which requests the read-only scope only. Hosted mode runs the other 30 tools.

| Tool | What it does | P |
|------|--------------|---|
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

**Requirements:** Node 20+. **Access level:** `GSC_SCOPES=readonly` (recommended) requests a single read-only Google permission; `full` adds the write tools.

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

**A consent screen of its own.** Dynamic client registration is open to any caller by design, so `/authorize` does not forward straight to Google. It stops at a page naming the requesting application and the full redirect URI that would receive the result, warning unless that URI is a documented Claude callback or loopback, and labelling the application's self-chosen name as unverified when it does. Registrations are also bounded in size and count, and plain-`http` redirects to remote hosts are refused. Google's own screen cannot show you that — it is branded with *this server's* app name. That page is unframeable (`X-Frame-Options: DENY`, `frame-ancestors 'none'`).

**Read-only by default.** Per-user mode requests one Search Console scope, `webmasters.readonly` (plus `openid` and `email`, only to identify the account), and the write tools refuse to run in it.

**Your data, removable.** `export_my_data` shows everything held about you; `disconnect_account` erases the stored credential, every token and your settings, and ends your sessions. Revoking at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) cascades too: the next request fails, the stored credential is erased, and the client re-runs sign-in.

**Egress is guarded.** The one tool that fetches caller-supplied URLs classifies addresses on expanded IPv6 groups (covering the mapped, compatible, translated and NAT64 forms), validates at connect time to close the DNS-rebinding window, re-checks every redirect hop, and caps time and bytes. Image bytes are format-gated by magic number before any parser sees them.

### Self-checks

Four suites run with no Google credentials, so they are safe to run anywhere, and CI runs them on every push across Node 20, 22 and 24:

```bash
npm test
```

| Suite | Covers |
|---|---|
| `check-tools.mjs` | Every tool registers over stdio; the right ones expose `site_url`; every tool and parameter default the public pages print matches the registered schema |
| `check-http.mjs` | Health, token enforcement, sessions, the capacity limits and their `Retry-After`, the idle sweeper, the public pages and their anti-framing headers, that every self-hosted font the pages reference is actually served from `dist/`, and that every registered page is served, linked internally without a 404, listed in the sitemap and `/llms.txt`, and reachable at one URL only |
| `check-oauth.mjs` | The sandwich, PKCE, single-use codes, refresh rotation and reuse-burning, audience binding, the revocation cascade, DCR, cross-user session rejection, and that `disconnect_account` leaves no row anywhere |
| `check-hardening.mjs` | SSRF classification across 34 address forms, fetch deadlines and byte caps against a hostile server, redirect re-validation, report-path confinement, image format gating |

Every check in the hardening suite failed before its fix landed.

---

## Troubleshooting

Using the hosted instance:

| Symptom | Cause |
|---|---|
| `access_denied` from Google | Consent was declined or blocked: you pressed Cancel, or your Google Workspace admin restricts third-party apps. Try again, or ask your admin to allow the app |
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

**v3.9.0** — Fixes from a source-only security audit of v3.8.0 (Cloudflare's `security-audit` skill, standard profile: reconnaissance, 22 hunters over 33 coverage units, independent verification of every candidate). The audit could not execute anything, so its findings were leads rather than proven bugs; where a fix was cheap and the lead credible, it is fixed here and the test asserts the *attack fails*, not that a mechanism exists. A live check also found the database files world-readable on the reference deployment, which the audit's file-mode lead had flagged. The branch was then reviewed by four independent adversarial reviewers and mutation-tested (each bug reintroduced to confirm a test fails); both found real problems in the first version of these fixes, listed under "Corrected before release" below.

**Data files are private, and the vault key fails closed.** The SQLite database and its WAL/SHM files were created with the host umask, so a hand-created data directory left them `0644`: any other account on the host could read every user's email, token hashes and registered clients' secrets. The server now sets umask `077` before opening the database and tightens existing database files at start. A missing vault key beside stored tokens used to mint a fresh one and report healthy, leaving every stored Google token permanently undecryptable and, if anyone reconnected first, a database encrypted under two keys. The server now **refuses to start** when the key is missing, or opens none of the stored tokens, and says why. `GSC_ALLOW_NEW_VAULT_KEY=1` is the explicit recovery switch and it is **self-closing**: one flagged start creates the new key (a corrupt key file is moved aside, not deleted) and erases the connections the new key cannot open, so the next start needs no flag. The key is created with `wx`, repaired to `0600` where possible (a key that cannot be chmod-ed warns instead of bricking boot), and may be a symlink to a regular file. An entry that cannot be decrypted at request time erases that row and burns that user's MCP tokens, so their client re-runs sign-in instead of failing opaquely on every call.

**The rate limit counts what it should.** It sat inside the "request carries a session id" branch and charged one unit per HTTP request, so `initialize` (which allocates a whole `McpServer`), GET, DELETE and unknown-session probes were free, and a 100-message JSON-RPC batch cost the same as one message. It now applies to every `/mcp` request and charges per message; a batch larger than the whole budget is refused with `413` and a clear message instead of "retry in 60s" forever. `verifyAccessToken` no longer commits an `UPDATE` on every request: the activity stamp is written at most once a minute.

**Write tools and scopes fail closed.** `GSC_SCOPES` treated any value but the exact word `readonly` as full access, so a typo granted write and Indexing scopes; unset or empty still means `full`, but any other unrecognised value is now read-only, with a warning and an error message that names the bad value. `submit_url` consulted the tier only when `GSC_AUTH_MODE=oauth`, so a service-account install setting `GSC_SCOPES=readonly` was never refused; `submit_sitemap`'s hosted guard keyed on the same stdio-only setting. All three write tools now refuse in every mode under `readonly` and for any hosted per-user context.

**Model-reachable actions are no longer gated only by the model.** Tool results carry third-party text, and a model that reads it can be steered toward a tool that changes state. Every tool now declares MCP annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) from one table, with a test that every tool is classified; that is what lets a client put its own approval prompt in front of a destructive call, and it is the real gate. `disconnect_account` took a boolean the model supplies (`confirm: true`); it now takes a server-issued, single-use, user-bound, expiring token across two calls (**the parameter changed: `confirm` is replaced by `confirmation_token`**). That forces a second, separate call, but it is not an approval by the person, because the token is returned to the same model. `set_default_property` persisted any string as a trusted default echoed into every later result; it now requires a property shape and membership in the caller's own property list. Result envelopes of the data tools carry an `untrusted_text` notice, and the two tools that surface raw page attributes and search prompts, `image_page_audit` and `genai_conversation_queries`, cap and flatten that text, including invisible and bidi characters. `max_rows_per_bucket` and `max_images_reported` are bounded integers (values that previously worked above the limits are now rejected).

**`image_page_audit` can no longer be turned into a shared-process stall.** The HTML parser's cost cannot be predicted from outside: a 36 KB page of `<div></i>` repeated took 3 s to parse, 72 KB took 29 s, and a 407 KB page took over two minutes, all synchronous on the event loop every tenant shares. A heuristic pre-parse gate was tried first and reviewers bypassed it within minutes (optional-close tags the parser does not close, stray closers, tokenizer disagreements), so it was deleted: the real parser now runs in a worker thread under a hard timeout (`GSC_PARSE_TIMEOUT_MS`, default 2 s) and a memory ceiling, behind a two-worker limiter, and returns only the plain facts the audit reads. The tests measure the property that matters, that the main event loop never stalls, rather than whether a page was refused. exifr inflates a PNG colour profile with no limit and matches chunk names case-insensitively across every chunk, so the first fix (rename one spelling, stop after 4,096 chunks) was bypassed by `ICCP` or a profile placed after 5,000 text chunks; exifr is now given only a rebuilt PNG made from an allow-list of the chunks it needs, or nothing if the chunk structure cannot be walked. The tests prove the premise by spying on `zlib.inflateSync`. The SVG reader is linear over a 16 KB head (and now ignores percentage and `em` widths), a 90 s deadline stops a call starting new fetches, and the page byte cap is 2 MB. The trailing-slash middleware's `/\/+$/` regex was quadratic on a long run of slashes; on a request line near Node's 16 KB limit that is tens of milliseconds, so this was low impact, but it is a linear helper now. The callback's unauthenticated `error` parameter is allowlisted instead of being copied into a log line and onto the error page.

**Documentation made true.** The privacy page now carries the Limited Use statement Google's verification requires (and `docs/verification` said it already did), says sign-in also uses `openid` and `email` (as the landing page, FAQ, README and verification documents now do too, with a test pinning the scopes the code requests to the documents), and discloses backup retention. The runbook adds the `X-Forwarded-For` line the per-IP limits depend on, the `chmod`/`chown` steps, the backup profile in the deploy and update commands, the restore's `chown`, a "Behind Cloudflare" section (restoring the client address in nginx, Full (strict) TLS, origin lock-down) and corrects a sentence that promised truncation is reported when no tool reports it. `SECURITY.md` no longer says only `webmasters.readonly` is requested or that the database holds no credential-shaped value (registered clients' secrets are stored as issued); the two storage guarantees it asserted are now actually asserted by tests.

**Corrected before release.** Found by review and mutation testing, not by the audit: a Cloudflare command in the runbook that fused two address ranges into one invalid nginx directive; a `GSC_ALLOW_NEW_VAULT_KEY` that was documented as "for one start" but left stale rows that made the next start refuse to boot; a boot-time chmod that could brick startup on a read-only key file; a test whose blanket `console.error` override swallowed its own failure messages; the HTML gate and the PNG neutraliser described above; and `synchronous=NORMAL`, which was dropped because its latency benefit disappeared with the per-request write while its risk (losing recent revocations on power loss) did not.

**v3.8.0** — The public site grows from one page to a small set of guides, and the product gets one name everywhere: **Google Search Console MCP Server - by k-o.pro (remote)**, used verbatim in the page title, the h1, the structured data and this README. New pages: setup for [claude.ai and Claude Desktop](https://gsc.k-o.pro/claude) and [Claude Code](https://gsc.k-o.pro/claude-code), one page per tool group with every parameter's default, an [AI Mode queries](https://gsc.k-o.pro/ai-mode-queries) page for `genai_conversation_queries`, and [self-hosting](https://gsc.k-o.pro/self-host). The landing page adds real tool responses (captured from the hosted instance against k-o.pro and shown as returned, trimmed only where the caption says so), a comparison written as the questions to ask of any Search Console MCP server, a byline with version and date, and two answers people search for: no Google Cloud project is needed for the hosted instance, and Google does not list an official Search Console MCP server (checked 2026-10-13). Also new: a favicon set, a 1200×630 social card, `/llms.txt`, a `SoftwareApplication` schema with author, version, date and feature list, and per-page `TechArticle` and `BreadcrumbList` data.

Full notes for this release and every earlier one, back to the v3.0.0 fork point: [CHANGELOG.md](CHANGELOG.md).

---

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
