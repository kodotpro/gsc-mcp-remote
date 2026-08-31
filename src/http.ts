/**
 * HTTP entry point — the remote mode (Phase 2).
 *
 * Serves the same tools as stdio over Streamable HTTP so a hosted deployment
 * can back Claude clients that are not on the same machine as the server.
 *
 * Auth in this phase is a single shared bearer token, which is enough for
 * Claude Code (`claude mcp add --transport http ... --header`). The claude.ai
 * and Claude Desktop connector UIs have no arbitrary-header field and expect
 * OAuth, so they are not supported until the per-user OAuth phase lands.
 *
 * Google credentials are still process-wide here: every request is served with
 * the server's own credential, so a deployment must only be shared with people
 * who are allowed to see all of its properties. Per-user Google identity is a
 * later phase.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import express, { type Request, type Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createServer, SERVER_VERSION } from "./server-factory.js";
import { setRemoteMode } from "./runtime.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
  createdAt: number;
}

const sessions = new Map<string, Session>();
const startedAt = Date.now();

/** Sessions untouched for this long are closed by the sweeper. */
const IDLE_TIMEOUT_MS = Number(process.env.GSC_HTTP_IDLE_TIMEOUT_MS ?? 30 * 60 * 1000);
const SWEEP_INTERVAL_MS = 60 * 1000;

function requiredToken(): string {
  const token = process.env.GSC_HTTP_TOKEN?.trim();
  if (!token || token.length < 24) {
    throw new Error(
      "GSC_HTTP_TOKEN must be set to a secret of at least 24 characters before HTTP mode will start. " +
      "This token is the only thing standing between the public internet and your Search Console data. " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  return token;
}

/** Constant-time bearer comparison, so a wrong token leaks no timing signal. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorize(req: Request, res: Response, expected: string): boolean {
  const header = req.headers.authorization;
  const presented = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;

  if (!presented || !tokenMatches(presented, expected)) {
    // 401 with WWW-Authenticate is what an MCP client expects when unauthorised.
    res.status(401)
      .set("WWW-Authenticate", 'Bearer realm="gsc-mcp"')
      .json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: provide a valid bearer token." },
        id: null,
      });
    return false;
  }
  return true;
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

function sweepIdleSessions(): void {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [sessionId, session] of sessions) {
    if (session.lastSeen < cutoff) {
      console.error(`[session] closing idle session ${sessionId}`);
      void closeSession(sessionId);
    }
  }
}

export async function startHttpServer(): Promise<HttpServer> {
  // Switches on the behaviours that differ when the server is not on the
  // caller's own machine: no writing files, no fetching private addresses.
  setRemoteMode(true);

  const token = requiredToken();
  const port = Number(process.env.GSC_HTTP_PORT ?? 8787);
  const host = process.env.GSC_HTTP_HOST ?? "127.0.0.1";

  // Behind a reverse proxy the Host header carries the public hostname, so it
  // must be allow-listed explicitly — binding to 0.0.0.0 disables the SDK's
  // automatic localhost-only DNS-rebinding protection. Unexpected 403s from a
  // proxied deployment almost always mean the public hostname is missing here.
  const allowedHosts = (process.env.GSC_HTTP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const defaultHosts = [
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    "localhost",
    "127.0.0.1",
  ];
  const hostAllowlist = [...new Set([...allowedHosts, ...defaultHosts])];

  const app = createMcpExpressApp({ host, allowedHosts: hostAllowlist });

  // Correct client IPs in logs when CloudPanel's nginx is in front.
  app.set("trust proxy", 1);

  // Unauthenticated liveness probe. Deliberately reveals nothing beyond
  // "the process is up" — no property names, no config, no token state.
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      version: SERVER_VERSION,
      transport: "streamable-http",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      activeSessions: sessions.size,
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    if (!authorize(req, res, token)) return;

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      // Existing session: hand the request to its transport.
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
        session.lastSeen = Date.now();
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      // No session id: only an initialize request may open one.
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Missing mcp-session-id header; only initialize may omit it." },
          id: null,
        });
        return;
      }

      // One McpServer per session: server.connect() binds 1:1 to a transport.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        // These tools are all request/response; plain JSON avoids depending on
        // SSE streaming surviving the reverse proxy intact.
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
      await transport.handleRequest(req, res, req.body);

      // sessionId is assigned during handleRequest of the initialize call.
      const newId = transport.sessionId;
      if (newId) {
        sessions.set(newId, {
          transport,
          server,
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

  // GET opens the server-to-client notification stream; DELETE ends a session.
  const bySessionId = async (req: Request, res: Response) => {
    if (!authorize(req, res, token)) return;

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
    session.lastSeen = Date.now();
    await session.transport.handleRequest(req, res);
  };

  app.get("/mcp", bySessionId);
  app.delete("/mcp", bySessionId);

  const sweeper = setInterval(sweepIdleSessions, SWEEP_INTERVAL_MS);
  sweeper.unref();

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on("error", reject);
  });

  console.error(
    `GSC MCP server v${SERVER_VERSION} (multi-property) on http://${host}:${port}/mcp — ` +
    `bearer auth required, ${hostAllowlist.length} allowed host(s)`
  );

  const shutdown = async (signal: string) => {
    console.error(`\n[shutdown] ${signal} received, closing ${sessions.size} session(s)`);
    clearInterval(sweeper);
    await Promise.all([...sessions.keys()].map(closeSession));
    httpServer.close(() => process.exit(0));
    // Don't hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return httpServer;
}
