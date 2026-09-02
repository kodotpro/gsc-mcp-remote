# Contributing

Thanks for looking. Issues and pull requests are both welcome.

This is a fork of [Suganthan Mohanadasan's GSC MCP](https://github.com/Suganthan-Mohanadasan/Suganthans-GSC-MCP),
and the two projects have diverged — so **please report problems with this
server here**, not upstream. If a bug clearly comes from the shared analysis
logic and reproduces on upstream too, saying so in the issue is helpful, and
worth reporting there as well so both benefit.

For anything security-related, do not open a public issue: see
[SECURITY.md](SECURITY.md).

## Getting set up

Node 18+ builds and runs everything except per-user OAuth mode, which needs
Node 24+ for `node:sqlite`.

```bash
git clone https://github.com/kodotpro/gsc-mcp-remote.git && cd gsc-mcp-remote
```

```bash
npm ci && npm run build && npm test
```

`npm test` needs no Google credentials — every suite either mocks Google or
never reaches it. If it passes on a clean clone, your environment is fine.

```bash
npm run dev      # tsc --watch
npm run typecheck
```

## Before you open a pull request

```bash
npm run typecheck && npm run build && npm test
```

All four suites must pass. CI runs the same ones across Node 18, 20, 22 and 24,
plus a dependency-advisory gate.

A few things reviewers will look for:

- **A test that would have failed before.** Especially for a bug fix: the
  hardening suite exists because every check in it failed before its fix landed.
  Please keep that property.
- **`site_url` on any new property-scoped tool.** `scripts/check-tools.mjs`
  asserts the split (currently 26 tools accept it, 7 are property-independent by
  design) and will fail if a tool silently loses the parameter. Update the
  expected counts there when you add a tool, and the tables in the README.
- **Per-user safety.** Tools reach Google through `getSearchConsoleClient()` and
  resolve their property through `resolveSiteUrl()`, both in `src/auth.ts`. Those
  two functions are what make a tool work per-user in hosted mode without
  knowing anything about users. Do not call `google.options()` from a tool — it
  is process-global, so in hosted mode it would act as the server rather than as
  the caller.
- **Honest documentation.** The README and the privacy page make specific
  promises, and tests assert some of them. If a change makes a documented claim
  untrue, change the claim in the same commit.

## How the code is laid out

| Path | What it is |
|---|---|
| `src/index.ts` | stdio entry point; also dispatches `setup` and `http` |
| `src/server-factory.ts` | Every tool registration, inside `createServer()` |
| `src/http.ts` | The remote HTTP entry: both auth modes, sessions, limits |
| `src/auth.ts` | Credential and property resolution — the per-user funnel |
| `src/auth/` | The OAuth authorization server: provider, storage, vault, consent |
| `src/request-context.ts` | Per-request user context via `AsyncLocalStorage` |
| `src/net-guard.ts` | SSRF classification and the bounded fetch |
| `src/tools/` | One file per tool's implementation |
| `src/web-pages.ts` | The public `/` and `/privacy` pages |
| `scripts/` | The four credential-free suites, plus the local OAuth rehearsal |

`createServer()` is a factory rather than a singleton because
`server.connect()` binds one server to one transport, and HTTP mode needs a
fresh instance per session.

Two implementation facts worth knowing before you fight them:

- The project compiles to **CommonJS** (`module: Node16`, no `"type": "module"`),
  so `import.meta.url` will not compile — use `__dirname`.
- The SDK's auth modules must be **statically** imported. TypeScript preserves
  dynamic `import()` in CJS output, which loads the SDK's ESM copy, and then
  `instanceof` checks against its error classes fail against the CJS provider's.
  Only `./auth/*` is lazily imported, so that older Node never touches
  `node:sqlite`.

## Style

Match the file you are in. Comments explain *why* rather than restating the
code — several of them record a bug that a plausible-looking change would
reintroduce, so please read them before simplifying past one.

Commit messages: a short imperative subject, then prose explaining the reasoning
if it is not obvious. No strict convention beyond that.

## Adding a tool

1. Implement it in `src/tools/`, taking an optional `siteUrl` parameter if it is
   property-scoped.
2. Register it in `src/server-factory.ts`, using the shared `SITE_URL_PARAM` and
   wrapping the result with `withMeta(...)` so provenance is reported.
3. Update the expected counts in `scripts/check-tools.mjs`.
4. Add it to the tool tables in the README, and bump the count in the heading,
   `package.json` and `manifest.json`.

## Licence

By contributing you agree your contribution is licensed under Apache-2.0, the
same as the project. Please keep `LICENSE` and `NOTICE` intact — Apache-2.0 §4
requires retaining the original author's copyright, and `NOTICE` is where this
fork's changes are recorded.
