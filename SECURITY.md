# Security policy

This project can hold other people's Google credentials. A deployment in
per-user mode stores an encrypted Google refresh token for everyone who signs
in, so security reports are taken seriously and fixed in the open.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting instead:

1. Go to the [Security tab](https://github.com/kodotpro/gsc-mcp-remote/security/advisories)
2. **Report a vulnerability**

That opens a private channel with the maintainer. If you cannot use it for any
reason, open a normal issue saying only that you have a security report and
would like a private channel — no details — and one will be arranged.

Please include, as far as you can:

- What an attacker can do, and what they need in order to do it
- The affected mode (`stdio`, `GSC_HTTP_AUTH=bearer`, `GSC_HTTP_AUTH=oauth`)
- A reproduction, ideally against a local instance
- The version or commit

You will get an acknowledgement within a few days. There is no bug-bounty
programme; credit in the release notes is offered gladly, and can be declined.

## Supported versions

Fixes land on `main` and are described in the README changelog. Only the latest
release is supported — this is a small project, and there are no backports.

## Threat model

What the design assumes, so that a report can say which assumption it breaks.

**Trusted:** the machine the server runs on, its filesystem, and the operator.
The vault key sits in a file next to the database; anyone with root on the box
can read both. Protecting against a compromised host is out of scope.

**Untrusted:** every HTTP caller, including one holding a valid token; every
argument any tool receives; every URL a tool is asked to fetch; and any client
that registers via dynamic client registration. Registration is deliberately
open to unauthenticated callers: claude.ai and Claude Desktop add a server from
a URL alone, which only works if a stranger can register. So the existence of
an unauthenticated `/register` is not a finding; what a registration can then
do is (below).

Specifically in scope for a report:

- Reading another user's Search Console data, or acting as another user
- Extracting a Google refresh token, or a usable MCP token, from the database
- Getting a token issued for an account that did not consent to it, including
  by approving the consent page on someone else's behalf or completing the
  Google leg in a different browser than the one that started it
- Getting a code delivered to a redirect URI the person was not shown
- Storing unbounded data through the open registration endpoint
- Reaching the host's private network or metadata endpoint through a tool
- Taking the process down as one authenticated caller among many
- Writing outside `GSC_REPORT_DIR`, or otherwise touching the host filesystem

Out of scope: anything requiring the operator's own credentials or shell access;
missing rate limits on a purely local `stdio` install; Google's own behaviour;
and the shared-token (`bearer`) mode's inherent property that everyone holding
the token shares one Google credential — that is what the mode is.

## What the implementation guarantees

Each of these is asserted by a test in `scripts/`, so a regression is a build
failure rather than a surprise:

- MCP tokens are random and stored only as SHA-256 hashes; the database holds
  no usable MCP token and no usable Google credential. (Registered clients'
  own secrets are stored as the SDK issues them: 256 random bits that mean
  something only together with a valid authorization code and PKCE verifier)
- Google refresh tokens are encrypted with AES-256-GCM under a key held outside
  the database, in a `0600` file. The database and its WAL/SHM files are `0600`
  too, whatever the host umask. The server refuses to start with a missing or
  mismatched key beside stored tokens instead of minting a new one (override:
  `GSC_ALLOW_NEW_VAULT_KEY=1`)
- Access tokens expire in an hour; refresh tokens rotate on use, and replaying a
  rotated one revokes every token that client held for that user
- Tokens are audience-bound (RFC 8707); one minted for another resource is
  rejected here
- A session belongs to the user who opened it; another user's valid token gets
  `403`
- `/authorize` stops at a consent page that names the requesting client and the
  full redirect URI that would receive the code, and warns unless that URI is a
  documented Claude callback or loopback. The client's name is self-reported and
  labelled unverified whenever the warning shows. That page cannot be framed
- Completing the flow needs the HttpOnly cookie set when `/authorize` was
  opened, so a consent approval or Google callback from a different browser is
  refused
- A registration is bounded: capped field and total size, at most ten redirect
  URIs, and a ceiling on stored registrations that evicts the oldest unused ones first and never a client that is partway through connecting.
  Redirect URIs must be https, or http on loopback only; private-use schemes
  such as `cursor://` are still accepted because desktop clients use them, and
  are always shown in full with the warning, apart from a short list that can
  never be a callback (`file:`, `blob:`, `mailto:`, `ms-*:` and similar)
- Revoking the Google grant erases the stored ciphertext rather than flagging it
- `disconnect_account` leaves no row for that user in any table
- `export_my_data` never returns the stored credential
- Caller-supplied URLs are refused when they resolve to private, loopback,
  link-local, CGNAT, reserved, IPv4-mapped/compatible/translated or NAT64
  addresses; the address is re-validated at connect time, and every redirect hop
  re-checked
- Fetches are bounded in both time and bytes. The HTML parser runs in a worker
  thread under a hard timeout, so a hostile page cannot stall the event loop all
  tenants share; exifr only ever sees a rebuilt PNG holding the few chunks it
  needs (it inflates a colour profile without limit); image dimensions are read by a
  first-party parser with no unbounded loops, dispatched on the format the
  file's own magic bytes declare rather than a server-supplied Content-Type
- Per-user mode requests `webmasters.readonly` for Search Console data, plus
  `openid` and `email` solely to identify the account; the write tools
  (`submit_url`, `submit_batch`, `submit_sitemap`) refuse to run in it, and
  `GSC_SCOPES` fails closed: unset or empty means `full`, and any other value
  that is not a spelling of read-only is read-only too, with a warning
- The per-user request budget counts JSON-RPC messages and applies to every
  `/mcp` request, so a batch, a session-churn loop or a probe against unknown
  sessions cannot sidestep it
- Every tool declares MCP annotations (`readOnlyHint`, `destructiveHint`,
  `openWorldHint`), which is what lets a client put its own approval prompt in
  front of a destructive call. `disconnect_account` takes a server-issued
  single-use token across two calls; that forces a second, separate call but is
  **not** an approval by the person (the token is returned to the same model), so
  the client's prompt for destructive tools is the real gate. `set_default_property`
  accepts only a property the account really has. Results from the data tools carry
  an `untrusted_text` notice, and the two tools that surface raw page attributes
  and search prompts (`image_page_audit`, `genai_conversation_queries`) cap and
  flatten that text (invisible and bidi characters included)

## Notes for operators

- **Back up the vault key separately from the database.** Litestream replicates
  the database only, by design: putting the key in the same bucket as the
  ciphertext it protects would defeat the encryption. Keep the 64 hex characters
  in a password manager.
- **Keep the container on loopback.** The compose file publishes to `127.0.0.1`
  deliberately; the reverse proxy should be the only thing that reaches it.
- **Prefer `readonly`** for any shared or hosted deployment.
- **Secure the host paths yourself.** The runbook's `chmod` steps cover `.env`,
  the data directory and the secrets. Other accounts on the same host can read
  what those permissions allow.
- **Behind Cloudflare, restore the client address in nginx** (see the runbook's
  "Behind Cloudflare"), or per-IP limits collapse onto the proxy's addresses.
- **Set `GSC_HTTP_ALLOWED_HOSTS`.** Binding `0.0.0.0` disables the SDK's
  localhost-only host check, so the public hostname must be listed explicitly.
- **No accepted advisories.** The tree is clean, and CI fails the build on any
  new `high`. The one advisory previously carried here — `image-size`'s
  unpatched ICNS/JXL/HEIF infinite loops (CVE-2025-71330, CVE-2025-71329) — was
  removed by dropping the dependency: `src/image-dimensions.ts` reads the two
  numbers we needed from the image header itself, with no unbounded loops.
