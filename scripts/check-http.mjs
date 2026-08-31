#!/usr/bin/env node
/**
 * Credential-free smoke test for remote (HTTP) mode.
 *
 * Boots the HTTP entry point with a throwaway token and checks the things that
 * can be checked without Google credentials: the health endpoint, that the
 * bearer token is actually enforced, that a session can be opened and lists the
 * full tool set, and that teardown removes it. No call reaches Google, because
 * initialize and tools/list are answered locally.
 *
 * Run: node scripts/check-http.mjs
 */
import { spawn } from "node:child_process";

const TOKEN = "smoke-test-token-not-a-secret-0123456789";
const PORT = 20000 + Math.floor(Math.random() * 9000);
const BASE = `http://127.0.0.1:${PORT}`;

const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
};

const proc = spawn("node", ["dist/index.js", "http"], {
  env: {
    ...process.env,
    GSC_HTTP_TOKEN: TOKEN,
    GSC_HTTP_PORT: String(PORT),
    GSC_HTTP_HOST: "127.0.0.1",
  },
  stdio: ["ignore", "ignore", "pipe"],
});

let stderr = "";
proc.stderr.on("data", (c) => {
  stderr += c.toString();
});

const post = (body, headers = {}) =>
  fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const auth = { Authorization: `Bearer ${TOKEN}` };

async function waitForBoot(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (proc.exitCode !== null) {
      throw new Error(`server exited early (code ${proc.exitCode}):\n${stderr}`);
    }
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not become healthy on port ${PORT}:\n${stderr}`);
}

try {
  await waitForBoot();

  const health = await (await fetch(`${BASE}/healthz`)).json();
  check("/healthz responds without auth", health.status === "ok", JSON.stringify(health));
  check("/healthz reports the transport", health.transport === "streamable-http");

  const noToken = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  check("POST /mcp without a token is rejected", noToken.status === 401, `got ${noToken.status}`);

  const badToken = await post(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { Authorization: "Bearer wrong-token-wrong-token-wrong-token" }
  );
  check("POST /mcp with a wrong token is rejected", badToken.status === 401, `got ${badToken.status}`);

  const initRes = await post(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "check-http", version: "1.0" },
      },
    },
    auth
  );
  check("initialize with a valid token succeeds", initRes.ok, `got ${initRes.status}`);

  const sessionId = initRes.headers.get("mcp-session-id");
  check("initialize returns an mcp-session-id", Boolean(sessionId));

  if (sessionId) {
    const sessionHeaders = { ...auth, "mcp-session-id": sessionId };
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionHeaders);

    const listRes = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, sessionHeaders);
    const listed = await listRes.json();
    const count = listed?.result?.tools?.length ?? 0;
    check("tools/list over HTTP returns the full tool set", count === 30, `got ${count}`);

    const afterOpen = await (await fetch(`${BASE}/healthz`)).json();
    check("the open session is counted", afterOpen.activeSessions === 1, `got ${afterOpen.activeSessions}`);

    const del = await fetch(`${BASE}/mcp`, { method: "DELETE", headers: sessionHeaders });
    check("DELETE /mcp closes the session", del.ok, `got ${del.status}`);

    const afterClose = await (await fetch(`${BASE}/healthz`)).json();
    check("no sessions remain after teardown", afterClose.activeSessions === 0, `got ${afterClose.activeSessions}`);

    const reuse = await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, sessionHeaders);
    check("a closed session cannot be reused", reuse.status === 404, `got ${reuse.status}`);
  }
} catch (err) {
  console.error(`  FAIL  ${err.message}`);
  failures.push("harness");
} finally {
  proc.kill("SIGTERM");
}

if (failures.length > 0) {
  console.error(`\nHTTP smoke test: ${failures.length} failure(s).`);
  process.exit(1);
}
console.log("\nHTTP smoke test: all checks passed.");
process.exit(0);
