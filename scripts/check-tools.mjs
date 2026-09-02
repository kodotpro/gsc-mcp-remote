#!/usr/bin/env node
/**
 * Credential-free smoke test.
 *
 * Boots the built server over stdio, completes an MCP handshake, and asserts
 * that every tool registers and that the property-scoped ones expose site_url.
 * Guards the specific regression this fork exists to fix: a tool quietly
 * losing its site_url parameter and silently falling back to one property.
 *
 * Run: node scripts/check-tools.mjs
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Must accept a site_url. Anything property-scoped belongs here.
const NEEDS_SITE_URL = [
  "set_default_property", // site_url here is the subject being saved, and required
  "quick_wins",
  "ctr_opportunities",
  "traffic_drops",
  "content_gaps",
  "site_snapshot",
  "inspect_url",
  "cannibalization_check",
  "content_decay",
  "topic_cluster_performance",
  "ctr_vs_benchmark",
  "verify_claim",
  "advanced_search_analytics",
  "check_alerts",
  "content_recommendations",
  "generate_report",
  "submit_sitemap",
  "list_sitemaps",
  "image_keyword_overview",
  "image_search_quick_wins",
  "compare_web_vs_image",
  "image_pages_overview",
  "image_keyword_trends",
  "image_impressions_no_clicks",
  "image_content_decay",
  "genai_conversation_queries",
];

// Deliberately property-independent:
//   multi_site_dashboard takes a site_urls array instead;
//   submit_url / submit_batch address the Indexing API by URL ownership;
//   list_properties is the discovery call itself;
//   image_page_audit fetches pages and never queries Search Console.
const NO_SITE_URL = [
  "disconnect_account",
  "export_my_data",
  "multi_site_dashboard",
  "submit_url",
  "submit_batch",
  "list_properties",
  "image_page_audit",
];

const proc = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
const rl = createInterface({ input: proc.stdout });

const send = (o) => proc.stdin.write(JSON.stringify(o) + "\n");
const pending = new Map();
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const resolve = pending.get(msg.id);
  if (resolve) {
    pending.delete(msg.id);
    resolve(msg);
  }
});

const request = (id, method, params) =>
  new Promise((resolve, reject) => {
    pending.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
    setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 20000);
  });

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  proc.kill();
  process.exit(1);
};

try {
  const init = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "check-tools", version: "1.0" },
  });
  if (!init.result) fail("initialize returned no result");
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const listed = await request(2, "tools/list");
  const tools = listed.result?.tools;
  if (!Array.isArray(tools)) fail("tools/list returned no tools array");

  const byName = new Map(tools.map((t) => [t.name, t]));
  const problems = [];

  for (const name of [...NEEDS_SITE_URL, ...NO_SITE_URL]) {
    if (!byName.has(name)) problems.push(`missing tool: ${name}`);
  }
  for (const name of NEEDS_SITE_URL) {
    const tool = byName.get(name);
    if (tool && !tool.inputSchema?.properties?.site_url) {
      problems.push(`${name} is missing its site_url parameter`);
    }
  }
  for (const name of NO_SITE_URL) {
    const tool = byName.get(name);
    if (tool && tool.inputSchema?.properties?.site_url) {
      problems.push(`${name} unexpectedly gained a site_url parameter`);
    }
  }

  const expected = NEEDS_SITE_URL.length + NO_SITE_URL.length;
  if (tools.length !== expected) {
    problems.push(`expected ${expected} tools, found ${tools.length} — update this script if a tool was added deliberately`);
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`  - ${p}`);
    fail(`${problems.length} problem(s) found`);
  }

  console.log(
    `OK: ${tools.length} tools registered; ` +
    `${NEEDS_SITE_URL.length} accept site_url, ${NO_SITE_URL.length} are property-independent.`
  );
  proc.kill();
  process.exit(0);
} catch (err) {
  fail(err.message);
}
