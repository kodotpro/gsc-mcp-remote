/**
 * HTTP entry point — the remote mode.
 *
 * Two authentication modes, chosen by GSC_HTTP_AUTH:
 *
 * - "bearer" (default): one shared secret, one Google credential for every
 *   request. Works with Claude Code's --header flag. This is the original
 *   remote mode and stays the default so existing deployments keep working
 *   over a plain `git pull && docker compose up --build`.
 *
 * - "oauth": the public multi-user mode. The server implements the MCP
 *   authorization spec (discovery metadata, dynamic client registration,
 *   PKCE) via the SDK's auth router, and each person signs in with their own
 *   Google account. Google's own property permissions then decide what each
 *   user can see. This is what the claude.ai and Claude Desktop connector
 *   UIs require — with it, the server can be added by URL alone.
 *
 * OAuth-mode modules (node:sqlite among them) are imported lazily inside the
 * oauth branch, so bearer mode and stdio keep running on older Node versions.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import type { Server as HttpServer } from "node:http";

import express, { type Request, type RequestHandler, type Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Static (CJS) imports for the SDK's auth pieces: the provider throws the
// SDK's error classes, and instanceof checks only hold when middleware and
// provider share the SAME copy. A dynamic import() here would load the ESM
// build and break that (dual-package hazard). These modules don't need
// node:sqlite, so loading them eagerly costs older-Node stdio nothing.
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";

import { createServer, SERVER_VERSION } from "./server-factory.js";
import { setRemoteMode } from "./runtime.js";
import { runWithUserContext, type UserContext } from "./request-context.js";
import { deniedPage } from "./auth/consent.js";
import { landingPage, privacyPage, type SiteInfo } from "./web-pages.js";

type HttpAuthMode = "bearer" | "oauth";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  /** Owner of the session in oauth mode; null in bearer mode. */
  userId: string | null;
  lastSeen: number;
  createdAt: number;
}

const sessions = new Map<string, Session>();
const startedAt = Date.now();

/** Sessions untouched for this long are closed by the sweeper. */
const IDLE_TIMEOUT_MS = Number(process.env.GSC_HTTP_IDLE_TIMEOUT_MS ?? 30 * 60 * 1000);
/** How often the idle sweep runs. Configurable so tests need not wait a minute. */
const SWEEP_INTERVAL_MS = Number(process.env.GSC_HTTP_SWEEP_INTERVAL_MS ?? 60 * 1000);

/**
 * Capacity limits.
 *
 * Each session holds its own McpServer with all 31 tools registered, measured
 * at ~440 KB. Without a ceiling, roughly 900 initialize calls exhaust the
 * container's 384 MB heap and abort the process — so one caller could take
 * every other tenant down. These are the backstops.
 */
const MAX_SESSIONS = Number(process.env.GSC_MAX_SESSIONS ?? 120);
const MAX_SESSIONS_PER_USER = Number(process.env.GSC_MAX_SESSIONS_PER_USER ?? 8);
/** Tool calls allowed per user per minute (bearer mode counts as one user). */
const RATE_LIMIT_PER_MIN = Number(process.env.GSC_RATE_LIMIT_PER_MIN ?? 60);

/** Sliding-window counters, keyed by user id (or "shared" in bearer mode). */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimitExceeded(key: string): { limited: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return { limited: false, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_PER_MIN) {
    return { limited: true, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { limited: false, retryAfter: 0 };
}

/**
 * How many live sessions one identified user holds.
 *
 * Only meaningful in oauth mode. In bearer mode every session's owner is null
 * (one shared credential, no per-request identity), so counting nulls here
 * would apply the PER-USER ceiling to the WHOLE server: the 9th session of a
 * single-tenant deployment was rejected with "you already have 8 open
 * sessions" while /healthz advertised a limit of 120. Bearer sessions are
 * bounded by MAX_SESSIONS alone, which is the only limit that has a meaning
 * when there is exactly one tenant.
 */
function sessionsOwnedBy(userId: string | null): number {
  if (userId === null) return 0;
  let n = 0;
  for (const s of sessions.values()) if (s.userId === userId) n++;
  return n;
}

/** Both /mcp and /mcp/ must work: connector UIs get pasted either form. */
const MCP_PATHS = ["/mcp", "/mcp/"];

function httpAuthMode(): HttpAuthMode {
  const raw = (process.env.GSC_HTTP_AUTH ?? "bearer").toLowerCase();
  if (raw === "oauth") return "oauth";
  if (raw === "bearer") return "bearer";
  throw new Error(`GSC_HTTP_AUTH must be "bearer" or "oauth", got "${raw}".`);
}

// ---------------------------------------------------------------------------
// Bearer mode plumbing (unchanged behaviour from the first remote release)
// ---------------------------------------------------------------------------

function requiredSharedToken(): string {
  const token = process.env.GSC_HTTP_TOKEN?.trim();
  if (!token || token.length < 24) {
    throw new Error(
      "GSC_HTTP_TOKEN must be set to a secret of at least 24 characters before bearer-mode HTTP will start. " +
      "This token is the only thing standing between the public internet and your Search Console data. " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  return token;
}

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sharedTokenMiddleware(expected: string): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    const presented = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    if (!presented || !tokenMatches(presented, expected)) {
      res.status(401)
        .set("WWW-Authenticate", 'Bearer realm="gsc-mcp"')
        .json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized: provide a valid bearer token." },
          id: null,
        });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------

/** Fully-escaped error page; browser-facing OAuth routes render through this. */
function errorPage(heading: string, detail: string): string {
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
     .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(heading)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;` +
    `line-height:1.6;color-scheme:light dark;background:Canvas;color:CanvasText}</style></head><body>` +
    `<h2>${esc(heading)}</h2><p>${esc(detail)}</p>` +
    `<p>Close this tab and start the connection again from your Claude client.</p></body></html>`;
}

async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  try {
    await session.transport.close();
  } catch {
    // already gone
  }
  try {
    await session.server.close();
  } catch {
    // already gone
  }
}

export async function startHttpServer(): Promise<HttpServer> {
  setRemoteMode(true);

  const mode = httpAuthMode();
  const port = Number(process.env.GSC_HTTP_PORT ?? 8787);
  const host = process.env.GSC_HTTP_HOST ?? "127.0.0.1";

  // -- host allow-list (Host-header validation behind the reverse proxy) -----
  const allowedHosts = (process.env.GSC_HTTP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const defaultHosts = [`localhost:${port}`, `127.0.0.1:${port}`, "localhost", "127.0.0.1"];

  // -- oauth-mode assembly ----------------------------------------------------
  let oauth:
    | {
        provider: import("./auth/provider.js").GscOAuthProvider;
        factory: import("./auth/google-clients.js").UserClientFactory;
        publicUrl: string;
        resourceMetadataUrl: string;
        authMiddleware: RequestHandler;
      }
    | undefined;

  if (mode === "oauth") {
    const publicUrlRaw = process.env.GSC_PUBLIC_URL?.trim();
    if (!publicUrlRaw) {
      throw new Error(
        "OAuth mode needs GSC_PUBLIC_URL — the URL clients reach this server at, e.g. https://gsc.example.com. " +
        "It becomes the OAuth issuer, the token audience, and the base of the Google callback."
      );
    }
    const publicUrl = publicUrlRaw.replace(/\/+$/, "");

    // The user's own Google credential enforces read-only at the API level in
    // this mode; the env tier is forced to match so the write tools refuse
    // clearly instead of failing confusingly.
    process.env.GSC_SCOPES = "readonly";

    // Lazily imported so bearer/stdio never touch node:sqlite.
    let authModules;
    try {
      authModules = {
        db: await import("./auth/db.js"),
        crypto: await import("./auth/crypto.js"),
        identity: await import("./auth/google-identity.js"),
        provider: await import("./auth/provider.js"),
        clients: await import("./auth/google-clients.js"),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("node:sqlite")) {
        throw new Error(
          `OAuth mode stores users and tokens in SQLite via node:sqlite, which this Node runtime (${process.version}) does not provide. ` +
          "Run OAuth mode on Node 24+ (the provided Docker image does). Bearer mode and stdio work on older Node."
        );
      }
      throw err;
    }

    const home = process.env.HOME ?? os.homedir();
    const dbPath = process.env.GSC_OAUTH_DB_FILE ?? path.join(home, ".gsc-mcp", "oauth-server.db");
    const keyPath = process.env.GSC_VAULT_KEY_FILE ?? path.join(home, ".gsc-mcp", "vault.key");

    const db = authModules.db.openAuthDb(dbPath);
    const vaultKey = authModules.crypto.loadOrCreateVaultKey(keyPath);
    const identity = authModules.identity.googleIdentityFromEnv(publicUrl);
    const resourceUrl = `${publicUrl}/mcp`;
    const provider = new authModules.provider.GscOAuthProvider({ db, vaultKey, identity, resourceUrl });
    const factory = new authModules.clients.UserClientFactory(provider, identity);

    const resourceMetadataUrl = `${publicUrl}/.well-known/oauth-protected-resource/mcp`;
    const authMiddleware = requireBearerAuth({
      verifier: provider,
      resourceMetadataUrl,
    });

    oauth = { provider, factory, publicUrl, resourceMetadataUrl, authMiddleware };

    // Public host must pass Host-header validation without extra config.
    const publicHost = new URL(publicUrl).host;
    if (!allowedHosts.includes(publicHost)) allowedHosts.push(publicHost);
  }

  const sharedToken = mode === "bearer" ? requiredSharedToken() : undefined;

  const hostAllowlist = [...new Set([...allowedHosts, ...defaultHosts])];
  const app = createMcpExpressApp({ host, allowedHosts: hostAllowlist });
  app.set("trust proxy", 1);

  /**
   * Browser hardening for the HTML this server serves.
   *
   * The consent interstitial exists to make one fact refusable: which client
   * receives the authorization result. Framing it would defeat that, so it
   * must not be frameable. There is no JavaScript anywhere in these pages, so
   * the policy can be maximally strict — `default-src 'none'` with inline
   * styles the only exception, and form submissions confined to this origin.
   * The headers are harmless on the JSON routes.
   */
  app.use((_req: Request, res: Response, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; " +
      "frame-ancestors 'none'; base-uri 'none'"
    );
    // Ignored by browsers over plain http, so it is safe to set unconditionally.
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  // -- public pages -----------------------------------------------------------
  // Google's verification for a sensitive scope requires a home page and a
  // privacy policy on the same domain as the OAuth callback. Serving them here
  // means they cannot drift from the deployment they describe.
  const siteInfo: SiteInfo = {
    publicUrl: (process.env.GSC_PUBLIC_URL?.trim() || `http://${host}:${port}`).replace(/\/+$/, ""),
    contactEmail: process.env.GSC_CONTACT_EMAIL?.trim() || undefined,
    repoUrl: process.env.GSC_REPO_URL?.trim() || "https://github.com/kodotpro/gsc-mcp-remote",
    perUserSignIn: mode === "oauth",
  };

  app.get("/", (_req: Request, res: Response) => {
    res.type("html").send(landingPage(siteInfo));
  });
  app.get("/privacy", (_req: Request, res: Response) => {
    res.type("html").send(privacyPage(siteInfo));
  });

  // Unauthenticated liveness probe. Reveals nothing beyond "the process is up".
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      version: SERVER_VERSION,
      transport: "streamable-http",
      auth: mode,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      activeSessions: sessions.size,
      sessionLimit: MAX_SESSIONS,
      // Reported so the documented limits can be verified against a running
      // server rather than trusted. The per-user ceiling only bites in oauth
      // mode, where requests carry an identity.
      perUserSessionLimit: mode === "oauth" ? MAX_SESSIONS_PER_USER : null,
      requestsPerMinute: RATE_LIMIT_PER_MIN,
    });
  });

  if (oauth) {
    const { provider, publicUrl } = oauth;

    // Discovery metadata, DCR, /authorize, /token, /revoke — rate-limited by
    // the SDK. This is everything a connector UI needs to onboard by URL.
    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl: new URL(publicUrl),
        resourceServerUrl: new URL(`${publicUrl}/mcp`),
        scopesSupported: ["gsc:read"],
        resourceName: "Google Search Console MCP",
      })
    );

    // The consent page posts here. Express's urlencoded parser is added just
    // for this route so the JSON body parser used by /mcp is untouched.
    app.post("/oauth/consent", express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
      const pendingId = typeof req.body?.pending_id === "string" ? req.body.pending_id : "";
      const decision = typeof req.body?.decision === "string" ? req.body.decision : "";
      res.setHeader("Cache-Control", "no-store");
      try {
        if (!pendingId) throw new Error("Missing request identifier.");
        if (decision !== "allow") {
          provider.denyPending(pendingId);
          res.status(200).type("html").send(deniedPage());
          return;
        }
        res.redirect(provider.approvePending(pendingId));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).type("html").send(errorPage("Could not continue", message));
      }
    });

    // The Google half of the sandwich returns here.
    app.get("/oauth/google/callback", async (req: Request, res: Response) => {
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const googleError = typeof req.query.error === "string" ? req.query.error : "";
      try {
        if (googleError) throw new Error(`Google sign-in was not completed (${googleError}).`);
        if (!state || !code) throw new Error("Missing state or code in Google's callback.");
        const redirectTo = await provider.completeGoogleSignIn(state, code);
        res.redirect(redirectTo);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[oauth] google callback failed:", message);
        res.status(400).type("html").send(errorPage("Sign-in didn't complete", message));
      }
    });
  }

  // ---- the MCP endpoint ------------------------------------------------------

  const requireAuth: RequestHandler = oauth ? oauth.authMiddleware : sharedTokenMiddleware(sharedToken!);

  const userIdOf = (req: Request): string | null =>
    (req.auth?.extra as { userId?: string } | undefined)?.userId ?? null;

  /** Session ownership: a session opened by one user rejects every other. */
  const ownsSession = (req: Request, res: Response, session: Session): boolean => {
    if (session.userId === userIdOf(req)) return true;
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "This session belongs to a different user." },
      id: null,
    });
    return false;
  };

  const buildContext = (req: Request): UserContext | null => {
    if (!oauth) return null;
    const userId = userIdOf(req);
    if (!userId) return null;
    const email = (req.auth?.extra as { email?: string } | undefined)?.email;
    const { factory, provider } = oauth;
    return {
      userId,
      email,
      getSearchConsole: () => factory.searchConsoleFor(userId),
      settings: {
        getDefaultProperty: () => provider.getDefaultProperty(userId),
        setDefaultProperty: (property: string) => provider.setDefaultProperty(userId, property),
      },
      account: {
        disconnect: () => {
          const result = provider.disconnectUser(userId);
          factory.evict(userId);
          // Drop their live sessions too, so nothing keeps serving a user
          // whose credentials no longer exist.
          for (const [sid, sess] of sessions) if (sess.userId === userId) void closeSession(sid);
          return result;
        },
        exportData: () => provider.exportUser(userId),
      },
    };
  };

  app.post(MCP_PATHS, requireAuth, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unknown or expired session. Re-initialize to continue." },
            id: null,
          });
          return;
        }
        if (!ownsSession(req, res, session)) return;

        // Per-user request budget: one tenant must not be able to saturate a
        // shared box (or the account-wide Google quota) for everyone else.
        const rlKey = userIdOf(req) ?? "shared";
        const rl = rateLimitExceeded(rlKey);
        if (rl.limited) {
          res.status(429).set("Retry-After", String(rl.retryAfter)).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: `Rate limit reached (${RATE_LIMIT_PER_MIN} requests/minute). Retry in ${rl.retryAfter}s.` },
            id: null,
          });
          return;
        }

        session.lastSeen = Date.now();

        const ctx = buildContext(req);
        if (ctx) {
          await runWithUserContext(ctx, () => session.transport.handleRequest(req, res, req.body));
        } else {
          await session.transport.handleRequest(req, res, req.body);
        }
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Missing mcp-session-id header; only initialize may omit it." },
          id: null,
        });
        return;
      }

      // Capacity backstops, checked before a new McpServer is allocated.
      const owner = userIdOf(req);
      if (sessions.size >= MAX_SESSIONS) {
        res.status(503).set("Retry-After", "30").json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Server is at its session limit. Close an existing session or retry shortly." },
          id: null,
        });
        return;
      }
      if (sessionsOwnedBy(owner) >= MAX_SESSIONS_PER_USER) {
        res.status(429).set("Retry-After", "30").json({
          jsonrpc: "2.0",
          error: { code: -32000, message: `You already have ${MAX_SESSIONS_PER_USER} open sessions on this server. Close one before opening another.` },
          id: null,
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newId: string) => {
          console.error(`[session] opened ${newId} (active: ${sessions.size + 1})`);
        },
        onsessionclosed: (closedId: string) => {
          console.error(`[session] closed by client ${closedId}`);
          void closeSession(closedId);
        },
      });

      const server = createServer();
      await server.connect(transport);

      const ctx = buildContext(req);
      if (ctx) {
        await runWithUserContext(ctx, () => transport.handleRequest(req, res, req.body));
      } else {
        await transport.handleRequest(req, res, req.body);
      }

      const newId = transport.sessionId;
      if (newId) {
        sessions.set(newId, {
          transport,
          server,
          userId: userIdOf(req),
          lastSeen: Date.now(),
          createdAt: Date.now(),
        });
        transport.onclose = () => {
          void closeSession(newId);
        };
      }
    } catch (error) {
      console.error("[mcp] request failed:", error instanceof Error ? error.message : error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error." },
          id: null,
        });
      }
    }
  });

  // GET opens the notification stream; DELETE ends a session. Ownership is
  // enforced here too — a session id alone must never be enough.
  const bySessionId = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unknown or expired session." },
        id: null,
      });
      return;
    }
    if (!ownsSession(req, res, session)) return;
    session.lastSeen = Date.now();
    await session.transport.handleRequest(req, res);
  };

  app.get(MCP_PATHS, requireAuth, bySessionId);
  app.delete(MCP_PATHS, requireAuth, bySessionId);

  const sweeper = setInterval(() => {
    const cutoff = Date.now() - IDLE_TIMEOUT_MS;
    for (const [sessionId, session] of sessions) {
      if (session.lastSeen < cutoff) {
        console.error(`[session] closing idle session ${sessionId}`);
        void closeSession(sessionId);
      }
    }
    const now = Date.now();
    for (const [k, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(k);
    oauth?.provider.cleanupExpired();
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on("error", reject);
  });

  console.error(
    `GSC MCP server v${SERVER_VERSION} (multi-property) on http://${host}:${port}/mcp — ` +
    `auth: ${mode}${oauth ? `, issuer ${oauth.publicUrl}` : ""}, ${hostAllowlist.length} allowed host(s)`
  );

  const shutdown = async (signal: string) => {
    console.error(`\n[shutdown] ${signal} received, closing ${sessions.size} session(s)`);
    clearInterval(sweeper);
    await Promise.all([...sessions.keys()].map(closeSession));
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return httpServer;
}
