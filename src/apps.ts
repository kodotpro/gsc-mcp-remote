/**
 * MCP Apps: an interactive view of a tool's result, rendered by the client.
 *
 * A tool that names a `ui://` resource in its `_meta` tells a client that
 * supports the MCP Apps extension to fetch that resource (one HTML document),
 * render it in a sandboxed iframe beside the result, and hand it the result
 * over postMessage. Clients without the extension ignore the field and show
 * the text result exactly as before, so this is purely additive.
 *
 * One document serves every tool: it reads `_meta.tool` from the result (which
 * withMeta already puts there) and picks the matching layout. That keeps the
 * resource list to a single entry and the page to a few kilobytes.
 *
 * The page is built from two static files, src/app-view/view.css and view.js,
 * which copy-assets.mjs places in dist/. They are plain files rather than
 * strings in this module so that the test suite can load the very script the
 * client will run.
 *
 * Security. The view displays third-party text (search queries, URLs), so the
 * script never parses any of it as markup; scripts/check-apps.mjs runs it
 * against hostile strings. The sandbox's default policy lets the page reach
 * nothing at all. The one thing it asks for is this deployment's own origin,
 * for one font file, and only when the deployment has a public https origin.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** The MIME type that marks an HTML resource as an MCP App. */
export const APP_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * Versioned, because clients may cache a ui:// resource by URI: a changed view
 * has to appear under a new name to be seen.
 */
export const VIEW_URI = "ui://gsc-mcp/view-v1.html";

/** The tools whose results the view knows how to draw. */
export const VIEW_TOOLS: ReadonlySet<string> = new Set([
  "site_snapshot",
  "multi_site_dashboard",
  "quick_wins",
  "ctr_opportunities",
  "traffic_drops",
  "content_gaps",
  "content_decay",
  "ctr_vs_benchmark",
  "cannibalization_check",
  "check_alerts",
]);

/**
 * `_meta` for a tool that has a view. Both spellings are sent: `ui.resourceUri`
 * is the current one, and the flat key is what earlier hosts read.
 */
export function viewToolMeta(name: string): Record<string, unknown> | undefined {
  if (!VIEW_TOOLS.has(name)) return undefined;
  return { ui: { resourceUri: VIEW_URI }, "ui/resourceUri": VIEW_URI };
}

/**
 * The origin the view may load its font from: this deployment's public URL,
 * and only if it is a plain https origin. A local (stdio) install has none, and
 * the view then uses the system font stack, which needs no permission.
 */
export function viewFontOrigin(publicUrl: string | undefined = process.env.GSC_PUBLIC_URL): string | null {
  const raw = publicUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const ASSET_DIR = path.join(__dirname, "app-view");
let assets: { css: string; js: string } | null = null;
function loadAssets(): { css: string; js: string } {
  if (!assets) {
    const css = fs.readFileSync(path.join(ASSET_DIR, "view.css"), "utf8");
    const js = fs.readFileSync(path.join(ASSET_DIR, "view.js"), "utf8");
    // Inlined between <style> and <script> tags, so neither may be able to
    // close its own element. A build that ever introduces one fails loudly here
    // instead of shipping a page whose script silently ends early.
    if (/<\/style/i.test(css) || /<\/script/i.test(js) || /<!--/.test(js)) {
      throw new Error("app-view assets must not contain </style>, </script> or <!--");
    }
    assets = { css, js };
  }
  return assets;
}

const pages = new Map<string, string>();

/** The complete HTML document for the view. */
export function viewHtml(fontOrigin: string | null = viewFontOrigin()): string {
  const key = fontOrigin ?? "";
  const cached = pages.get(key);
  if (cached) return cached;
  const { css, js } = loadAssets();
  const fontFace = fontOrigin
    ? `@font-face{font-family:"Host Grotesk";font-style:normal;font-weight:400 600;font-display:swap;` +
      `src:url(${fontOrigin}/fonts/host-grotesk-latin.woff2) format("woff2")}\n`
    : "";
  const html =
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
    `<meta name="color-scheme" content="light dark">\n<title>Search Console</title>\n` +
    `<style>\n${fontFace}${css}</style>\n</head>\n<body>\n` +
    `<main id="app" aria-live="polite"><p class="state">Waiting for Search Console data…</p></main>\n` +
    `<script>\n${js}</script>\n</body>\n</html>\n`;
  pages.set(key, html);
  return html;
}

/**
 * `_meta.ui` for the resource: what the sandbox must allow. With no font origin
 * the page needs nothing, and declaring nothing leaves the default policy
 * (no network at all) in force.
 */
export function viewResourceMeta(fontOrigin: string | null = viewFontOrigin()): Record<string, unknown> {
  return {
    ui: {
      ...(fontOrigin ? { csp: { resourceDomains: [fontOrigin] } } : {}),
      // The view draws its own frame; a second one from the host would double it.
      prefersBorder: false,
    },
  };
}
