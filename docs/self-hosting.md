# Self-hosting

The public instance at [gsc.k-o.pro](https://gsc.k-o.pro) is the easy way in —
see the [README](../README.md) for that. This document is for running your own,
which you might want if you would rather your users' Google tokens sat on your
own hardware, or you need the write tools available remotely, or you are just
curious how it fits together.

Everything here is the same code the public instance runs.

## Contents

- [Pick an auth mode](#pick-an-auth-mode)
- [Try it locally before deploying](#try-it-locally-before-deploying)
- [Deploy with Docker](#deploy-with-docker)
- [Turn on per-user Google sign-in](#turn-on-per-user-google-sign-in)
- [Backups](#backups)
- [Operating it](#operating-it)
- [What remote mode changes](#what-remote-mode-changes)
- [Google verification](#google-verification)
- [Rehearse the real sign-in](#rehearse-the-real-sign-in)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Pick an auth mode

Pick an auth mode first:

| | `GSC_HTTP_AUTH=oauth` — per-user sign-in | `GSC_HTTP_AUTH=bearer` — shared secret (default) |
|---|---|---|
| Who connects | Anyone you allow, with **their own Google account** | Whoever holds the one token |
| What they see | **Their** properties; Google's permissions apply per person | Everything the server's single credential sees |
| claude.ai / Desktop connector UI | **Yes** — add by URL, OAuth is discovered | No (those UIs have no header field) |
| Claude Code | Yes, walks the OAuth flow | Yes, with `--header "Authorization: Bearer …"` |
| Runtime | Node 24+ | Node 18+ |

Bearer is the default so an existing deployment keeps working across an upgrade. OAuth mode is switched on explicitly, and forces the read-only Google scope.

## Try it locally before deploying

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

To rehearse the **per-user OAuth flow** with a real Google sign-in, see [Rehearse the real sign-in](#rehearse-the-real-sign-in) below.

## Deploy with Docker

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

## Turn on per-user Google sign-in

This is what makes the server usable by anyone with a Google account.

1. **OAuth consent screen:** External. While it is in **Testing** status only accounts you list as **test users** can sign in — that is your beta gate (100 users max, and refresh tokens expire weekly until the app is verified).
2. **Credentials → Create credentials → OAuth client ID → Web application**, with exactly this authorised redirect URI:
   ```
   https://gsc.example.com/oauth/google/callback
   ```
3. In `.env`: `GSC_HTTP_AUTH=oauth`, `GSC_PUBLIC_URL=https://gsc.example.com`, `GSC_GOOGLE_CLIENT_ID`, `GSC_GOOGLE_CLIENT_SECRET`, and `GSC_CONTACT_EMAIL`.
4. `docker compose up -d --build`

Optional extra gates: `GSC_ALLOWED_EMAILS`, `GSC_ALLOWED_EMAIL_DOMAINS`.

Going fully public also needs Google's verification for the sensitive Search Console scope. The server already serves the two pages that requires — a home page at `/` and a privacy policy at `/privacy` — and [`verification/`](verification/) has the runbook, scope justifications and demo-video script.

## Backups

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

## Operating it

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

## What remote mode changes

Two tools behave differently when the server is not on your own machine:

- **`generate_report`** returns markdown inline instead of writing a file, because a file would land on the server's disk where you could not retrieve it. When it does write, paths are confined to `GSC_REPORT_DIR`.
- **`image_page_audit`** refuses URLs resolving to private, loopback, link-local or reserved addresses — including the IPv4-mapped IPv6 forms that URL normalisation hides — re-validates the address at connect time so DNS cannot be rebound between check and connect, re-checks every redirect hop, and bounds each fetch with one deadline covering the body plus a byte ceiling.

`submit_url` and `submit_batch` refuse to run in per-user mode rather than quietly acting as the server's own credential.

---


## Google verification

Opening sign-in beyond a hand-picked list needs Google's verification for the
sensitive Search Console scope. Two facts shape the timeline:

- While the consent screen is in **Testing** status, only accounts you add as
  test users can sign in — 100 maximum — and their refresh tokens expire every
  seven days, so they re-consent weekly.
- Verification cannot be done first. Google requires a live home page, a privacy
  policy on the same domain, verified domain ownership, and a demo video of the
  real consent flow. Testing status is the mandatory beta stage, not a fallback.

This server already serves the two pages that requires, at `/` and `/privacy`,
built from `GSC_PUBLIC_URL`, `GSC_CONTACT_EMAIL` and `GSC_REPO_URL`. The
[`verification/`](verification/) directory has the runbook, the per-scope
justifications, and a demo-video script.

Search Console scopes are classified **sensitive**, not **restricted**, so there
is no third-party CASA security assessment to pay for — the cost is paperwork
and waiting.

## Rehearse the real sign-in


The suites above fake Google so they can run in CI. To exercise an **actual** sign-in before deploying, run the flow on your own machine — Google permits `http://localhost` redirects for Web-application clients, so you can add a loopback URI to the same client that serves production:

```bash
GSC_GOOGLE_CLIENT_ID=... GSC_GOOGLE_CLIENT_SECRET=... npm run try:oauth
```

It boots OAuth mode on `http://localhost:8787` with a throwaway database and vault key in a temp directory (deleted on exit, so your deployment is untouched), self-checks discovery, PKCE and the `401` challenge, then prints exactly what to do next. Register `http://localhost:8787/oauth/google/callback` on the client, and make sure your account is a listed **test user** — otherwise Google returns `access_denied` before the server's consent page is ever reached.

If the flow works there, the only things that can still differ on a server are TLS, DNS and the reverse proxy.

## Environment variables

Core credential and property variables are in the
[README](../README.md#configuration). These are the ones only a hosted
deployment needs.

### Transport

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

| Variable | Default | Description |
|---|---|---|
| `GSC_MAX_SESSIONS` | 120 | Concurrent MCP sessions server-wide; `503` beyond it |
| `GSC_MAX_SESSIONS_PER_USER` | 8 | Sessions one user may hold; `429` beyond it. `oauth` mode only |
| `GSC_RATE_LIMIT_PER_MIN` | 60 | Requests per user per minute; `429` with `Retry-After` |
| `GSC_MAX_TOTAL_ROWS` | 100000 | Rows one Search Analytics query may accumulate |
| `GSC_GOOGLE_TIMEOUT_MS` | 60000 | Deadline on each Google API call |
| `GSC_REPORT_DIR` | cwd | The only directory `generate_report` may write into |

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `403` from your server | The public hostname is missing from `GSC_HTTP_ALLOWED_HOSTS`. Binding `0.0.0.0` disables the SDK's localhost-only host check, so it must be listed explicitly |
| `502` from the proxy | The proxy cannot reach the container. Check `docker compose ps` and `docker compose logs` |
| `525` behind Cloudflare | Cloudflare cannot complete TLS to your origin — usually a missing or lapsed origin certificate for that hostname |
| Compose refuses to start | `GSC_HTTP_ALLOWED_HOSTS` is unset in `.env`; it is required rather than defaulted |
| `node:sqlite` error on start | OAuth mode needs Node 24+. Bearer mode and stdio work on 18+ |
| `access_denied` at Google | The account is not a listed test user on the consent screen |
| Connector UI won't accept your URL | Those UIs need OAuth; a shared bearer token has no header field there. Set `GSC_HTTP_AUTH=oauth` |

For the security model, the threat model, and operator notes, see
[SECURITY.md](../SECURITY.md).
