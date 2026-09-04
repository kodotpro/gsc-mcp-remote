/**
 * Ties an authorization flow to the one browser that started it.
 *
 * Without this, the flow's only authority is a server-minted string, and every
 * such string is obtainable by the attacker themselves — they start their own
 * /authorize and read the response. That opened two distinct takeovers:
 *
 *  1. CSRF on the consent POST. The attacker mints a pending id, then makes a
 *     victim's browser POST it, so the consent interstitial — which exists to
 *     name the client and its redirect host — is never seen by the person
 *     whose account is used.
 *
 *  2. Worse, and not fixed by anything in the form: the `state` handed to
 *     Google WAS the pending id, and the callback looked the row up by that
 *     alone. So the attacker approves consent in their OWN browser, reads the
 *     302, and mails the victim a plain link to accounts.google.com. The
 *     victim sees a genuine Google screen for this very app, approves, and the
 *     server binds THEIR Google account to the ATTACKER's client, redirect and
 *     PKCE challenge. No request to this server ever originates from the
 *     attacker's page, so no form-level token could have helped.
 *
 * The fix is one secret the attacker cannot obtain: a cookie. It is set on the
 * /authorize response, its hash is stored on the pending row, and it is
 * REQUIRED at both the consent POST and the Google callback. The `state` sent
 * to Google is now an independent random value, so possessing it proves
 * nothing on its own.
 *
 * SameSite=Lax is exactly the right setting, and worth explaining because it
 * looks too permissive at a glance:
 *   - the Google callback is a cross-site TOP-LEVEL GET navigation, and Lax
 *     sends cookies on those — so the legitimate return still works;
 *   - a cross-site POST from an attacker page does NOT get the cookie under
 *     Lax, which is precisely defence (1);
 *   - the real consent form is same-origin, so it does get the cookie.
 * Strict would break the Google return; None would reopen the CSRF.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

import { sha256hex } from "./crypto.js";

/**
 * Cookie name. Deliberately NOT using the `__Host-` prefix: that would force
 * Path=/, and this cookie has no business being sent to /mcp on every tool
 * call. Path=/oauth keeps it to the routes that need it.
 */
export const AUTH_COOKIE = "gsc_auth_flow";

/** Matches PENDING_TTL_MS in provider.ts — the cookie outlives nothing else. */
const COOKIE_MAX_AGE_S = 600;

/** The secret handed to the browser; only its hash is ever stored. */
export function newBrowserToken(): string {
  return randomBytes(32).toString("base64url");
}

export function browserTokenHash(token: string): string {
  return sha256hex(token);
}

/**
 * Constant-time hash comparison. The token is 256 bits of randomness, so a
 * timing attack is not the realistic threat here — but comparing digests in
 * constant time costs nothing and removes the question.
 */
export function browserTokenMatches(token: string | undefined, expectedHash: string): boolean {
  if (!token) return false;
  const a = Buffer.from(browserTokenHash(token), "utf8");
  const b = Buffer.from(expectedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * `Secure` is conditional because the local rehearsal
 * (scripts/try-oauth-local.mjs) runs on http://localhost, and a Secure cookie
 * is not guaranteed to be stored there across every browser. Any real
 * deployment is https, so it is set in practice.
 */
export function authCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${AUTH_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/oauth",
    `Max-Age=${COOKIE_MAX_AGE_S}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Expires the cookie once a flow has finished, succeeded or not. */
export function clearAuthCookieHeader(secure: boolean): string {
  const parts = [`${AUTH_COOKIE}=`, "HttpOnly", "SameSite=Lax", "Path=/oauth", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Reads one cookie out of a raw Cookie header.
 *
 * Hand-parsed rather than adding cookie-parser: this is the only cookie the
 * server has, and a dependency was just removed for carrying an unpatchable
 * advisory. Handles quoting and stray whitespace; ignores everything else.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    let value = pair.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    return value || undefined;
  }
  return undefined;
}
