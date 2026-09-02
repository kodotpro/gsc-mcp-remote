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
 * particular are load-bearing for a reviewer and are true here: the hosted
 * sign-in requests only `webmasters.readonly` (see GOOGLE_SCOPES in
 * auth/google-identity.ts), and `disconnect_account` erases the stored
 * credential rather than flagging it (see provider.disconnectUser). Keep them
 * in step with the code — a privacy policy that overstates is worse than none.
 *
 * Presentation lives in web-theme.ts, which carries k-o.pro's design language
 * within what the Content-Security-Policy allows.
 */

import { esc, shell } from "./web-theme.js";

export interface SiteInfo {
  /** Public base URL, e.g. https://gsc.example.com */
  publicUrl: string;
  /** Contact address shown to users and to Google's reviewers. */
  contactEmail?: string;
  /** Repository URL, when the operator wants it advertised. */
  repoUrl?: string;
  /** Whether this instance actually offers per-user Google sign-in. */
  perUserSignIn: boolean;
  /** Star count for the header link; omitted when GitHub could not be reached. */
  stars?: number;
}

/**
 * Wording note: "Google Search Console MCP" is the phrase people actually
 * search for (390/mo US, and roughly doubling quarter on quarter as of
 * 2026-09), well ahead of "search console mcp", "gsc mcp" and
 * "seo mcp server". It leads the title and the h1 for that reason; the rest of
 * the page is written to be read, not to repeat it.
 */
export function landingPage(info: SiteInfo): string {
  const mcpUrl = `${info.publicUrl}/mcp`;

  const connect = info.perUserSignIn
    ? `<div class="step">
    <h3>1. Add the connector</h3>
    <p>In claude.ai, open <strong>Settings &rarr; Connectors &rarr; Add custom
       connector</strong> and paste this URL:</p>
    <pre><code>${esc(mcpUrl)}</code></pre>
  </div>
  <div class="step">
    <h3>2. Or add it in Claude Code</h3>
    <pre><code>claude mcp add --transport http gsc ${esc(mcpUrl)}</code></pre>
  </div>
  <div class="step">
    <h3>3. Sign in with Google</h3>
    <p>A browser tab opens the first time you use it. You sign in with your own
       Google account, and Google&rsquo;s own Search Console permissions decide what
       you can see — this service cannot show you a property Google would not
       show you, and it never gains write access.</p>
  </div>`
    : `<div class="step">
    <h3>This instance is not open for sign-ups</h3>
    <p>It is configured for a single operator with a shared token rather than
       per-user Google sign-in. If you reached this page looking for the
       software itself, the repository explains how to run your own copy.</p>
  </div>`;

  const body = `
<section class="hero">
  <div class="hero-bg" aria-hidden="true"><div class="hero-grid"></div><div class="hero-glow"></div></div>
  <div class="wrap hero-inner">
    <span class="kicker">Model Context Protocol server</span>
    <h1>Google Search Console MCP</h1>
    <p class="lede">Connect Search Console to Claude and ask what your data
       <em>means</em> — across every property in your account, in plain English,
       without exporting a single CSV.</p>
    <ul class="pill-row">
      <li>33 tools</li>
      <li>Read-only access</li>
      <li>Every property, one connection</li>
      <li>Open source</li>
    </ul>
  </div>
</section>

<div class="wrap page-body">
  <h2>What you can ask</h2>
  <p>Once connected, you ask your Claude client questions instead of reading raw
     API rows:</p>
  <div class="grid grid-2">
    <div class="card">
      <h3>&ldquo;What am I almost ranking for?&rdquo;</h3>
      <p class="note">Queries sitting just off page one, where a small change
         moves the most traffic.</p>
    </div>
    <div class="card">
      <h3>&ldquo;Which pages lost traffic, and why?&rdquo;</h3>
      <p class="note">Traffic-drop diagnosis that separates a ranking loss from
         lost impressions or a seasonal dip.</p>
    </div>
    <div class="card">
      <h3>&ldquo;Am I cannibalising myself?&rdquo;</h3>
      <p class="note">Pages competing for the same query, and which one Google
         actually prefers.</p>
    </div>
    <div class="card">
      <h3>&ldquo;What&rsquo;s decaying?&rdquo;</h3>
      <p class="note">Content sliding month over month while you weren&rsquo;t
         looking.</p>
    </div>
  </div>
  <p>Thirty-three tools cover quick wins, traffic-drop diagnosis, content decay
     and gaps, cannibalisation, CTR benchmarking, topic clusters, multi-property
     dashboards, URL inspection and a full image-search suite. Every
     property-scoped tool takes the property as a parameter, so one connection
     covers your whole account rather than a single site.</p>

  <h2>Connecting</h2>
  ${connect}

  <h2>What it reads, and what it stores</h2>
  <ul>
    <li>It requests exactly one Google permission:
        <code>webmasters.readonly</code> — read-only access to Search Console.
        It cannot change your site, submit URLs, or touch anything else in your
        Google account.</li>
    <li>It stores your email address, your Google account identifier, and an
        encrypted Google refresh token, so it can answer your requests without
        asking you to sign in every time.</li>
    <li>It does not store your Search Console data. Results are fetched live for
        each question and passed straight back to your Claude client.</li>
  </ul>
  <p>Ask your Claude client to run <code>export_my_data</code> to see everything
     held about you, or <code>disconnect_account</code> to erase it. The full
     detail is in the <a href="/privacy">privacy policy</a>.</p>
</div>`;

  return shell({
    title: "Google Search Console MCP server for Claude",
    description:
      "A Google Search Console MCP server for Claude. Ask about quick wins, " +
      "traffic drops, cannibalisation and content decay across every property " +
      "in your account — read-only, open source.",
    body,
    repoUrl: info.repoUrl,
    stars: info.stars,
    contactEmail: info.contactEmail,
  });
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

  const body = `
<section class="hero">
  <div class="hero-bg" aria-hidden="true"><div class="hero-grid"></div></div>
  <div class="wrap hero-inner">
    <span class="kicker">Legal</span>
    <h1>Privacy policy</h1>
    <p class="lede">What <code>${esc(host)}</code> does with your data when you
       connect your Google account to it. It is written to match what the
       software actually does; the source is public, so it can be checked.</p>
  </div>
</section>

<div class="wrap page-body">
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
</div>`;

  return shell({
    title: "Privacy policy",
    description: `What ${host} collects when you connect your Google account, and how to erase it.`,
    body,
    repoUrl: info.repoUrl,
    stars: info.stars,
    contactEmail: info.contactEmail,
  });
}
