/**
 * The two public HTML pages a hosted deployment needs.
 *
 * Google's OAuth verification for a sensitive scope requires both an "App home
 * page" describing the service and a privacy policy, reachable over HTTPS on
 * the SAME domain as the OAuth callback. Serving them from this process is the
 * simplest way to guarantee that: they cannot drift from the deployment, and
 * there is no second thing to host.
 *
 * The privacy text is written from what the code actually does. Two claims in
 * particular are load-bearing for a reviewer and are true here: the server
 * requests only `webmasters.readonly`, and `disconnect_account` erases the
 * stored credential rather than flagging it (see provider.disconnectUser).
 * Keep them in step with the code — a privacy policy that overstates is worse
 * than none.
 */

const esc = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const STYLE = `
 :root{color-scheme:light dark}
 *{box-sizing:border-box}
 body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.65;margin:0;
      background:Canvas;color:CanvasText}
 .wrap{max-width:44rem;margin:0 auto;padding:3rem 1.5rem 4rem}
 h1{font-size:1.75rem;line-height:1.25;margin:0 0 .5rem}
 h2{font-size:1.1rem;margin:2.25rem 0 .6rem}
 p,li{margin:0 0 .9rem}
 ul{padding-left:1.25rem}
 code{font-family:ui-monospace,Menlo,monospace;font-size:.88em;
      background:color-mix(in srgb,CanvasText 8%,transparent);padding:.12em .38em;border-radius:4px}
 pre{background:color-mix(in srgb,CanvasText 6%,transparent);padding:.9rem 1.1rem;border-radius:8px;
     overflow-x:auto;font-size:.86rem}
 pre code{background:none;padding:0}
 .lede{font-size:1.06rem;opacity:.88}
 .meta{font-size:.86rem;opacity:.65;margin-top:2.5rem;border-top:1px solid color-mix(in srgb,CanvasText 18%,transparent);padding-top:1rem}
 a{color:inherit;text-decoration-color:color-mix(in srgb,CanvasText 45%,transparent)}
 table{border-collapse:collapse;width:100%;font-size:.92rem;margin:0 0 1rem}
 th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid color-mix(in srgb,CanvasText 15%,transparent);vertical-align:top}
 th{font-weight:600;opacity:.75}
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><div class="wrap">${body}</div></body></html>`;
}

export interface SiteInfo {
  /** Public base URL, e.g. https://gsc.example.com */
  publicUrl: string;
  /** Contact address shown to users and to Google's reviewers. */
  contactEmail?: string;
  /** Repository URL, when the operator wants it advertised. */
  repoUrl?: string;
  /** Whether this instance actually offers per-user Google sign-in. */
  perUserSignIn: boolean;
}

export function landingPage(info: SiteInfo): string {
  const mcpUrl = `${info.publicUrl}/mcp`;
  const contact = info.contactEmail
    ? `<p>Questions, or a problem with the service: <a href="mailto:${esc(info.contactEmail)}">${esc(info.contactEmail)}</a>.</p>`
    : "";
  const repo = info.repoUrl
    ? `<p>This service is open source. The code that runs here is at <a href="${esc(info.repoUrl)}" rel="noopener">${esc(info.repoUrl)}</a>, and you can run your own copy instead of using this one.</p>`
    : "";

  const connect = info.perUserSignIn
    ? `<h2>Connecting</h2>
  <p>Add it as a custom connector in your Claude client and sign in with Google when the browser opens:</p>
  <pre><code>${esc(mcpUrl)}</code></pre>
  <p>In claude.ai: <strong>Settings → Connectors → Add custom connector</strong>, and paste that URL. In Claude Code:</p>
  <pre><code>claude mcp add --transport http gsc ${esc(mcpUrl)}</code></pre>
  <p>You sign in with your own Google account. Google's own Search Console
     permissions decide what you can see — this service cannot show you a
     property Google would not show you, and it never gains write access.</p>`
    : `<h2>Connecting</h2>
  <p>This instance is configured for a single operator with a shared token
     rather than per-user Google sign-in, so it is not open for public
     sign-ups. If you reached this page looking for the software itself, the
     repository below explains how to run your own.</p>`;

  return shell("Google Search Console MCP", `
  <h1>Google Search Console for Claude</h1>
  <p class="lede">A Model Context Protocol server that answers questions about your
     Search Console data — across every property in your account — instead of
     handing back raw API rows.</p>

  <h2>What it does</h2>
  <p>Once connected, you can ask your Claude client things like <em>"what keywords
     am I almost ranking for?"</em>, <em>"which pages lost the most traffic last
     month, and why?"</em>, or <em>"do I have pages cannibalising each other?"</em>
     Thirty-three analysis tools cover quick wins, traffic-drop diagnosis,
     content decay, cannibalisation, CTR benchmarking, multi-property
     dashboards and a full image-search suite.</p>
  <p>Every property-scoped tool takes the property as a parameter, so one
     connection covers your whole account rather than a single site.</p>

  ${connect}

  <h2>What it reads, and what it stores</h2>
  <ul>
    <li>It requests exactly one Google permission: <code>webmasters.readonly</code>
        — read-only access to Search Console. It cannot change your site,
        submit URLs, or touch anything else in your Google account.</li>
    <li>It stores your email address, your Google account identifier, and an
        encrypted Google refresh token, so it can answer your requests without
        asking you to sign in every time.</li>
    <li>It does not store your Search Console data. Results are fetched live
        for each question and passed straight back to your Claude client.</li>
  </ul>
  <p>Ask your Claude client to <code>export_my_data</code> to see everything held
     about you, or <code>disconnect_account</code> to erase it. The full detail is
     in the <a href="/privacy">privacy policy</a>.</p>

  ${repo}
  ${contact}
  <p class="meta">Not affiliated with or endorsed by Google. "Google" and
     "Google Search Console" are trademarks of Google LLC.</p>
`);
}

export function privacyPage(info: SiteInfo): string {
  const host = (() => {
    try {
      return new URL(info.publicUrl).host;
    } catch {
      return info.publicUrl;
    }
  })();
  const contact = info.contactEmail
    ? `<p>For any question about your data, or to ask for it to be deleted by hand,
        write to <a href="mailto:${esc(info.contactEmail)}">${esc(info.contactEmail)}</a>.</p>`
    : `<p>This instance has not published a contact address. If you did not set this
        service up yourself, ask whoever gave you the link how to reach its operator.</p>`;

  return shell("Privacy policy", `
  <h1>Privacy policy</h1>
  <p class="lede">This page describes what <code>${esc(host)}</code> does with your data
     when you connect your Google account to it. It is written to match what the
     software actually does; the source is public, so it can be checked.</p>

  <h2>Who runs this service</h2>
  <p>An instance of the open-source <em>gsc-mcp-remote</em> server, operated by
     whoever deployed it at <code>${esc(host)}</code>. It is not operated by,
     affiliated with, or endorsed by Google or by Anthropic.</p>

  <h2>What is collected</h2>
  <table>
    <tr><th>Data</th><th>Why</th></tr>
    <tr><td>Your Google account email address and account identifier</td>
        <td>To recognise you across sessions and to attach your saved settings and stored credential to you</td></tr>
    <tr><td>A Google refresh token, encrypted at rest</td>
        <td>To call the Search Console API on your behalf without making you sign in again for every question</td></tr>
    <tr><td>Your chosen default property, if you set one</td>
        <td>So tool calls that do not name a property can use it</td></tr>
    <tr><td>Irreversible hashes of the access tokens issued to your Claude client</td>
        <td>To recognise valid requests. The tokens themselves are never stored, so a copy of the database does not yield working credentials</td></tr>
    <tr><td>Server logs: session open and close events, errors, timestamps</td>
        <td>To keep the service running and diagnose failures</td></tr>
  </table>

  <h2>What is not collected</h2>
  <ul>
    <li><strong>Your Search Console data is not stored.</strong> Each question is
        answered by fetching live from Google's API and returning the result to
        your Claude client. Nothing is retained afterwards.</li>
    <li>Logs deliberately exclude tokens and the content of your queries.</li>
    <li>No advertising or analytics trackers, and no cookies for tracking.</li>
  </ul>

  <h2>What access is requested</h2>
  <p>One Google permission only: <code>https://www.googleapis.com/auth/webmasters.readonly</code>,
     plus your email address for identification. This is read-only. The service
     cannot submit URLs for indexing, change sitemaps, modify your properties,
     or reach any other Google service. Google's own Search Console permissions
     still apply on top: you see exactly the properties Google would show you.</p>

  <h2>How your data is protected</h2>
  <ul>
    <li>Your Google refresh token is encrypted with AES-256-GCM under a key held
        in a file readable only by the service account, never in the database
        alongside the data it protects.</li>
    <li>Tokens issued to your Claude client are random, stored only as SHA-256
        hashes, expire after an hour, and rotate on refresh. Presenting an
        already-rotated token invalidates every session it belonged to.</li>
    <li>All traffic is over HTTPS.</li>
    <li>Your Google credentials are never sent to your Claude client, and the
        tokens issued to your Claude client are never sent to Google.</li>
  </ul>

  <h2>Sharing</h2>
  <p>Your data is not sold, rented, or shared with third parties. It is not used
     for advertising, and it is not used to train any machine-learning or AI
     model. The only third party involved is Google, whose API is called on your
     behalf with the permission you granted.</p>

  <h2>How long it is kept, and how to delete it</h2>
  <p>Data is kept until you remove it. You can do that at any time, in either of
     two ways, and doing either is enough:</p>
  <ul>
    <li>Ask your Claude client to run <code>disconnect_account</code>. This erases the
        stored Google credential, every token, and your saved settings, and ends
        your open sessions immediately.</li>
    <li>Remove the app at
        <a href="https://myaccount.google.com/permissions" rel="noopener">myaccount.google.com/permissions</a>.
        The stored credential stops working, and the service erases it the next
        time it tries to use it.</li>
  </ul>
  <p>Run <code>export_my_data</code> at any time to see everything held about you.
     Expired tokens and abandoned sign-in attempts are swept automatically.</p>

  <h2>Changes</h2>
  <p>If this policy changes materially, the change will appear on this page. The
     repository's history is the authoritative record of what changed and when.</p>

  <h2>Contact</h2>
  ${contact}
  <p class="meta"><a href="/">Back to the service description</a></p>
`);
}
