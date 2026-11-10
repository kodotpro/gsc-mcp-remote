/**
 * Google API failures: when to try again, and how to say what went wrong.
 *
 * Two gaps this closes.
 *
 * 1. Retries. gaxios retries GET requests by itself, but the two calls that
 *    carry almost all of this server's traffic are POSTs (searchanalytics.query
 *    and urlInspection.index.inspect), which it never retries. Both are reads, so
 *    repeating one is safe; a single 429 or 503 from Google used to fail the
 *    whole tool call, and for the tools that fan out (generate_report makes
 *    about ten queries) one blip failed everything.
 *
 * 2. Messages. A raw Google error reads like "User does not have sufficient
 *    permission for site 'sc-domain:example.com'. See also: https://…" or
 *    "Quota exceeded for quota metric …". The model relays that to a person who
 *    cannot act on it. Each failure class gets one sentence saying what happened
 *    and what to do next, with Google's own text kept (bounded) for detail.
 */
import { boundedText } from "./guardrails.js";

interface GoogleErrorLike {
  code?: number | string;
  status?: number;
  message?: string;
  response?: { status?: number; headers?: unknown; data?: unknown };
  errors?: Array<{ reason?: string; message?: string }>;
}

const asGoogleError = (err: unknown): GoogleErrorLike =>
  err && typeof err === "object" ? (err as GoogleErrorLike) : {};

/** The HTTP status Google answered with, if it answered at all. */
export function googleStatus(err: unknown): number | undefined {
  const e = asGoogleError(err);
  const candidates = [e.response?.status, e.status, typeof e.code === "number" ? e.code : Number(e.code)];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isInteger(c) && c >= 100 && c <= 599) return c;
  }
  return undefined;
}

/** Google's machine-readable reason ("quotaExceeded", "forbidden", …), lowercased. */
function googleReason(err: unknown): string {
  const e = asGoogleError(err);
  const fromList = e.errors?.[0]?.reason;
  const data = e.response?.data as { error?: { errors?: Array<{ reason?: string }>; status?: string } | string } | undefined;
  const nested = typeof data?.error === "object" ? data.error?.errors?.[0]?.reason ?? data.error?.status : data?.error;
  return String(fromList ?? nested ?? "").toLowerCase();
}

const QUOTA_REASONS = /quota|ratelimit|rate_limit|resource_exhausted|toomanyrequests/;

function isQuotaError(err: unknown): boolean {
  const status = googleStatus(err);
  if (status === 429) return true;
  return status === 403 && QUOTA_REASONS.test(googleReason(err) + " " + String(asGoogleError(err).message ?? "").toLowerCase());
}

/**
 * Worth one more attempt: Google said "too many requests" or failed on its own
 * side, or the connection dropped before any answer. A timeout is NOT retried:
 * the call already waited the full deadline, and a second wait would hold a
 * session and a rate-limit slot for two minutes.
 */
export function isRetryableGoogleError(err: unknown): boolean {
  const status = googleStatus(err);
  if (status !== undefined) return status === 429 || (status >= 500 && status <= 504);
  const code = String(asGoogleError(err).code ?? "");
  return code === "ECONNRESET" || code === "EAI_AGAIN" || code === "EPIPE";
}

const retryAttempts = (): number => {
  const n = Number(process.env.GSC_GOOGLE_RETRIES ?? 2);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 2;
};
const retryBaseMs = (): number => {
  const n = Number(process.env.GSC_GOOGLE_RETRY_BASE_MS ?? 400);
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : 400;
};

/** Seconds from a Retry-After header, when Google sent a usable one. */
function retryAfterMs(err: unknown): number | undefined {
  const headers = asGoogleError(err).response?.headers as
    | { get?: (name: string) => string | null; [key: string]: unknown }
    | undefined;
  if (!headers) return undefined;
  const raw = typeof headers.get === "function" ? headers.get("retry-after") : headers["retry-after"];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/** Longest single pause between attempts, whatever Google asks for. */
const MAX_PAUSE_MS = 5_000;

/**
 * Runs a READ against Google, repeating it after a transient failure.
 *
 * Only for idempotent calls. Never wrap a write (sitemaps.submit, the Indexing
 * API): a request that failed on the way back may have succeeded on the way in.
 *
 * Backoff is exponential with full jitter, so the calls of one fan-out that
 * failed together do not come back together.
 */
export async function withGoogleRetry<T>(call: () => Promise<T>): Promise<T> {
  const extra = retryAttempts();
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (attempt >= extra || !isRetryableGoogleError(err)) throw err;
      const backoff = retryBaseMs() * 2 ** attempt;
      const pause = Math.min(MAX_PAUSE_MS, retryAfterMs(err) ?? backoff * (0.5 + Math.random() / 2));
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }
}

/**
 * One actionable sentence for a failure that came from Google, or null when the
 * error is not a Google API error (the caller then reports it unchanged).
 */
export function explainGoogleError(err: unknown, property?: string): string | null {
  const e = asGoogleError(err);
  const status = googleStatus(err);
  const message = String(e.message ?? "");
  const detail = message ? ` Google said: ${boundedText(message, 300)}` : "";
  const where = property ? ` "${boundedText(property, 200)}"` : "";

  if (/invalid_grant|invalid_token|token has been expired or revoked/i.test(message) || status === 401) {
    return (
      "Google rejected the stored sign-in, so no data was read. The connection has expired or was revoked: " +
      "reconnect this server to your Google account (on a local install, run the setup again), then retry." +
      detail
    );
  }
  if (status === undefined) {
    // Narrow on purpose: this function sees every error a tool throws, and a
    // sentence that merely contains "timeout" is not evidence it came from Google.
    const code = String(e.code ?? "");
    const timedOut =
      code === "ETIMEDOUT" || code === "ECONNABORTED" ||
      /^(timeout of \d+ms exceeded|network timeout at|The operation was aborted|The user aborted a request)/i.test(message);
    if (timedOut) {
      return (
        "Google did not answer within the time limit, so no data was read. Retry; if it keeps happening, " +
        "use a shorter date range or fewer dimensions." + detail
      );
    }
    return null;
  }
  if (isQuotaError(err)) {
    return (
      "Google's Search Console API quota was reached, so no data was read. This is a limit on Google's side, " +
      "not an error in the request: wait a minute and retry, and prefer one broader call over many small ones. " +
      "Daily limits reset at midnight Pacific time." + detail
    );
  }
  if (status === 403) {
    return (
      `This Google account does not have access to the Search Console property${where}, or the property string is ` +
      "not exact (sc-domain:example.com and https://example.com/ are different properties). " +
      "Call list_properties and pass one of its siteUrl values unchanged." + detail
    );
  }
  if (status === 404) {
    return (
      `Google does not know the Search Console property${where} for this account. ` +
      "Call list_properties and pass one of its siteUrl values unchanged." + detail
    );
  }
  if (status === 400) {
    return "Google rejected the request as invalid, so no data was read. Check the dates, dimensions and filters." + detail;
  }
  if (status >= 500) {
    return (
      "Google's API failed on its own side and kept failing after a retry, so no data was read. " +
      "It is usually brief: retry in a minute." + detail
    );
  }
  return `Google refused the request (HTTP ${status}), so no data was read.${detail}`;
}
