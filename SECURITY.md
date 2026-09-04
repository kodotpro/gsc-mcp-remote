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
that registers via dynamic client registration, which is deliberately open to
unauthenticated callers as the MCP specification intends.

Specifically in scope for a report:

- Reading another user's Search Console data, or acting as another user
- Extracting a Google refresh token, or a usable MCP token, from the database
- Getting a token issued for an account that did not consent to it
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
  nothing directly usable as a credential
- Google refresh tokens are encrypted with AES-256-GCM under a key held outside
  the database, in a `0600` file
- Access tokens expire in an hour; refresh tokens rotate on use, and replaying a
  rotated one revokes every token that client held for that user
- Tokens are audience-bound (RFC 8707); one minted for another resource is
  rejected here
- A session belongs to the user who opened it; another user's valid token gets
  `403`
- `/authorize` stops at a consent page that names the requesting client and the
  exact host that would receive the code, and warns when it is not a Claude
  address. That page cannot be framed
- Revoking the Google grant erases the stored ciphertext rather than flagging it
- `disconnect_account` leaves no row for that user in any table
- `export_my_data` never returns the stored credential
- Caller-supplied URLs are refused when they resolve to private, loopback,
  link-local, CGNAT, reserved, IPv4-mapped/compatible/translated or NAT64
  addresses; the address is re-validated at connect time, and every redirect hop
  re-checked
- Fetches are bounded in both time and bytes; image dimensions are read by a
  first-party parser with no unbounded loops, dispatched on the format the
  file's own magic bytes declare rather than a server-supplied Content-Type
- Per-user mode requests only `webmasters.readonly`, and the write tools refuse
  to run in it

## Notes for operators

- **Back up the vault key separately from the database.** Litestream replicates
  the database only, by design: putting the key in the same bucket as the
  ciphertext it protects would defeat the encryption. Keep the 64 hex characters
  in a password manager.
- **Keep the container on loopback.** The compose file publishes to `127.0.0.1`
  deliberately; the reverse proxy should be the only thing that reaches it.
- **Prefer `readonly`** for any shared or hosted deployment.
- **Set `GSC_HTTP_ALLOWED_HOSTS`.** Binding `0.0.0.0` disables the SDK's
  localhost-only host check, so the public hostname must be listed explicitly.
- **No accepted advisories.** The tree is clean, and CI fails the build on any
  new `high`. The one advisory previously carried here — `image-size`'s
  unpatched ICNS/JXL/HEIF infinite loops (CVE-2025-71330, CVE-2025-71329) — was
  removed by dropping the dependency: `src/image-dimensions.ts` reads the two
  numbers we needed from the image header itself, with no unbounded loops.
