/**
 * robots.txt for the public pages, including Cloudflare's Content-Signal: what
 * the site's owner permits AI systems to do with the pages. `search` is
 * appearing in search results, `ai-input` is being read live to answer a
 * question, `ai-train` is model training.
 *
 * This site is documentation for a free, open-source tool, so all three are
 * permitted by default — being read and recommended is the point of it. That is
 * the published site's stance, not necessarily a deployer's, so
 * GSC_CONTENT_SIGNAL overrides it.
 *
 * Pure, so the rules can be tested without a server.
 */

export const CONTENT_SIGNAL_DEFAULT = "search=yes, ai-input=yes, ai-train=yes";

// Up to three distinct-looking signal=yes|no pairs, nothing else.
const SIGNAL = "(?:search|ai-input|ai-train)=(?:yes|no)";
const VALID = new RegExp(`^${SIGNAL}(?:, ${SIGNAL}){0,2}$`);

/**
 * The Content-Signal value to publish. The value ends up in a line of
 * robots.txt, so anything that is not exactly signal=yes|no pairs is refused
 * rather than written — which also means a newline in an environment variable
 * cannot add a directive of its own. `ignored` is true when a value was given
 * but not used, so the caller can say so.
 */
export function resolveContentSignal(raw: string | undefined): { value: string; ignored: boolean } {
  const given = raw?.trim();
  if (!given) return { value: CONTENT_SIGNAL_DEFAULT, ignored: false };
  return VALID.test(given) ? { value: given, ignored: false } : { value: CONTENT_SIGNAL_DEFAULT, ignored: true };
}

/**
 * Only meaningful on a published deployment: without a real https origin there
 * is no sitemap URL worth advertising, and a localhost instance has nothing to
 * crawl. /oauth/ and /mcp are endpoints, not pages.
 */
export function robotsTxt(options: { base: string | undefined; contentSignal: string }): string {
  const lines = [
    "User-agent: *",
    `Content-Signal: ${options.contentSignal}`,
    "Allow: /",
    "Disallow: /oauth/",
    "Disallow: /mcp",
  ];
  if (options.base) lines.push("", `Sitemap: ${options.base}/sitemap.xml`);
  return lines.join("\n") + "\n";
}
