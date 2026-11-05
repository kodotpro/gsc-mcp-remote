/**
 * Strips trailing "/" characters in time linear in the input.
 *
 * This replaces `path.replace(/\/+$/, "")`, which is quadratic on a path made
 * of many slashes that does NOT end the string ("////…////x/"): the engine
 * retries the run from every slash and fails at the "x" each time. The
 * trailing-slash middleware ran that on the raw request path of every
 * unauthenticated GET, before the cheap check that decides whether the request
 * is relevant at all, so one request line near the header-size limit could keep
 * the shared event loop busy for every tenant.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return end === value.length ? value : value.slice(0, end);
}
