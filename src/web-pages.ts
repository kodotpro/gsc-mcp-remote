/**
 * The landing page and the privacy policy, plus the pieces the guide pages
 * (web-guides.ts) share with them.
 *
 * Google's OAuth verification for a sensitive scope requires both an "App home
 * page" describing the service and a privacy policy, reachable over HTTPS on
 * the SAME domain as the OAuth callback. Serving them from this process is the
 * simplest way to guarantee that: they cannot drift from the deployment, and
 * there is no second thing to host.
 *
 * Everything either page claims is written from what the code does, because a
 * Google reviewer reads both on the same domain. Two claims are load-bearing
 * and true here: the hosted sign-in requests one Search Console scope,
 * `webmasters.readonly`, plus `openid` and `email` only to identify the account
 * (see GOOGLE_SCOPES in auth/google-identity.ts), and `disconnect_account` erases
 * the stored credential rather than flagging it (see provider.disconnectUser).
 * The tool descriptions live in site-content.ts and are the ones registered in
 * server-factory.ts, and the two indexing tools are described as unavailable
 * here because they are — they need a write scope this deployment never
 * requests (see tools/submit-url.ts).
 *
 * Presentation lives in web-theme.ts, which carries k-o.pro's design language
 * within what the Content-Security-Policy allows.
 */

import {
  AUTHOR, ASSETS, CHANGELOG_URL, PRODUCT_NAME, SERVER_VERSION,
  SITE_UPDATED, TOOL_GROUPS, UPSTREAM, WHATS_NEW, humanDate, type Example, type ToolGroup,
} from "./site-content.js";
import { canonicalBase, esc, shell, markdownPathFor } from "./web-theme.js";
import { demoQuickWins, demoSnapshot, demoTrafficDrops, flowDiagram } from "./web-demos.js";

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
 * Deep link into claude.ai's "Add custom connector" dialog with the name and
 * URL pre-filled. Confirmed supported by Anthropic in
 * anthropics/claude-ai-mcp#74; claude.ai shows its own "verify this URL" notice
 * when the fields arrive from an external link, so the person still confirms.
 *
 * Only claude.ai gets a button. Cursor and VS Code both have install deep links
 * in circulation, but neither format is stated in their own documentation, and
 * a button that silently does nothing is worse than a command someone can read.
 */
export function claudeInstallUrl(mcpUrl: string): string {
  const params = new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: "Google Search Console",
    connectorUrl: mcpUrl,
  });
  return `https://claude.ai/customize/connectors?${params.toString()}`;
}

export const SPARK =
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">` +
  `<path d="M12 2l2.2 6.2L20.5 10l-6.3 1.8L12 18l-2.2-6.2L3.5 10l6.3-1.8L12 2Z"/></svg>`;

// -- pieces shared with the guide pages --------------------------------------

/**
 * "Google Search Console MCP Server" on the first line, the rest under it.
 *
 * The space between the two halves is kept in the markup. The sub-line is a
 * block, so the space is invisible on screen — but without it every reader that
 * works from the text (a crawler, an AI fetcher, a screen reader's text view)
 * gets "...Server- by k-o.pro (remote)" as the page's one h1.
 */
export function productH1(): string {
  const cut = PRODUCT_NAME.indexOf(" - ");
  // Each word is its own inline-block so it can rise out of a blur in turn
  // (.hw in web-theme.ts). The spaces stay between the spans, as text, so the
  // heading still reads as ordinary words to anything that does not animate.
  const words = (text: string, from: number): string =>
    text.split(" ").map((w, i) => `<span class="hw" style="--i:${from + i}">${esc(w)}</span>`).join(" ");
  if (cut < 0) return `<h1>${words(PRODUCT_NAME, 0)}</h1>`;
  const head = PRODUCT_NAME.slice(0, cut);
  return `<h1>${words(head, 0)} <span class="h1-sub fade">${esc(PRODUCT_NAME.slice(cut + 1))}</span></h1>`;
}

export function toolTable(group: ToolGroup): string {
  const rows = group.tools
    .map((t) => `<tr><td><span class="tool-name">${esc(t.name)}</span></td><td>${esc(t.what)}</td></tr>`)
    .join("");
  return `<h3>${esc(group.title)}</h3>
  <p class="note">${group.blurbHtml}</p>
  <table>${rows}</table>
  <p class="more"><a href="${esc(group.path)}">${esc(group.title)}: parameters and a real example &rarr;</a></p>`;
}

/** A captured tool response, shown as it came back. */
export function exampleFigure(ex: Example): string {
  const trimmed = ex.trimmedNote ? `; ${esc(ex.trimmedNote)}` : "";
  return `<figure class="example">
    <figcaption><strong>Asked:</strong> <span class="ask">&ldquo;${esc(ex.asked)}&rdquo;</span><br>
      <span class="note"><span class="tool-name">${esc(ex.tool)}</span> on the hosted instance,
      ${esc(humanDate(ex.captured))}${trimmed}</span></figcaption>
    <pre><code>${esc(JSON.stringify(ex.output, null, 2))}</code></pre>
    <p class="note">${esc(ex.reading)}</p>
  </figure>`;
}

/** The Person behind the project, referenced by @id from every page's schema. */
export function authorJsonLd(base: string | undefined): Record<string, unknown> {
  return {
    "@type": "Person",
    ...(base ? { "@id": `${base}/#author` } : {}),
    name: AUTHOR.name,
    url: AUTHOR.url,
    sameAs: AUTHOR.sameAs,
  };
}

export function softwareJsonLd(base: string | undefined, info: SiteInfo, description: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    ...(base ? { "@id": `${base}/#software`, url: `${base}/`, image: `${base}${ASSETS.ogImage}` } : {}),
    name: PRODUCT_NAME,
    alternateName: ["gsc-mcp-remote", "GSC MCP by k-o.pro"],
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Model Context Protocol server",
    operatingSystem: "Any",
    description,
    softwareVersion: SERVER_VERSION,
    dateModified: SITE_UPDATED,
    isAccessibleForFree: true,
    featureList: TOOL_GROUPS.map((g) => `${g.title}: ${g.tools.map((t) => t.name).join(", ")}`),
    ...(info.repoUrl ? { codeRepository: info.repoUrl, sameAs: [info.repoUrl] } : {}),
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: authorJsonLd(base),
    publisher: base ? { "@id": `${base}/#author` } : authorJsonLd(base),
    contributor: { "@type": "Person", name: UPSTREAM.author, url: UPSTREAM.authorUrl },
    isBasedOn: UPSTREAM.repoUrl,
  };
}

/** Byline, version and date: who built it, what it is based on, how current it is. */
export function aboutBlock(): string {
  return `<p class="byline">Built and run by <a href="${esc(AUTHOR.url)}" rel="noopener">${esc(AUTHOR.name)}</a>,
     an SEO with nine years in the field who builds tools at
     <a href="https://k-o.pro/" rel="noopener">k-o.pro</a>. It is a fork of
     <a href="${esc(UPSTREAM.repoUrl)}" rel="noopener">${esc(UPSTREAM.name)}</a> by
     <a href="${esc(UPSTREAM.authorUrl)}" rel="noopener">${esc(UPSTREAM.author)}</a>: the
     analysis logic and most of the tool set are his design, and this fork adds
     multi-property access, the remote server and per-user sign-in.</p>
  <p class="note">Version ${esc(SERVER_VERSION)} &middot; page updated
     ${esc(humanDate(SITE_UPDATED))} &middot;
     <a href="${esc(CHANGELOG_URL)}" rel="noopener">changelog</a></p>`;
}

// -- the landing page ---------------------------------------------------------

/**
 * Wording note: "google search console mcp" is the phrase people actually
 * search for (390/mo US, and roughly doubling quarter on quarter as of
 * 2026-09), well ahead of "search console mcp", "gsc mcp" and
 * "seo mcp server". The product name leads with it, and the name is used
 * verbatim in the title, the h1, the schema and the README so every surface
 * refers to the same thing.
 */
export function landingPage(info: SiteInfo): string {
  const mcpUrl = `${info.publicUrl}/mcp`;
  const base = canonicalBase(info.publicUrl);
  const installUrl = claudeInstallUrl(mcpUrl);

  const heroCta = info.perUserSignIn
    ? `<div class="cta-row fade" style="--d:2">
      <a class="btn glass-brand" href="${esc(installUrl)}" rel="noopener">${SPARK}Add to Claude</a>
      <a class="btn btn-ghost" href="#connecting">Other clients</a>
    </div>
    <p class="note fade" style="--d:3">No Google Cloud project, no API keys, nothing to install.
       You confirm the URL in claude.ai, then sign in with Google.</p>`
    : "";

  const connect = info.perUserSignIn
    ? `<div class="step st">
    <h3>claude.ai and Claude Desktop</h3>
    <p>One click adds it with the details filled in. claude.ai asks you to
       confirm the address before anything connects.</p>
    <div class="cta-row">
      <a class="btn glass-brand" href="${esc(installUrl)}" rel="noopener">${SPARK}Add to Claude</a>
    </div>
    <p class="note">By hand: <strong>Settings &rarr; Connectors &rarr; Add custom
       connector</strong>, and paste <code>${esc(mcpUrl)}</code>. The
       <a href="/claude">Claude setup guide</a> covers sign-in and troubleshooting.</p>
  </div>
  <div class="step st">
    <h3>Claude Code</h3>
    <pre><code>claude mcp add --transport http gsc ${esc(mcpUrl)}</code></pre>
    <p class="note">Then run <code>/mcp</code> inside Claude Code to sign in. More in the
       <a href="/claude-code">Claude Code guide</a>.</p>
  </div>
  <div class="step st">
    <h3>Any other MCP client</h3>
    <p>It is a standard remote MCP server over Streamable HTTP. Point the client at
       <code>${esc(mcpUrl)}</code>.</p>
  </div>
  <p class="note">The first time, your browser shows two screens: this server's own
     consent page, naming the application that asked, and then Google's sign-in, asking
     for read-only Search Console access and your email address. Then ask
     <em class="ask">&ldquo;List my Search Console properties.&rdquo;</em></p>`
    : `<div class="step">
    <h3>This instance is not open for sign-ups</h3>
    <p>It is configured for a single operator with a shared token rather than
       per-user Google sign-in. If you reached this page looking for the
       software itself, the repository explains how to run your own copy.</p>
  </div>`;

  const repoLine = info.repoUrl
    ? `<p>The code that runs here is at
       <a href="${esc(info.repoUrl)}" rel="noopener">${esc(info.repoUrl.replace(/^https?:\/\//, ""))}</a>,
       under Apache 2.0. Read exactly what this service does, or
       <a href="/self-host">run your own copy</a> with your own Google credentials.</p>`
    : `<p>The <a href="/self-host">self-hosting guide</a> covers running your own copy.</p>`;

  // The four questions people open with, each linked to the page that documents
  // the tools behind it.
  const asks: [string, string, string][] = [
    ["What am I almost ranking for?", "Queries sitting just off page one, where a small change moves the most traffic.", "/tools/opportunities"],
    ["Which pages lost traffic, and why?", "A diagnosis per page that separates a ranking loss from a CTR collapse or falling demand.", "/tools/diagnostics"],
    ["Am I cannibalising myself?", "Pages competing for the same query, and which one Google actually prefers.", "/tools/diagnostics"],
    ["How is the site doing?", "Clicks, impressions, CTR and position against the previous period, for one property or all of them.", "/tools/lookups"],
  ];
  const askCards = asks
    .map(([q, what, path]) => `<div class="card lift st">
      <h3>&ldquo;${esc(q)}&rdquo;</h3>
      <p class="note">${esc(what)}</p>
      <p class="go"><a class="cover" href="${esc(path)}">See the tools <span class="arw">&rarr;</span></a></p>
    </div>`)
    .join("\n");

  const groupCards = TOOL_GROUPS
    .map((g) => `<div class="card lift st">
      <p class="count">${g.tools.length} tools</p>
      <h3>${esc(g.title)}</h3>
      <p class="note">${g.blurbHtml}</p>
      <p class="go"><a class="cover" href="${esc(g.path)}">Parameters and a real example <span class="arw">&rarr;</span></a></p>
    </div>`)
    .join("\n");

  const news = WHATS_NEW
    .map((n) => `<li><span class="ver">v${esc(n.version)}</span> <span>${n.html}</span></li>`)
    .join("\n");

  const body = `
<section class="hero">
  <div class="hero-bg" aria-hidden="true"><div class="hero-grid"></div><div class="hero-glow"></div></div>
  <div class="wrap hero-inner">
    <span class="status fade" style="--d:-6"><span class="dot" aria-hidden="true"></span>MCP server &middot; v${esc(SERVER_VERSION)} &middot; read-only</span>
    ${productH1()}
    <p class="lede fade" style="--d:1">Connect Search Console to Claude and ask what your data
       <span class="mark">actually means</span>, across every property in your account,
       in plain English, without exporting a single CSV.</p>
    ${heroCta}
  </div>
</section>

<div class="wrap page-body">
  <h2 id="what-you-can-ask">What you can ask</h2>
  <p>You ask questions instead of reading API rows. The answer comes back as a
     diagnosis, with the property, the parameters and the date range it was
     computed from.</p>
  <div class="grid grid-2">
    ${askCards}
  </div>

  <h2 id="what-you-get">What the answer looks like</h2>
  <p>In a client that supports MCP Apps, ten tools draw their result as cards and
     sortable tables beside the conversation. Every other client gets the same
     result as text, and the data Claude reads is identical either way.</p>
  ${demoSnapshot()}
  ${demoQuickWins()}
  ${demoTrafficDrops()}
  <p class="more"><a href="/tools#real-answers">Real, unedited output from the hosted instance <span class="arw">&rarr;</span></a></p>

  <h2 id="connecting">Connecting</h2>
  ${connect}

  <h2 id="tools">32 tools, grouped by job</h2>
  <p>Each tool takes the property as a parameter, so one connection covers every
     site in your account. Thirty run on a hosted instance; the two that write to
     Google need a <a href="/self-host">self-hosted install</a>.</p>
  <div class="grid grid-3">
    ${groupCards}
  </div>
  <p class="more"><a href="/tools">Every tool on one page <span class="arw">&rarr;</span></a></p>

  <h2 id="how-it-works">How it works, and what it keeps</h2>
  ${flowDiagram()}
  <ul>
    <li>It requests exactly one Search Console permission,
        <code>webmasters.readonly</code>, plus Google's basic <code>openid</code> and
        <code>email</code> scopes, only to identify your account. It cannot change
        your site, submit URLs, or touch anything else in your Google account.</li>
    <li>It stores your email address, your Google account identifier and an
        encrypted Google refresh token. It does not store your Search Console
        data: results are fetched live for each question and passed straight back.</li>
    <li>Ask Claude to run <code>export_my_data</code> to see everything held about
        you, or <code>disconnect_account</code> to erase it.</li>
  </ul>
  <p class="more"><a href="/privacy">The privacy policy <span class="arw">&rarr;</span></a>
     &nbsp; <a href="/compare">How it compares <span class="arw">&rarr;</span></a>
     &nbsp; <a href="/faq">Questions <span class="arw">&rarr;</span></a></p>

  <h2 id="open-source">Open source, and still moving</h2>
  ${repoLine}
  <ul class="news st">
    ${news}
  </ul>
  ${aboutBlock()}
</div>`;

  const description =
    "Connect Google Search Console to Claude by URL: 32 tools for quick wins, " +
    "traffic drops and AI Mode queries across every property. Read-only, free.";

  // The FAQ and its FAQPage markup live on /faq now, with the questions.
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: PRODUCT_NAME,
    ...(base ? { url: `${base}/` } : {}),
  };
  const jsonLd: unknown[] = [softwareJsonLd(base, info, description), website];

  return shell({
    title: PRODUCT_NAME,
    description,
    body,
    repoUrl: info.repoUrl,
    stars: info.stars,
    contactEmail: info.contactEmail,
    canonical: base ? `${base}/` : undefined,
    markdownPath: markdownPathFor("/"),
    jsonLd,
  });
}

export function privacyPage(info: SiteInfo): string {
  const base = canonicalBase(info.publicUrl);
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
        <td>To recognise valid requests. The tokens themselves are never stored, so a copy of the database does not yield working access tokens</td></tr>
    <tr><td>Server logs: session open and close events, errors, timestamps</td>
        <td>To keep the service running and diagnose failures</td></tr>
  </table>

  <h2>What is not collected</h2>
  <ul>
    <li><strong>Your Search Console data is not stored.</strong> Each question is
        answered by fetching live from Google's API and returning the result to
        your Claude client. Nothing is retained afterwards.</li>
    <li>Logs deliberately exclude tokens and the content of your queries.</li>
    <li>No advertising or analytics trackers, and no cookies for tracking. The
        service sets exactly one cookie, and only while you are connecting: a
        random value that ties the sign-in you started to the browser you
        started it in, so nobody else can complete it in your name. It is
        <code>HttpOnly</code>, scoped to the sign-in routes, expires after ten
        minutes, and is cleared the moment the connection finishes. It carries
        no identifier and is never used to track you.</li>
  </ul>

  <h2>What access is requested</h2>
  <p>One Search Console permission: <code>https://www.googleapis.com/auth/webmasters.readonly</code>.
     This is read-only. Signing in also uses Google's basic <code>openid</code>
     and <code>email</code> scopes, solely to identify your account. The service
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

  <h2>Google API user data</h2>
  <p>This service's use and transfer to any other app of information received
     from Google APIs will adhere to the
     <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener">Google API Services User Data Policy</a>,
     including the Limited Use requirements. Data obtained through the Search
     Console API is transferred only to your own Claude client, in answer to the
     questions you ask there. It is not transferred to anyone else, not used for
     advertising, and not used to develop, improve or train any machine-learning
     or AI model.</p>

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
  <p>If the operator keeps backups of the database, an erased connection can
     remain in those backups until they expire (up to 30 days by default). Stored
     credentials in a backup stay encrypted with a key that is kept outside it.</p>

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
    canonical: base ? `${base}/privacy` : undefined,
    markdownPath: markdownPathFor("/privacy"),
  });
}
