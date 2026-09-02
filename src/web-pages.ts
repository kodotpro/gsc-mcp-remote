/**
 * The two public HTML pages a hosted deployment needs.
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
 * The tool descriptions below are the ones registered in server-factory.ts, and
 * the three indexing tools are described as unavailable here because they are —
 * they need a write scope this deployment never requests (see tools/submit-url.ts).
 *
 * Presentation lives in web-theme.ts, which carries k-o.pro's design language
 * within what the Content-Security-Policy allows.
 */

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
function claudeInstallUrl(mcpUrl: string): string {
  const params = new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: "Google Search Console",
    connectorUrl: mcpUrl,
  });
  return `https://claude.ai/customize/connectors?${params.toString()}`;
}

const SPARK =
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">` +
  `<path d="M12 2l2.2 6.2L20.5 10l-6.3 1.8L12 18l-2.2-6.2L3.5 10l6.3-1.8L12 2Z"/></svg>`;

/** name, what it answers — taken from the registrations in server-factory.ts. */
const TOOL_GROUPS: { title: string; blurb: string; tools: [string, string][] }[] = [
  {
    title: "Find the opportunity",
    blurb: "Where the traffic you do not have yet is hiding.",
    tools: [
      ["quick_wins", "Keywords at positions 4–15 worth pushing to page one"],
      ["ctr_opportunities", "Pages with the impressions but a CTR far below par for their position"],
      ["content_gaps", "Demand you already get impressions for but rank beyond 20"],
      ["content_recommendations", "Quick wins, gaps and cannibalisation cross-referenced into actions"],
      ["topic_cluster_performance", "How a group of pages performs as one thing"],
    ],
  },
  {
    title: "Diagnose the problem",
    blurb: "What changed, and whether it was ranking, CTR or demand.",
    tools: [
      ["traffic_drops", "The biggest losses, each with a diagnosed cause"],
      ["content_decay", "Pages declining across three consecutive 30-day periods"],
      ["cannibalization_check", "Queries where your own pages compete with each other"],
      ["check_alerts", "Position drops, CTR collapses, and pages gone from results"],
      ["ctr_vs_benchmark", "Your CTR per page against the benchmark for that position"],
    ],
  },
  {
    title: "Look it up",
    blurb: "The direct questions, answered against live data.",
    tools: [
      ["site_snapshot", "Clicks, impressions, CTR and position against the prior period"],
      ["advanced_search_analytics", "A custom query with your own dimensions and filters"],
      ["inspect_url", "Whether a URL is indexed, and why it is not"],
      ["verify_claim", "Check a number against live data before it goes in the deck"],
      ["generate_report", "A full markdown performance report"],
      ["multi_site_dashboard", "One health check across many properties at once"],
      ["list_properties", "Every property this account can reach, with permission level"],
      ["list_sitemaps", "Submitted sitemaps with status, errors and indexed counts"],
    ],
  },
  {
    title: "Image search",
    blurb: "Google's <code>type=image</code> surface, which most tools skip entirely.",
    tools: [
      ["image_keyword_overview", "Top image-search keywords for the site"],
      ["image_search_quick_wins", "Image queries at positions 4–15 with real impressions"],
      ["image_pages_overview", "Pages ranked by image-search performance"],
      ["image_keyword_trends", "Period-over-period movement for image queries"],
      ["image_impressions_no_clicks", "Real image impressions earning effectively zero clicks"],
      ["image_content_decay", "The decay check, run against image search"],
      ["compare_web_vs_image", "Each query side by side across web and image"],
      ["image_page_audit", "Audits images on your own pages for what drives image ranking"],
    ],
  },
  {
    title: "AI search, and your account",
    blurb: "The newer surface, plus the controls over your own data.",
    tools: [
      ["genai_conversation_queries", "AI-conversation exhaust hiding in ordinary query data"],
      ["set_default_property", "Save a default property so later calls can omit it"],
      ["export_my_data", "Everything this server stores about you"],
      ["disconnect_account", "Erase all of it and end your sessions"],
    ],
  },
];

function toolTable(group: (typeof TOOL_GROUPS)[number]): string {
  const rows = group.tools
    .map(([name, what]) => `<tr><td><span class="tool-name">${esc(name)}</span></td><td>${what}</td></tr>`)
    .join("");
  return `<h3>${esc(group.title)}</h3>
  <p class="note">${group.blurb}</p>
  <table>${rows}</table>`;
}

/** Answers here must stay traceable to the code or the README. */
const FAQ: [string, string][] = [
  [
    "What is an MCP server?",
    "Model Context Protocol is an open standard for connecting AI clients to " +
    "outside systems. An MCP server exposes a set of tools; the client decides " +
    "when to call them. This one exposes Search Console, so Claude can answer " +
    "questions about your search data without you exporting anything.",
  ],
  [
    "Do I need to install anything?",
    "No. It runs as a hosted remote MCP server, so you add it by URL and sign " +
    "in with Google. If you would rather your Google token never left your own " +
    "machine, the same server runs locally over stdio — the repository has the " +
    "instructions.",
  ],
  [
    "Can it change anything in my Search Console?",
    "No. The hosted service requests one Google permission, " +
    "<code>webmasters.readonly</code>, plus your email address to identify you. " +
    "It cannot edit properties, change sitemaps, or submit URLs for indexing. " +
    "Google's own per-property permissions apply on top, so you see exactly the " +
    "properties Google would show you.",
  ],
  [
    "Does it work across all my properties?",
    "Yes — that is the main reason it exists. Every property-scoped tool takes " +
    "the property as a parameter, so one connection covers your whole account. " +
    "You never edit a config file and restart to look at a different site.",
  ],
  [
    "Is my Search Console data stored anywhere?",
    "No. Each question is answered by fetching live from Google's API and " +
    "handing the result back to your Claude client; nothing is retained " +
    "afterwards. What is stored is your email, your Google account identifier, " +
    "an encrypted refresh token, and your chosen default property.",
  ],
  [
    "Is it free, and is it open source?",
    "The software is open source under Apache 2.0 and the hosted instance is " +
    "free to use. You can read exactly what runs here, or run your own copy.",
  ],
];

/**
 * Wording note: "google search console mcp" is the phrase people actually
 * search for (390/mo US, and roughly doubling quarter on quarter as of
 * 2026-09), well ahead of "search console mcp", "gsc mcp" and
 * "seo mcp server". It leads the title and the h1 for that reason; the rest of
 * the page is written to be read, not to repeat it.
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
    <p class="note">Opens claude.ai with the connector pre-filled. You confirm the
       URL, then sign in with Google.</p>`
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
       Add custom connector</strong>, and paste the URL below.</p>
  </div>
  <div class="step">
    <h3>Claude Code</h3>
    <pre><code>claude mcp add --transport http gsc ${esc(mcpUrl)}</code></pre>
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
       or as your own hosted deployment.</p>`
    : "";

  const body = `
<section class="hero">
  <div class="hero-bg" aria-hidden="true"><div class="hero-grid"></div><div class="hero-glow"></div></div>
  <div class="wrap hero-inner">
    <span class="kicker">Model Context Protocol server</span>
    <h1>Google Search Console MCP</h1>
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

  <h2>The 33 tools</h2>
  <p>Grouped by what you would reach for them to do. Each one takes the property
     as a parameter, so a single connection covers every site in your account.</p>
  ${TOOL_GROUPS.map(toolTable).join("\n")}
  <p class="note">The three indexing tools — <span class="tool-name">submit_url</span>,
     <span class="tool-name">submit_batch</span> and
     <span class="tool-name">submit_sitemap</span> — are part of the software but
     cannot run on this hosted instance: they need write access to your Google
     account, which this service never requests. They work on a self-hosted
     install configured with wider scopes.</p>

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

  <h2>Questions</h2>
  ${FAQ.map(([q, a]) => `<div class="faq"><h3>${esc(q)}</h3><p>${a}</p></div>`).join("\n")}
</div>`;

  const description =
    "A Google Search Console MCP server for Claude. Ask about quick wins, " +
    "traffic drops, cannibalisation and content decay across every property in " +
    "your account — read-only, open source, nothing to install.";

  const jsonLd: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Google Search Console MCP",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any",
      description,
      ...(base ? { url: base } : {}),
      ...(info.repoUrl ? { codeRepository: info.repoUrl } : {}),
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
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
    title: "Google Search Console MCP server for Claude",
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
    canonical: base ? `${base}/privacy` : undefined,
  });
}
