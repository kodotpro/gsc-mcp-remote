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
 * and true here: the hosted sign-in requests only `webmasters.readonly` (see
 * GOOGLE_SCOPES in auth/google-identity.ts), and `disconnect_account` erases
 * the stored credential rather than flagging it (see provider.disconnectUser).
 * The tool descriptions live in site-content.ts and are the ones registered in
 * server-factory.ts, and the three indexing tools are described as unavailable
 * here because they are — they need a write scope this deployment never
 * requests (see tools/submit-url.ts).
 *
 * Presentation lives in web-theme.ts, which carries k-o.pro's design language
 * within what the Content-Security-Policy allows.
 */

import {
  AUTHOR, ASSETS, CHANGELOG_URL, COMPARISON, EXAMPLES, FAQ, PRODUCT_NAME, SERVER_VERSION,
  SITE_UPDATED, TOOL_GROUPS, UPSTREAM, humanDate, type Example, type ToolGroup,
} from "./site-content.js";
import { canonicalBase, esc, shell } from "./web-theme.js";

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

/** "Google Search Console MCP Server" on the first line, the rest under it. */
export function productH1(): string {
  const cut = PRODUCT_NAME.indexOf(" - ");
  if (cut < 0) return `<h1>${esc(PRODUCT_NAME)}</h1>`;
  return `<h1>${esc(PRODUCT_NAME.slice(0, cut))}<span class="h1-sub">${esc(PRODUCT_NAME.slice(cut + 1))}</span></h1>`;
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
    ? `<div class="cta-row">
      <a class="btn glass-brand" href="${esc(installUrl)}" rel="noopener">${SPARK}Add to Claude</a>
      <a class="btn btn-ghost" href="#connecting">Other clients</a>
    </div>
    <p class="note">No Google Cloud project, no API keys, nothing to install. The button
       opens claude.ai with the connector pre-filled; you confirm the URL, then sign in
       with Google.</p>`
    : "";

  const connect = info.perUserSignIn
    ? `<div class="step">
    <h3>claude.ai and Claude Desktop</h3>
    <p>One click adds it with the details filled in — claude.ai will ask you to
       confirm the address before anything connects:</p>
    <div class="cta-row">
      <a class="btn glass-brand" href="${esc(installUrl)}" rel="noopener">${SPARK}Add to Claude</a>
    </div>
    <p class="note">Prefer to do it by hand? <strong>Settings &rarr; Connectors &rarr;
       Add custom connector</strong>, and paste the URL below. The
       <a href="/claude">Claude setup guide</a> covers sign-in and troubleshooting.</p>
  </div>
  <div class="step">
    <h3>Claude Code</h3>
    <pre><code>claude mcp add --transport http gsc ${esc(mcpUrl)}</code></pre>
    <p class="note">Then run <code>/mcp</code> inside Claude Code to sign in. Scopes and
       terminal workflows are in the <a href="/claude-code">Claude Code guide</a>.</p>
  </div>
  <div class="step">
    <h3>Any other MCP client</h3>
    <p>It is a standard remote MCP server over Streamable HTTP. Point any client
       that supports remote MCP at:</p>
    <pre><code>${esc(mcpUrl)}</code></pre>
  </div>
  <div class="step">
    <h3>What happens the first time</h3>
    <p>Your browser opens two screens, in this order. First <strong>this server's
       own consent page</strong>, naming the application that asked and the exact
       address the result will be sent to — it exists so a connection request you
       did not start is refusable. Then <strong>Google's sign-in</strong>, asking
       for read-only Search Console access and your email address, and nothing
       else.</p>
    <p>Then ask: <em>&ldquo;List my Search Console properties.&rdquo;</em></p>
  </div>`
    : `<div class="step">
    <h3>This instance is not open for sign-ups</h3>
    <p>It is configured for a single operator with a shared token rather than
       per-user Google sign-in. If you reached this page looking for the
       software itself, the repository explains how to run your own copy.</p>
  </div>`;

  const repoLine = info.repoUrl
    ? `<p>The code that runs here is at
       <a href="${esc(info.repoUrl)}" rel="noopener">${esc(info.repoUrl.replace(/^https?:\/\//, ""))}</a>,
       under Apache 2.0. You can read exactly what this service does, or run your
       own copy with your own Google credentials — the same 33 tools, over stdio
       or as your own hosted deployment. The <a href="/self-host">self-hosting
       guide</a> walks through both.</p>`
    : `<p>The <a href="/self-host">self-hosting guide</a> covers running your own copy.</p>`;

  // One captured answer per tool group, collapsed so the page stays scannable.
  const examples = TOOL_GROUPS.map((g) => {
    const ex = EXAMPLES[g.path];
    if (!ex) return "";
    return `<details class="example-toggle">
    <summary>${esc(g.title)} <span class="note">&middot; <span class="tool-name">${esc(ex.tool)}</span></span></summary>
    ${exampleFigure(ex)}
  </details>`;
  }).join("\n");

  const comparison = COMPARISON
    .map(([q, a]) => `<tr><td>${esc(q)}</td><td>${a}</td></tr>`)
    .join("");

  const body = `
<section class="hero">
  <div class="hero-bg" aria-hidden="true"><div class="hero-grid"></div><div class="hero-glow"></div></div>
  <div class="wrap hero-inner">
    <span class="kicker">Model Context Protocol server</span>
    ${productH1()}
    <p class="lede">Connect Search Console to Claude and ask what your data
       <em>means</em> — across every property in your account, in plain English,
       without exporting a single CSV.</p>
    ${heroCta}
    <ul class="pill-row">
      <li>33 tools</li>
      <li>Read-only access</li>
      <li>Every property, one connection</li>
      <li>Open source</li>
    </ul>
  </div>
</section>

<div class="wrap page-body">
  <h2 id="connecting">Connecting</h2>
  ${connect}

  <h2>What you can ask</h2>
  <p>Once connected, you ask questions instead of reading API rows. The answer
     comes back as a diagnosis, not a spreadsheet you still have to interpret:</p>
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
  <p>Every answer carries provenance: which property it came from, the exact
     parameters used, and the date range. An answer is never ambiguous about
     which site it describes. <code>position</code> is labelled as the
     impression-weighted average it actually is, rather than being passed off as
     a rank-tracker position.</p>

  <h2 id="real-answers">Real answers</h2>
  <p>One response per tool group, from this hosted instance against the author's
     own site, k-o.pro. They are shown as they came back, with rows trimmed where
     the caption says so. The <code>_meta</code> block at the top of each is the
     provenance every answer carries.</p>
  ${examples}

  <h2>The 33 tools</h2>
  <p>Grouped by what you would reach for them to do. Each one takes the property
     as a parameter, so a single connection covers every site in your account.</p>
  ${TOOL_GROUPS.map(toolTable).join("\n")}
  <p class="note">The three indexing tools — <span class="tool-name">submit_url</span>,
     <span class="tool-name">submit_batch</span> and
     <span class="tool-name">submit_sitemap</span> — are part of the software but
     cannot run on this hosted instance: they need write access to your Google
     account, which this service never requests. They work on a
     <a href="/self-host">self-hosted install</a> configured with wider scopes.</p>

  <h2>How it compares</h2>
  <p>The questions worth asking of any Search Console MCP server, answered for
     this one:</p>
  <table><tr><th>Question</th><th>This server</th></tr>${comparison}</table>

  <h2>Why a remote server</h2>
  <p>Most MCP servers are local-only: one process, on one laptop, holding one
     credential. That is why they cannot be shared, and why the claude.ai and
     Claude Desktop connector interfaces cannot add them at all.</p>
  <p>This one runs as a hosted service over Streamable HTTP, and implements the
     MCP authorization spec properly — dynamic client registration, PKCE,
     rotating tokens, and a consent screen of its own. That is what lets a
     connector interface onboard it from nothing but a URL. It also means a team
     shares one deployment while each person signs in as themselves and sees only
     their own properties. Nobody copies a credential anywhere.</p>

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
    <li>Your refresh token is encrypted with AES-256-GCM under a key held outside
        the database. Tokens issued to your client are stored only as hashes,
        expire after an hour, and rotate on refresh.</li>
  </ul>
  <p>Ask your Claude client to run <code>export_my_data</code> to see everything
     held about you, or <code>disconnect_account</code> to erase it. The full
     detail is in the <a href="/privacy">privacy policy</a>.</p>

  <h2>Running your own</h2>
  ${repoLine}

  <h2>Who builds it</h2>
  ${aboutBlock()}

  <h2>Questions</h2>
  ${FAQ.map(([q, a]) => `<div class="faq"><h3>${esc(q)}</h3><p>${a}</p></div>`).join("\n")}
</div>`;

  const description =
    "Connect Google Search Console to Claude by URL: 33 tools for quick wins, " +
    "traffic drops and AI Mode queries across every property. Read-only, free.";

  const jsonLd: unknown[] = [
    softwareJsonLd(base, info, description),
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map(([q, a]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: {
          "@type": "Answer",
          // Schema.org answers are plain prose; strip the inline markup.
          text: a.replace(/<[^>]+>/g, ""),
        },
      })),
    },
  ];

  return shell({
    title: PRODUCT_NAME,
    description,
    body,
    repoUrl: info.repoUrl,
    stars: info.stars,
    contactEmail: info.contactEmail,
    canonical: base ? `${base}/` : undefined,
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
    <li>No advertising or analytics trackers, and no cookies for tracking. The
        service sets exactly one cookie, and only while you are connecting: a
        random value that ties the sign-in you started to the browser you
        started it in, so nobody else can complete it in your name. It is
        <code>HttpOnly</code>, scoped to the sign-in routes, expires after ten
        minutes, and is cleared the moment the connection finishes. It carries
        no identifier and is never used to track you.</li>
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
    canonical: base ? `${base}/privacy` : undefined,
  });
}
