/**
 * The consent interstitial and the registration policy.
 *
 * Without these, the flow had a hole: dynamic client registration accepts any
 * redirect_uri from any stranger, and /authorize forwarded straight to Google
 * with no page naming who was asking. A victim clicking a crafted link saw
 * only Google's own screen — branded with THIS server's app name and the scope
 * they expected — and the resulting code was delivered to the attacker, who
 * exchanged it for tokens bound to the victim's account.
 *
 * Two changes close it. Registrations whose redirect targets are not
 * recognised Claude endpoints (or loopback) are marked untrusted, and every
 * authorization now stops at a page that names the client and its redirect
 * URI and requires a deliberate POST to continue.
 *
 * Registration itself stays open — claude.ai and Claude Desktop onboard a
 * server by URL alone, which only works if a stranger can register. So the
 * policy here is not "who may register" but "what a registration may be":
 * bounded in size, and with redirect URIs that cannot deliver a code in the
 * clear to a remote host.
 */
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * The callbacks a first-party Claude client is documented to use, matched on
 * origin AND path. Matching the whole host would make every page on claude.ai
 * a safe place for an authorization code to land, so an open redirect or any
 * user-controlled page there would receive codes with no warning at all.
 *
 * A genuine client whose callback is not listed is not refused — it only gets
 * the warning, which is the failure direction wanted: too cautious, never too
 * trusting. Source: Anthropic's remote-MCP connector docs give the callback as
 * https://claude.ai/api/mcp/auth_callback and say it may move to claude.com
 * (https://support.claude.com/en/articles/11503834).
 */
const TRUSTED_CALLBACKS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);

function isLoopback(u: URL): boolean {
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function isRecognisedRedirect(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (isLoopback(u)) return u.protocol === "http:" || u.protocol === "https:";
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return false;
  return TRUSTED_CALLBACKS.has(`${u.origin}${u.pathname}`);
}

/**
 * True when every redirect URI is somewhere a genuine MCP client would
 * receive a code: a documented Claude callback, or loopback (which only the
 * person's own machine can receive).
 */
export function redirectsAreRecognised(client: OAuthClientInformationFull): boolean {
  const uris = client.redirect_uris ?? [];
  return uris.length > 0 && uris.every(isRecognisedRedirect);
}

// ---- registration policy ---------------------------------------------------

/**
 * Registration is open to anyone, and each one is stored until it is swept, so
 * an unbounded field is a disk-and-replication cost an attacker sets. Real
 * registrations are a few hundred bytes; these bounds are generous for them
 * and tight for abuse. `totalBytes` is the one that actually binds: it caps the
 * sum, so no combination of individually-legal fields can add up to more.
 */
export const REGISTRATION_LIMITS = {
  nameChars: 128,
  redirectUris: 10,
  uriChars: 1024,
  textChars: 1024,
  listEntries: 10,
  listEntryChars: 320,
  totalBytes: 8192,
} as const;

/** Metadata this server never reads — it supports no private_key_jwt auth. */
const UNUSED_FIELDS = ["jwks", "jwks_uri", "software_statement"] as const;
const TEXT_FIELDS = [
  "client_uri", "logo_uri", "tos_uri", "policy_uri", "scope",
  "software_id", "software_version", "token_endpoint_auth_method",
] as const;
const LIST_FIELDS = ["contacts", "grant_types", "response_types"] as const;

/**
 * Drops metadata we would otherwise store and echo without ever using. RFC 7591
 * lets a server ignore or replace what a client sends; the registration
 * response reports what was actually kept.
 */
export function withoutUnusedMetadata(client: OAuthClientInformationFull): OAuthClientInformationFull {
  const kept: Record<string, unknown> = { ...client };
  for (const field of UNUSED_FIELDS) delete kept[field];
  return kept as unknown as OAuthClientInformationFull;
}

/**
 * Why a registration must be refused, or undefined when it is acceptable.
 *
 * Redirect URIs follow the MCP authorization spec's communication-security
 * rule (https, or http only on loopback) with one deliberate gap: private-use
 * schemes such as cursor:// are still accepted, because desktop clients use
 * them. Those reach only an app on the person's own machine and are always
 * shown on the consent page with the full URI and a warning.
 */
export function registrationProblem(client: OAuthClientInformationFull): string | undefined {
  const L = REGISTRATION_LIMITS;
  const uris = client.redirect_uris ?? [];
  if (uris.length === 0) return "redirect_uris must list at least one redirect URI.";
  if (uris.length > L.redirectUris) return `redirect_uris may list at most ${L.redirectUris} URIs.`;
  for (const raw of uris) {
    if (raw.length > L.uriChars) return `A redirect URI may be at most ${L.uriChars} characters.`;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return "Every redirect URI must be an absolute URI.";
    }
    if (u.protocol === "http:" && !isLoopback(u)) {
      return "Redirect URIs must use https. Plain http is accepted only for localhost, 127.0.0.1 and [::1].";
    }
  }

  if (typeof client.client_name === "string" && client.client_name.length > L.nameChars) {
    return `client_name may be at most ${L.nameChars} characters.`;
  }
  const meta = client as unknown as Record<string, unknown>;
  for (const field of TEXT_FIELDS) {
    const v = meta[field];
    if (typeof v === "string" && v.length > L.textChars) return `${field} may be at most ${L.textChars} characters.`;
  }
  for (const field of LIST_FIELDS) {
    const v = meta[field];
    if (!Array.isArray(v)) continue;
    if (v.length > L.listEntries) return `${field} may list at most ${L.listEntries} entries.`;
    if (v.some((e) => typeof e === "string" && e.length > L.listEntryChars)) {
      return `Entries in ${field} may be at most ${L.listEntryChars} characters.`;
    }
  }

  if (Buffer.byteLength(JSON.stringify(client)) > L.totalBytes) {
    return `Registration metadata may total at most ${L.totalBytes} bytes.`;
  }
  return undefined;
}

const esc = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface ConsentPageParams {
  pendingId: string;
  clientName: string;
  clientId: string;
  redirectUri: string;
  scopeSummary: string;
  recognised: boolean;
}

/**
 * The page a person sees before we hand them to Google. It exists to make the
 * one thing Google's own screen cannot show — which client receives the
 * result — visible and refusable.
 */
export function consentPage(p: ConsentPageParams): string {
  // The WHOLE redirect URI, never just its host: `new URL("evil://claude.ai/cb").host`
  // is "claude.ai", and a page that printed only that would show a stranger's
  // callback as Claude's own. The scheme and path are part of where the code goes.
  const target = esc(p.redirectUri);
  const warn = p.recognised
    ? ""
    : `<div class="warn"><strong>This is not a Claude address.</strong> You are about to let
       <code>${target}</code> receive access to your Search Console data. If you did not
       start this from a Claude client you recognise, close this page.</div>`;
  // Anyone can register under any name. For a recognised Claude callback the
  // name is incidental; for anything else it is the attacker's claim, so say so.
  const nameNote = p.recognised ? "" : ` <span class="note">(name chosen by the app, not verified)</span>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Authorise access</title>
<style>
 :root{color-scheme:light dark}
 body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6;margin:0;
      background:Canvas;color:CanvasText;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:1.5rem}
 .card{max-width:32rem;width:100%;border:1px solid rgba(128,128,128,.35);border-radius:12px;padding:1.6rem 1.8rem}
 h1{font-size:1.25rem;margin:0 0 .4rem}
 p{margin:0 0 1rem}
 dl{display:grid;grid-template-columns:auto 1fr;gap:.4rem 1rem;margin:1rem 0;font-size:.93rem}
 dt{font-weight:600;opacity:.75}dd{margin:0;word-break:break-all}
 code{font-family:ui-monospace,Menlo,monospace;font-size:.88em}
 .note{font-size:.85em;opacity:.7;word-break:normal}
 .warn code{word-break:break-all}
 .warn{border:1px solid #b0402e;background:rgba(176,64,46,.12);border-radius:8px;padding:.8rem 1rem;margin:1rem 0;font-size:.93rem}
 .row{display:flex;gap:.7rem;margin-top:1.4rem;flex-wrap:wrap}
 button{font:inherit;padding:.6rem 1.15rem;border-radius:8px;border:1px solid transparent;cursor:pointer}
 .go{background:#17705E;color:#fff}
 .no{background:transparent;border-color:rgba(128,128,128,.45);color:inherit}
 .foot{font-size:.83rem;opacity:.7;margin-top:1.2rem}
</style></head><body>
<div class="card">
  <h1>Connect your Google Search Console?</h1>
  <p>An application is asking to read your Search Console data through this server.</p>
  ${warn}
  <dl>
    <dt>Application</dt><dd>${esc(p.clientName)}${nameNote}</dd>
    <dt>Sends result to</dt><dd><code>${target}</code></dd>
    <dt>Client ID</dt><dd><code>${esc(p.clientId)}</code></dd>
    <dt>Access</dt><dd>${esc(p.scopeSummary)}</dd>
  </dl>
  <p>Continue and you will sign in with Google next. This server stores only the
     connection it needs to answer your own requests, and never write access.</p>
  <form method="POST" action="/oauth/consent">
    <input type="hidden" name="pending_id" value="${esc(p.pendingId)}">
    <div class="row">
      <button class="go" type="submit" name="decision" value="allow">Continue to Google</button>
      <button class="no" type="submit" name="decision" value="deny">Cancel</button>
    </div>
  </form>
  <p class="foot">If you did not start this yourself, cancel. Nothing is shared until you continue.</p>
</div></body></html>`;
}

export function deniedPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Cancelled</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6;color-scheme:light dark;background:Canvas;color:CanvasText}</style>
</head><body><h2>Request cancelled</h2>
<p>Nothing was shared and no connection was made. You can close this tab.</p></body></html>`;
}
