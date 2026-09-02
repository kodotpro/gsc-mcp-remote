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
 * host and requires a deliberate POST to continue.
 */
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

/** Redirect targets that belong to a first-party Claude client. */
const TRUSTED_HOSTS = new Set([
  "claude.ai",
  "www.claude.ai",
  "claude.com",
  "www.claude.com",
]);

function isLoopback(u: URL): boolean {
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/**
 * True when every redirect URI is somewhere a genuine MCP client would
 * receive a code: a Claude endpoint over HTTPS, or loopback (which only the
 * person's own machine can receive).
 */
export function redirectsAreRecognised(client: OAuthClientInformationFull): boolean {
  const uris = client.redirect_uris ?? [];
  if (uris.length === 0) return false;
  return uris.every((raw) => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return false;
    }
    if (isLoopback(u)) return u.protocol === "http:" || u.protocol === "https:";
    return u.protocol === "https:" && TRUSTED_HOSTS.has(u.hostname.toLowerCase());
  });
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
  let host = p.redirectUri;
  try {
    host = new URL(p.redirectUri).host;
  } catch {
    /* show the raw value */
  }
  const warn = p.recognised
    ? ""
    : `<div class="warn"><strong>This is not a Claude address.</strong> You are about to let
       <code>${esc(host)}</code> receive access to your Search Console data. If you did not
       start this from a Claude client you recognise, close this page.</div>`;

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
    <dt>Application</dt><dd>${esc(p.clientName)}</dd>
    <dt>Sends result to</dt><dd><code>${esc(host)}</code></dd>
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
