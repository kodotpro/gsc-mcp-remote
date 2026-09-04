/**
 * Process-wide ceilings on work that costs memory.
 *
 * The container has a 512 MB limit and a ~480 MB V8 heap ceiling, and two paths
 * could each fill it without ever tripping a per-request check:
 *
 *  - Outbound page/image fetches. Measured before this existed: 8 concurrent
 *    image_page_audit calls reached 444 MB RSS — and 8 is exactly one user's
 *    session quota, so a single account could OOM-kill the shared process at
 *    will. Worse, the bytes are off-heap Buffers, so heapUsedPercent read 2.1%
 *    at the moment of the kill and /healthz looked healthy.
 *  - Search Analytics pagination. One 25,000-row fetch costs ~17 MB including
 *    the transient JSON, and generate_report fans six sub-tools out in
 *    parallel, each of which fetches two to four times.
 *
 * WHERE THE PERMIT IS TAKEN MATTERS. It must be acquired at the LEAF — inside
 * safeFetch and inside fetchRows — never per tool call. generate_report calls
 * its sub-tools in-process, so a permit held by the parent while it awaits
 * children that also need permits is a guaranteed self-deadlock. Every
 * acquirer below is a leaf that holds a permit only across one network round
 * trip, so a queue always drains.
 *
 * The wait is bounded on purpose. An unbounded queue converts an out-of-memory
 * crash into a pile of requests that outlive the client's own timeout, and
 * since no AbortSignal is threaded through the tools yet, an abandoned request
 * keeps working and a retry stacks another. Failing fast with a retryable
 * message is the honest outcome.
 */

export interface Limiter {
  <T>(fn: () => Promise<T>): Promise<T>;
  /** For /healthz: how much of the ceiling is in use right now. */
  stats(): { active: number; queued: number; limit: number };
}

class QueueFullError extends Error {
  constructor(label: string, limit: number, waitMs: number) {
    super(
      `The server is at its ${label} limit (${limit} concurrent) and a slot did not free up within ` +
      `${Math.round(waitMs / 1000)}s. This is load shedding, not a failure of your request — retry shortly.`
    );
    this.name = "QueueFullError";
  }
}

/**
 * A counting semaphore with a bounded wait.
 *
 * The re-check is a `while`, not an `if`: a released permit wakes one waiter,
 * but a fresh caller can arrive before that waiter resumes, so a single check
 * would let the limit be exceeded by one on every release.
 */
export function createLimiter(label: string, limit: number, waitMs: number): Limiter {
  let active = 0;
  const waiters: (() => void)[] = [];

  const wake = () => {
    const next = waiters.shift();
    if (next) next();
  };

  const limiter = async <T>(fn: () => Promise<T>): Promise<T> => {
    const deadline = Date.now() + waitMs;
    while (active >= limit) {
      if (Date.now() >= deadline) throw new QueueFullError(label, limit, waitMs);
      let timer: NodeJS.Timeout | undefined;
      let resolved = false;
      await new Promise<void>((resolve) => {
        const done = () => {
          if (resolved) return;
          resolved = true;
          if (timer) clearTimeout(timer);
          resolve();
        };
        waiters.push(done);
        // Re-check on a timer too, so a waiter cannot sit past its deadline
        // when releases stop arriving.
        timer = setTimeout(done, Math.max(1, deadline - Date.now()));
        timer.unref?.();
      });
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      wake();
    }
  };

  limiter.stats = () => ({ active, queued: waiters.length, limit });
  return limiter as Limiter;
}

/**
 * Outbound fetches of caller-supplied URLs (image_page_audit). Small, because
 * each one may buffer up to GSC_MAX_IMAGE_BYTES off-heap and the container
 * limit — not the heap — is what kills the process.
 */
export const outboundFetchLimiter = createLimiter(
  "outbound fetch",
  Number(process.env.GSC_MAX_CONCURRENT_FETCHES ?? 3),
  Number(process.env.GSC_FETCH_QUEUE_WAIT_MS ?? 15_000)
);

/**
 * Search Analytics pagination. Larger than the outbound limit because these
 * are latency-bound Google calls rather than large downloads, but still bounded:
 * 6 x ~17 MB is ~100 MB, which leaves room on a 480 MB heap for the sessions
 * and everything else.
 */
export const googleFetchLimiter = createLimiter(
  "Search Console query",
  Number(process.env.GSC_MAX_CONCURRENT_GSC_QUERIES ?? 6),
  Number(process.env.GSC_QUERY_QUEUE_WAIT_MS ?? 20_000)
);
