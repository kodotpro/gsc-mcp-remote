#!/usr/bin/env node

/**
 * stdio entry point — the local, single-user mode.
 *
 * Tool definitions live in server-factory.ts so that this entry and the HTTP
 * entry (http.ts) serve exactly the same tools. Behaviour here is unchanged
 * from upstream: one process, one credential, one property by default.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_VERSION } from "./server-factory.js";

async function main() {
  const cmd = process.argv[2];

  if (cmd === "setup") {
    const { runSetup } = await import("./setup.js");
    const code = await runSetup(process.argv.slice(3));
    process.exit(code);
  }

  if (cmd === "--version" || cmd === "-v") {
    console.log(SERVER_VERSION);
    process.exit(0);
  }

  if (cmd === "http" || cmd === "serve") {
    const { startHttpServer } = await import("./http.js");
    await startHttpServer();
    return;
  }

  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  console.error(`GSC MCP server v${SERVER_VERSION} (multi-property) running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
