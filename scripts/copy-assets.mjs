#!/usr/bin/env node
/**
 * Copies non-TypeScript runtime assets into dist/.
 *
 * `npm run build` is plain `tsc`, which emits only what it compiles — the web
 * fonts the public pages serve would otherwise never reach dist/. That matters
 * beyond local dev: the Dockerfile's runtime stage copies `dist/` and nothing
 * else, so an asset missing here is an asset missing in production, where the
 * pages would silently fall back to system fonts.
 *
 * Run: node scripts/copy-assets.mjs (wired into `npm run build`)
 */
import { cpSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Directories under src/ copied verbatim into dist/. */
const ASSET_DIRS = ["fonts", "img"];

for (const dir of ASSET_DIRS) {
  const from = path.join(root, "src", dir);
  const to = path.join(root, "dist", dir);
  if (!existsSync(from)) {
    console.error(`copy-assets: missing src/${dir} — nothing to copy`);
    process.exitCode = 1;
    continue;
  }
  cpSync(from, to, { recursive: true });
  console.log(`copy-assets: src/${dir} -> dist/${dir} (${readdirSync(to).length} file(s))`);
}
