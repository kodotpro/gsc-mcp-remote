/**
 * The repository's star count, for the header link on the public pages.
 *
 * The pages carry no JavaScript — `default-src 'none'` sees to that — so the
 * number cannot be fetched by the browser and has to be baked into the HTML
 * server-side. That rules out fetching per request: a page load must never wait
 * on api.github.com, and a burst of traffic must never turn into a burst of API
 * calls against an unauthenticated limit of 60/hour.
 *
 * So the value is polled in the background and read synchronously from memory.
 * A render gets whatever the last successful poll returned; when GitHub is
 * unreachable the previous value is kept and served stale, and if the very
 * first poll fails there is simply no number and the link renders without a
 * counter (see repoLink). A wrong-but-present count is worse than none.
 */
import { safeFetch } from "./net-guard.js";

/** Unauthenticated GitHub allows 60 requests/hour per IP; this uses 24/day. */
const REFRESH_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 5_000;
/** The repos endpoint answers well under this; the cap is a backstop. */
const MAX_BYTES = 256 * 1024;

let stars: number | undefined;
let timer: NodeJS.Timeout | undefined;

/** The last successfully fetched count, or undefined if there has never been one. */
export function currentStars(): number | undefined {
  return stars;
}

/**
 * Maps a repository page URL to its API endpoint, or undefined when the URL is
 * not a github.com repository — self-hosted instances may point GSC_REPO_URL at
 * a GitLab or Gitea mirror, which has no compatible endpoint and simply gets no
 * counter.
 */
export function starsEndpoint(repoUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  const [owner, repo] = parts;
  // Only the shapes GitHub itself allows, so a crafted GSC_REPO_URL cannot
  // reach a different API path.
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return undefined;
  return `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, "")}`;
}

async function poll(endpoint: string): Promise<void> {
  try {
    const res = await safeFetch(endpoint, {
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      userAgent: "gsc-mcp-remote (+https://github.com/kodotpro/gsc-mcp-remote)",
    });
    if (res.status !== 200) return;
    const parsed: unknown = JSON.parse(res.body.toString("utf8"));
    const count = (parsed as { stargazers_count?: unknown } | null)?.stargazers_count;
    if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
      stars = Math.floor(count);
    }
  } catch {
    // Keep whatever the last poll produced. The page renders without a counter
    // if that is nothing, which is the correct answer to "we do not know".
  }
}

/**
 * Begins background polling. Safe to call once at startup; the first fetch runs
 * immediately but is not awaited, so it never delays the listen() call.
 */
export function startStarPolling(repoUrl: string | undefined): void {
  if (timer || !repoUrl) return;
  const endpoint = starsEndpoint(repoUrl);
  if (!endpoint) return;

  void poll(endpoint);
  timer = setInterval(() => void poll(endpoint), REFRESH_MS);
  // Must not hold the event loop open, or the process would never exit.
  timer.unref();
}

/**
 * Stops polling. Nothing calls this today: the interval is unref'd, so it never
 * holds the process open and shutdown needs no help from it. It exists so a
 * caller that does need to stop early — a test, or a future embedded host — has
 * a way that does not reach into module state.
 */
export function stopStarPolling(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
