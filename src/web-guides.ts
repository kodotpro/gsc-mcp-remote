/**
 * The guide pages: client setup, one page per tool group, the AI Mode query
 * page and self-hosting. Plus /llms.txt and the sitemap, which are generated
 * from the same registry so a page cannot exist without being listed, or be
 * listed without existing.
 *
 * The rules in web-pages.ts and site-content.ts apply here too: tool names,
 * parameters and defaults come from site-content.ts (copied from the
 * registrations in server-factory.ts), claims about Claude Code come from its
 * documentation, and claims about Google carry a link and a date.
 */

import {
  ALL_TOOL_NAMES, AUTHOR, COMPARISON, EXAMPLES, FAQ, GUIDES, PRODUCT_NAME, PROPERTY_INDEPENDENT, README_URL, SELF_HOSTING_DOC_URL,
  SERVER_VERSION, SITE_UPDATED, SITE_URL_NOTE, TOOL_GROUPS, UPSTREAM, WRITE_TOOLS, humanDate, type ToolDoc, type ToolGroup,
} from "./site-content.js";
import { breadcrumbJsonLd, canonicalBase, crumbs, esc, markdownPathFor, shell, type Crumb } from "./web-theme.js";
import { htmlToMarkdown } from "./markdown.js";
import { parse } from "node-html-parser";
import {
  SPARK, aboutBlock, authorJsonLd, claudeInstallUrl, exampleFigure, landingPage, privacyPage, toolTable,
  type SiteInfo,
} from "./web-pages.js";
import { VIEW_TOOLS } from "./apps.js";
import { demoAlerts, demoQuickWins } from "./web-demos.js";

interface GuideOptions {
  info: SiteInfo;
  path: string;
  /** <title>, also the og:title. */
  title: string;
  description: string;
  kicker: string;
  h1: string;
  ledeHtml: string;
  /** Trail between Overview and this page, usually empty. */
  trail?: Crumb[];
  bodyHtml: string;
  /** Structured data beyond the article, author and breadcrumb every guide carries. */
  extraJsonLd?: unknown[];
}

const OVERVIEW: Crumb = { label: "Overview", path: "/" };

function related(currentPath: string): string {
  const links = GUIDES.filter((g) => g.path !== currentPath)
    .map((g) => `<li><a href="${esc(g.path)}">${esc(g.label)}</a></li>`)
    .join("");
  return `<h2>Related</h2><ul class="related"><li><a href="/">Overview</a></li>${links}</ul>`;
}

function guidePage(o: GuideOptions): string {
  const base = canonicalBase(o.info.publicUrl);
  const trail: Crumb[] = [OVERVIEW, ...(o.trail ?? []), { label: GUIDES.find((g) => g.path === o.path)?.label ?? o.h1 }];

  const body = `
<section class="hero">
  <div class="hero-bg" aria-hidden="true"><div class="hero-grid"></div><div class="hero-glow"></div></div>
  <div class="wrap hero-inner">
    ${crumbs(trail)}
    <span class="kicker">${esc(o.kicker)}</span>
    <h1>${esc(o.h1)}</h1>
    <p class="lede">${o.ledeHtml}</p>
  </div>
</section>

<div class="wrap page-body">
${o.bodyHtml}
  <h2>About this page</h2>
  ${aboutBlock()}
  ${related(o.path)}
</div>`;

  const article: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: o.h1,
    description: o.description,
    dateModified: SITE_UPDATED,
    author: base ? { "@id": `${base}/#author` } : authorJsonLd(base),
    publisher: base ? { "@id": `${base}/#author` } : authorJsonLd(base),
    ...(base
      ? {
          url: `${base}${o.path}`,
          mainEntityOfPage: `${base}${o.path}`,
          about: { "@id": `${base}/#software` },
          isPartOf: { "@type": "WebSite", name: PRODUCT_NAME, url: `${base}/` },
        }
      : {}),
  };
  // The Person node lives on the landing page; repeat it here so each page's
  // @id reference resolves on its own.
  const author = { "@context": "https://schema.org", ...authorJsonLd(base) };

  return shell({
    title: o.title,
    description: o.description,
    body,
    repoUrl: o.info.repoUrl,
    stars: o.info.stars,
    contactEmail: o.info.contactEmail,
    canonical: base ? `${base}${o.path}` : undefined,
    markdownPath: markdownPathFor(o.path),
    jsonLd: [article, author, ...breadcrumbJsonLd(trail, base, o.path), ...(o.extraJsonLd ?? [])],
  });
}

// -- setup: claude.ai and Claude Desktop ---------------------------------------

function claudePage(info: SiteInfo): string {
  const mcpUrl = `${info.publicUrl}/mcp`;
  const installUrl = claudeInstallUrl(mcpUrl);
  const bodyHtml = `
  <h2>What you need</h2>
  <p>A Google account with access to at least one Search Console property, and
     claude.ai or Claude Desktop. No Google Cloud project, API key or download.</p>

  <h2>Add the connector</h2>
  <div class="step">
    <h3>With one click</h3>
    <p>This opens claude.ai's <em>Add custom connector</em> dialog with the name and
       URL already filled in. claude.ai asks you to confirm the address before
       anything connects.</p>
    <div class="cta-row">
      <a class="btn glass-brand" href="${esc(installUrl)}" rel="noopener">${SPARK}Add to Claude</a>
    </div>
  </div>
  <div class="step">
    <h3>By hand</h3>
    <p>In claude.ai or Claude Desktop, open <strong>Settings &rarr; Connectors &rarr;
       Add custom connector</strong>, give it a name such as
       <em>Google Search Console</em>, and paste:</p>
    <pre><code>${esc(mcpUrl)}</code></pre>
    <p class="note">Both <code>/mcp</code> and <code>/mcp/</code> work.</p>
  </div>

  <h2>Sign in</h2>
  <p>Your browser opens two screens, in this order:</p>
  <ol>
    <li><strong>This server's own consent page.</strong> It names the application
        that asked and the exact address the result will be sent to. It exists so a
        connection request you did not start can be refused; cancel if anything looks
        wrong.</li>
    <li><strong>Google's sign-in.</strong> It asks for read-only Search Console
        access (<code>webmasters.readonly</code>) and your email address, and nothing
        else.</li>
  </ol>

  <h2>Check that it works</h2>
  <p>Ask Claude: <em class="ask">&ldquo;List my Search Console properties.&rdquo;</em>
     You get every property your Google account can see, with its type and your
     permission level. From there, name a property in any question:</p>
  <ul>
    <li><em class="ask">&ldquo;What am I almost ranking for on sc-domain:example.com?&rdquo;</em>
        &mdash; <a href="/tools/opportunities">opportunity tools</a></li>
    <li><em class="ask">&ldquo;Which pages lost the most traffic last month, and why?&rdquo;</em>
        &mdash; <a href="/tools/diagnostics">diagnostic tools</a></li>
    <li><em class="ask">&ldquo;Is https://example.com/page indexed?&rdquo;</em>
        &mdash; <a href="/tools/lookups">lookups</a></li>
    <li><em class="ask">&ldquo;Which of my queries look like AI Mode conversations?&rdquo;</em>
        &mdash; <a href="/ai-mode-queries">AI Mode queries</a></li>
  </ul>
  <p>Tired of naming the property every time? Ask Claude to run
     <span class="tool-name">set_default_property</span>.</p>

  <h2>Troubleshooting</h2>
  <table>
    <tr><th>What you see</th><th>Why, and what to do</th></tr>
    <tr><td><code>access_denied</code> from Google</td>
        <td>Consent was declined or blocked: you pressed Cancel, or your Google Workspace
            admin restricts third-party apps. Try again, or ask your admin to allow the app.</td></tr>
    <tr><td>The connector dialog rejects the URL</td>
        <td>Check it is exactly <code>${esc(mcpUrl)}</code>.</td></tr>
    <tr><td>&ldquo;This session belongs to a different user&rdquo;</td>
        <td>A stale connector entry. Remove it and add it again.</td></tr>
    <tr><td>A tool says a property is not available</td>
        <td>Google's own permissions apply. Check that the account you signed in with
            can see the property in Search Console itself.</td></tr>
    <tr><td><code>GSC_SITE_URL environment variable is required</code></td>
        <td>A tool ran without a property and you have no default. Name one, or run
            <span class="tool-name">set_default_property</span>.</td></tr>
    <tr><td><code>429</code> or <code>503</code> with <code>Retry-After</code></td>
        <td>A capacity limit. Wait the stated interval and ask again.</td></tr>
  </table>

  <h2>Disconnecting</h2>
  <p>Either of these is enough:</p>
  <ul>
    <li>Ask Claude to run <span class="tool-name">disconnect_account</span>. It erases
        the stored Google connection, every token and your saved settings, and ends
        your sessions.</li>
    <li>Remove the app at
        <a href="https://myaccount.google.com/permissions" rel="noopener">myaccount.google.com/permissions</a>.
        The stored credential stops working and the server erases it the next time
        it tries to use it.</li>
  </ul>
  <p>Removing the connector in Claude only removes it from Claude. Details are in the
     <a href="/privacy">privacy policy</a>.</p>`;

  return guidePage({
    info,
    path: "/claude",
    title: "Connect Google Search Console to Claude (claude.ai and Desktop)",
    description: "Add Google Search Console to claude.ai or Claude Desktop as a custom " +
      "connector: one URL and a Google sign-in, read-only, every property. No API keys.",
    kicker: "Setup guide",
    h1: "Connect Google Search Console to Claude",
    ledeHtml: "Add this server to claude.ai or Claude Desktop as a custom connector. It " +
      "takes one URL and a Google sign-in, and gives Claude read-only access to every " +
      "Search Console property your account can see.",
    bodyHtml,
  });
}

// -- setup: Claude Code -------------------------------------------------------

function claudeCodePage(info: SiteInfo): string {
  const mcpUrl = `${info.publicUrl}/mcp`;
  const localJson = JSON.stringify({
    command: "node",
    args: ["/absolute/path/to/gsc-mcp-remote/dist/index.js"],
    env: {
      GSC_AUTH_MODE: "oauth",
      GSC_OAUTH_SECRETS_FILE: "/absolute/path/to/client_secret.json",
      GSC_SCOPES: "readonly",
    },
  });
  const bodyHtml = `
  <h2>Add the server</h2>
  <pre><code>claude mcp add --transport http gsc ${esc(mcpUrl)}</code></pre>
  <p><code>gsc</code> is the name Claude Code shows for the server; any name works.
     Claude Code's <a href="https://code.claude.com/docs/en/mcp" rel="noopener">MCP
     documentation</a> covers the command in full.</p>

  <h2>Choose a scope</h2>
  <p>Claude Code stores the server in one of three scopes. Local is the default.</p>
  <table>
    <tr><th>Scope</th><th>Where it loads</th><th>Add it with</th></tr>
    <tr><td>Local</td><td>This project only, private to you</td>
        <td><code>claude mcp add --transport http gsc ${esc(mcpUrl)}</code></td></tr>
    <tr><td>User</td><td>All your projects</td>
        <td><code>claude mcp add --transport http --scope user gsc ${esc(mcpUrl)}</code></td></tr>
    <tr><td>Project</td><td>Everyone working in the repository, via <code>.mcp.json</code></td>
        <td><code>claude mcp add --transport http --scope project gsc ${esc(mcpUrl)}</code></td></tr>
  </table>
  <p>A project-scoped entry shares the address, not an account: each teammate still
     signs in with their own Google account and sees only their own properties.</p>

  <h2>Sign in</h2>
  <p>Inside Claude Code, run <code>/mcp</code>, pick the server, and follow the steps
     in your browser. You see this server's consent page first, naming the
     application and the address the result goes to, then Google's sign-in asking for
     read-only Search Console access. If the browser does not open on its own, copy
     the URL Claude Code prints and open it yourself.</p>
  <p>Then ask: <em class="ask">&ldquo;List my Search Console properties.&rdquo;</em></p>

  <h2>Questions that suit a terminal</h2>
  <ul>
    <li><em class="ask">&ldquo;Inspect the five URLs we shipped today and tell me which are
        not indexed yet.&rdquo;</em> (<span class="tool-name">inspect_url</span>)</li>
    <li><em class="ask">&ldquo;Do /pricing and /pricing/ both get impressions for the same
        queries?&rdquo;</em> (<span class="tool-name">cannibalization_check</span>)</li>
    <li><em class="ask">&ldquo;Check the click numbers in this README against live data
        before I commit it.&rdquo;</em> (<span class="tool-name">verify_claim</span>)</li>
    <li><em class="ask">&ldquo;Write a 28-day performance report for
        sc-domain:example.com.&rdquo;</em> (<span class="tool-name">generate_report</span>;
        on this hosted instance the report comes back in the conversation)</li>
  </ul>

  <h2>Manage it</h2>
  <pre><code>claude mcp list
claude mcp get gsc
claude mcp remove gsc</code></pre>
  <p>Removing the server deletes the OAuth tokens Claude Code stored for it. To erase
     what this server stores about you as well, ask Claude to run
     <span class="tool-name">disconnect_account</span> first.</p>

  <h2>Run it locally instead</h2>
  <p>If you would rather your Google token stayed on your machine, build the server
     from source and add it over stdio. You need your own Google OAuth client; the
     <a href="/self-host">self-hosting guide</a> covers getting one. Then:</p>
  <pre><code>claude mcp add-json gsc '${esc(localJson)}'</code></pre>
  <p class="note">Local mode is also the only way to use the two indexing tools,
     which need <code>GSC_SCOPES=full</code>.</p>`;

  return guidePage({
    info,
    path: "/claude-code",
    title: "Google Search Console MCP for Claude Code: one-line setup",
    description: "Add the hosted Google Search Console MCP server to Claude Code with one " +
      "command, sign in through /mcp, and query every property from your terminal.",
    kicker: "Setup guide",
    h1: "Use Google Search Console in Claude Code",
    ledeHtml: "Claude Code connects to the hosted server over HTTP. One command adds it, " +
      "and Claude Code runs the Google sign-in through its own OAuth flow.",
    bodyHtml,
  });
}

// -- tool groups --------------------------------------------------------------

interface GroupPageCopy {
  title: string;
  description: string;
  h1: string;
  ledeHtml: string;
}

const GROUP_COPY: Record<string, GroupPageCopy> = {
  "/tools/opportunities": {
    title: "Find SEO opportunities in Search Console with Claude",
    description: "Five MCP tools that find near-page-one queries, low-CTR pages and unmet " +
      "demand in Google Search Console. Defaults, example prompts and real output.",
    h1: "Find SEO opportunities in your Search Console data",
    ledeHtml: "These five tools look for traffic you could have but do not yet: queries " +
      "just off page one, pages whose CTR trails their position, and demand you show up " +
      "for without a page that targets it.",
  },
  "/tools/diagnostics": {
    title: "Diagnose Search Console traffic drops with Claude",
    description: "Five MCP tools that tell a ranking loss from a CTR collapse or a demand " +
      "decline, and find decay and cannibalisation. Defaults and real output.",
    h1: "Diagnose traffic drops, decay and cannibalisation",
    ledeHtml: "When traffic changes, the first question is whether rankings, CTR or demand " +
      "moved. These five tools answer it per page and per query.",
  },
  "/tools/lookups": {
    title: "Query Search Console from Claude: snapshots, URL inspection, reports",
    description: "Site snapshots, URL inspection, custom Search Analytics queries, " +
      "multi-site dashboards and claim checks, answered from live Search Console data.",
    h1: "Look up Search Console data from Claude",
    ledeHtml: "The direct questions: how a site is doing, whether a URL is indexed, what " +
      "a filtered query returns, and whether a number you are about to quote is right.",
  },
  "/tools/image-search": {
    title: "Google Images data in Claude: image-search tools for Search Console",
    description: "Eight MCP tools for Google Images: image queries, pages, trends, " +
      "impressions without clicks, decay, and an audit of the images on your pages.",
    h1: "Image search tools for Search Console",
    ledeHtml: "The Search Analytics API defaults to web search, so Google Images data only " +
      "appears when a request asks for <code>type=image</code>. Seven of these tools ask " +
      "for it; the eighth audits the images on your pages directly.",
  },
};

function paramsTable(tool: ToolDoc): string {
  const params = tool.params;
  if (params.length === 0) {
    return PROPERTY_INDEPENDENT.includes(tool.name)
      ? `<p class="note">No parameters.</p>`
      : `<p class="note">No parameters beyond the property (<code>site_url</code>).</p>`;
  }
  const rows = params
    .map((p) => `<tr><td><code>${esc(p.name)}</code></td><td>${esc(p.value)}</td><td>${p.noteHtml ?? ""}</td></tr>`)
    .join("");
  return `<table class="params"><tr><th>Parameter</th><th>Default</th><th>Note</th></tr>${rows}</table>`;
}

function toolBlock(t: ToolDoc): string {
  return `<div class="tool-block" id="${esc(t.name)}">
    <h3><span class="tool-name">${esc(t.name)}</span></h3>
    <p>${t.detailHtml}</p>${VIEW_TOOLS.has(t.name) ? `
    <p class="note"><span class="tag ok">Interactive view</span> In a client that supports MCP Apps this
       result is also drawn as cards or a sortable table. <a href="/tools#interactive-views">How that works</a>.</p>` : ""}
    <p>Ask: <em class="ask">&ldquo;${esc(t.ask)}&rdquo;</em></p>
    ${paramsTable(t)}
  </div>`;
}

function toolGroupPage(group: ToolGroup, info: SiteInfo): string {
  const copy = GROUP_COPY[group.path];
  const ex = EXAMPLES[group.path];
  const bodyHtml = `
  <h2>The tools</h2>
  <p class="note">${SITE_URL_NOTE}</p>
  ${group.tools.map(toolBlock).join("\n")}

  ${ex ? `<h2>A real answer</h2>
  <p>From this hosted instance, run against the author's own site. Shown as it came
     back; rows are trimmed only where the caption says so.</p>
  ${exampleFigure(ex)}` : ""}

  <h2>Connect it</h2>
  <p>Add <code>${esc(info.publicUrl)}/mcp</code> to <a href="/claude">claude.ai or Claude
     Desktop</a> or to <a href="/claude-code">Claude Code</a>, sign in with Google, and ask
     any of the questions above.</p>`;

  return guidePage({
    info,
    path: group.path,
    title: copy.title,
    description: copy.description,
    kicker: "Tools",
    h1: copy.h1,
    ledeHtml: copy.ledeHtml,
    bodyHtml,
  });
}

// -- AI Mode queries ----------------------------------------------------------

const BUCKETS: [string, string, string][] = [
  ["artefact", "A person replied to Google's AI mid-conversation, and the reply was logged as a query your page appeared for. Positions here are AI-block positions, not open-web rankings.", "<em>yes</em>, <em>go on</em>, <em>tell me more</em>"],
  ["pivot", "A mid-conversation comparison. It names the alternative people ask the AI about next.", "<em>what about X</em>, <em>how about X</em>"],
  ["conversational", "A question shaped by conversation with an AI rather than by a search box.", "<em>can you…</em>, <em>how do I…</em>, <em>is it worth…</em>, questions of ten or more words"],
  ["tracker_probe", "Synthetic prompts from AI-visibility tracking tools passing through Google's grounding layer. Machine traffic, not demand.", "<em>… my location is X.</em>, <em>evaluate the X on Y</em>"],
  ["agent_harness", "Complete agent instructions logged verbatim as a query. Machine traffic.", "<em>search the web for…</em>, <em>do not invent…</em>"],
  ["pasted_string", "Error messages and CSV header rows entered as searches, by people or pipelines.", "comma-separated header rows, Search Console status messages"],
  ["long_uncategorised", "Ten or more words with no other marker: quoted sentences, agent fragments, rare long-tail. Review by hand.", "long queries matching none of the above"],
];

function aiModePage(info: SiteInfo): string {
  const group = TOOL_GROUPS.find((g) => g.path === "/ai-mode-queries")!;
  const genai = group.tools.find((t) => t.name === "genai_conversation_queries")!;
  const account = group.tools.filter((t) => t.name !== "genai_conversation_queries");
  const ex = EXAMPLES["/ai-mode-queries"];
  const bucketRows = BUCKETS
    .map(([name, what, shape]) => `<tr><td><code>${esc(name)}</code></td><td>${esc(what)}</td><td>${shape}</td></tr>`)
    .join("");

  const bodyHtml = `
  <h2>Why AI conversations show up as queries</h2>
  <p>Google reports traffic from AI Overviews and AI Mode in the Performance report,
     inside the <strong>Web</strong> search type, alongside ordinary results
     (<a href="https://developers.google.com/search/docs/appearance/ai-features" rel="noopener">Google
     Search Central</a>). And when someone asks a follow-up question in AI Mode, Google treats
     it as a new query, crediting the impressions, position and clicks of the follow-up to
     that query (<a href="https://support.google.com/webmasters/answer/7042828" rel="noopener">Search
     Console Help</a>). Both checked on ${esc(humanDate("2026-10-13"))}.</p>
  <p>The result is that conversation fragments sit in your query list next to ordinary
     searches, with real impressions, positions and clicks. Search Console does not label
     them. <span class="tool-name">genai_conversation_queries</span> finds them by their
     shape and sorts them by what produced them.</p>

  <h2>The seven buckets</h2>
  <table>
    <tr><th>Bucket</th><th>What it is</th><th>Typical shape</th></tr>
    ${bucketRows}
  </table>

  <h2>Reading the result</h2>
  <ul>
    <li>Leave <code>tracker_probe</code> and <code>agent_harness</code> out of any demand
        analysis. They are machine-generated views. If you run an AI-visibility tracker,
        the probes may be its own; if you do not, someone else is tracking topics you rank
        for.</li>
    <li><code>pivot</code> rows name the alternatives people ask about next, which makes
        them a ready list for a comparison section on the page they land on.</li>
    <li>Conversational queries with impressions and almost no clicks can mean the page is
        being read inside answers rather than clicked from results.</li>
    <li>The monthly timeline shows when reply artefacts first appeared for your site.</li>
  </ul>

  <h2>What it cannot see</h2>
  <ul>
    <li>Google excludes anonymised (rare) queries, so every number is a floor, not a
        total.</li>
    <li>AI Overviews and AI Mode cannot be told apart at query level; both fold into the
        web search type.</li>
    <li>Classification reads the shape of a query, not intent. A phrase that looks
        conversational can be typed deliberately, so treat single rows as evidence rather
        than statistics.</li>
    <li>Search Console data does not identify who runs a tracker or an agent.</li>
  </ul>

  <h2>A real answer</h2>
  ${exampleFigure(ex)}

  <h2>Parameters</h2>
  <p class="note">${SITE_URL_NOTE}</p>
  ${paramsTable(genai)}
  <p class="note">The query detection comes from
     <a href="${esc(UPSTREAM.repoUrl)}" rel="noopener">${esc(UPSTREAM.name)}</a>, the
     project this server is forked from.</p>

  <h2>Your account</h2>
  <p>The same group holds the controls over what this server keeps about you.</p>
  ${account.map(toolBlock).join("\n")}`;

  return guidePage({
    info,
    path: "/ai-mode-queries",
    title: "Find AI Mode and AI Overview queries in Search Console data",
    description: "AI Mode follow-ups land in Search Console as ordinary queries. This MCP " +
      "tool finds them and sorts them into seven buckets. Real output included.",
    kicker: "Tools",
    h1: "Find AI Mode queries in your Search Console data",
    ledeHtml: "Google counts an AI Mode follow-up question as a new query, so AI " +
      "conversations leave fragments in your Performance report. " +
      "<span class=\"tool-name\">genai_conversation_queries</span> finds them and sorts " +
      "them into seven buckets.",
    bodyHtml,
  });
}

// -- self-hosting -------------------------------------------------------------

function selfHostPage(info: SiteInfo): string {
  const repo = info.repoUrl ?? "https://github.com/kodotpro/gsc-mcp-remote";
  const bodyHtml = `
  <h2>Two ways to run it</h2>
  <table>
    <tr><th></th><th>On your machine (stdio)</th><th>As your own remote server</th></tr>
    <tr><td>Who connects</td><td>You, from your own MCP client</td>
        <td>Anyone you allow, each with their own Google account (or one shared token)</td></tr>
    <tr><td>Where Google tokens live</td><td>Your machine, in <code>~/.gsc-mcp/</code></td>
        <td>Your server, encrypted at rest</td></tr>
    <tr><td>Indexing tools</td><td>Yes, with <code>GSC_SCOPES=full</code></td>
        <td>Not in per-user sign-in mode, which is read-only</td></tr>
    <tr><td>Runtime</td><td>Node 20+</td><td>Node 20+; per-user sign-in needs Node 24+</td></tr>
  </table>

  <h2>Run it on your machine</h2>
  <ol>
    <li><p><strong>Clone and build.</strong> It is not on npm yet, so install from source:</p>
      <pre><code>git clone ${esc(repo)}.git && cd gsc-mcp-remote
npm ci && npm run build</code></pre></li>
    <li><p><strong>Get a Google OAuth client.</strong> In
      <a href="https://console.cloud.google.com" rel="noopener">Google Cloud Console</a>,
      enable the <strong>Google Search Console API</strong>, then go to
      <strong>Credentials &rarr; Create credentials &rarr; OAuth client ID &rarr; Desktop app</strong>
      and download the JSON.</p></li>
    <li><p><strong>Run the guided setup.</strong> It signs you in, checks the connection with
      a live API call, and writes your Claude config:</p>
      <pre><code>node dist/index.js setup</code></pre></li>
  </ol>
  <p>Restart Claude and ask <em class="ask">&ldquo;list my Search Console
     properties&rdquo;</em>. To configure it by hand, or to use a service account instead,
     see the <a href="${esc(README_URL)}" rel="noopener">README</a>. For Claude Code, the
     <a href="/claude-code">Claude Code guide</a> has a one-line
     <code>claude mcp add-json</code> command.</p>
  <p><code>GSC_SCOPES=readonly</code> requests a single read-only Google permission and is
     the recommended setting. <code>full</code> adds the write tools:
     ${WRITE_TOOLS.map((t) => `<span class="tool-name">${esc(t)}</span>`).join(", ")}.</p>

  <h2>Host it for other people</h2>
  <p>The same server runs as a remote MCP server, which is what
     <code>gsc.k-o.pro</code> is. Pick an auth mode first:</p>
  <table>
    <tr><th></th><th><code>GSC_HTTP_AUTH=oauth</code></th><th><code>GSC_HTTP_AUTH=bearer</code> (default)</th></tr>
    <tr><td>Who connects</td><td>Anyone you allow, with their own Google account</td><td>Whoever holds the one token</td></tr>
    <tr><td>What they see</td><td>Their own properties</td><td>Everything the server's single credential sees</td></tr>
    <tr><td>claude.ai and Desktop connector UI</td><td>Yes, added by URL</td><td>No</td></tr>
    <tr><td>Claude Code</td><td>Yes, through the OAuth flow</td><td>Yes, with an <code>Authorization</code> header</td></tr>
    <tr><td>Runtime</td><td>Node 24+</td><td>Node 20+</td></tr>
  </table>
  <p>The <a href="${esc(SELF_HOSTING_DOC_URL)}" rel="noopener">self-hosting
     documentation</a> covers the rest: Docker deployment, the reverse proxy, turning
     on per-user sign-in, Google's app verification, backups, the capacity limits and
     troubleshooting.</p>

  <h2>Licence and credit</h2>
  <p>Apache 2.0. The project is a fork of
     <a href="${esc(UPSTREAM.repoUrl)}" rel="noopener">${esc(UPSTREAM.name)}</a> by
     <a href="${esc(UPSTREAM.authorUrl)}" rel="noopener">${esc(UPSTREAM.author)}</a>, and
     the <code>NOTICE</code> file in the repository records what this fork changed. Issues
     and pull requests go to <a href="${esc(repo)}" rel="noopener">${esc(repo.replace(/^https?:\/\//, ""))}</a>.</p>`;

  return guidePage({
    info,
    path: "/self-host",
    title: "Self-host the Google Search Console MCP server (open source)",
    description: "Run the same 32 tools yourself: locally over stdio with your own Google " +
      "OAuth client, or as your own remote server with per-user sign-in. Apache 2.0.",
    kicker: "Open source",
    h1: "Self-host the Google Search Console MCP server",
    ledeHtml: "The hosted instance runs the code that is on GitHub. Running your own keeps " +
      "Google tokens on your hardware, and it is the only way to use the two indexing tools.",
    bodyHtml,
  });
}

// -- every tool on one page -----------------------------------------------------

function toolsPage(info: SiteInfo): string {
  const withView = TOOL_GROUPS.flatMap((g) => g.tools).filter((t) => VIEW_TOOLS.has(t.name));
  // One captured answer per tool group, collapsed so the page stays scannable.
  const examples = TOOL_GROUPS.map((g) => {
    const ex = EXAMPLES[g.path];
    if (!ex) return "";
    return `<details class="example-toggle">
    <summary>${esc(g.title)} <span class="note">&middot; <span class="tool-name">${esc(ex.tool)}</span></span></summary>
    ${exampleFigure(ex)}
  </details>`;
  }).join("\n");

  const bodyHtml = `
  <h2>The tools, by job</h2>
  <p class="note">${SITE_URL_NOTE}</p>
  ${TOOL_GROUPS.map(toolTable).join("\n")}
  <p class="note">The two indexing tools, ${WRITE_TOOLS.map((t) => `<span class="tool-name">${esc(t)}</span>`).join(" and ")},
     are part of the software but cannot run on this hosted instance: they need write
     access to your Google account, which this service never requests. They work on a
     <a href="/self-host">self-hosted install</a> configured with wider scopes.
     <span class="tool-name">submit_url</span> takes one URL or up to 200.</p>

  <h2 id="interactive-views">Interactive views</h2>
  <p>${withView.length} tools come with a view: in a client that supports the MCP Apps
     extension, the result is drawn as cards and sortable tables beside the
     conversation. A client without it shows the same result as text. Either way
     Claude reads the same data, so the analysis does not depend on the view.</p>
  ${demoQuickWins()}
  ${demoAlerts()}
  <table>
    <tr><th>Tool</th><th>What the view shows</th></tr>
    ${withView.map((t) => `<tr><td><span class="tool-name">${esc(t.name)}</span></td><td>${esc(t.what)}</td></tr>`).join("\n    ")}
  </table>
  <p class="note">The view is one small page that runs in the client's sandbox. It
     loads nothing from the network except one font from this site, follows no
     links, and treats every query and URL in a result as text, never as markup.
     Only tools that read have a view.</p>

  <h2 id="results">What every result carries</h2>
  <ul>
    <li><strong>Provenance.</strong> A <code>_meta</code> block names the source, the
        tool, the exact parameters and the property the numbers came from.</li>
    <li><strong>A typed copy.</strong> The same result is returned as structured content
        as well as JSON text, and the ten tools with a view declare its shape in
        advance, so a client can rely on the fields.</li>
    <li><strong>A warning about borrowed text.</strong> Search queries and page URLs are
        written by other people. Each result says so, and tells the model never to
        follow instructions found inside them.</li>
    <li><strong>Position, labelled honestly.</strong> It is the impression-weighted
        average Search Console reports, not a rank-tracker position.</li>
  </ul>

  <h2 id="limits">Limits and errors</h2>
  <table>
    <tr><th>What</th><th>Behaviour</th></tr>
    <tr><td>Date range</td><td><code>days</code> is 1 to 480, the 16 months Search Console keeps. A value outside it is refused before any call to Google.</td></tr>
    <tr><td>Rows returned</td><td>Tools return their top rows (usually 50). <span class="tool-name">advanced_search_analytics</span> takes <code>row_limit</code> up to 500.</td></tr>
    <tr><td>Requests</td><td>60 a minute per person by default; a batch counts once per message in it. Over the limit the server answers <code>429</code> and says when to retry.</td></tr>
    <tr><td>Google's failures</td><td>A read that Google answers with a rate-limit or server error is retried twice. Writes and timeouts are never retried.</td></tr>
    <tr><td>Error messages</td><td>Plain words and a next step: no access to that property (ask for <span class="tool-name">list_properties</span>), quota reached (wait), sign-in revoked (reconnect), or Google's own outage.</td></tr>
    <tr><td>Erasing your account</td><td><span class="tool-name">disconnect_account</span> takes two calls: the first explains what will be erased, the second confirms it.</td></tr>
  </table>

  <h2 id="real-answers">Real answers</h2>
  <p>One response per tool group, from this hosted instance against the author's
     own site, k-o.pro, on the date in each caption. They are shown as they came
     back, indented for reading, with rows trimmed where the caption says so.
     Results today also carry the borrowed-text warning described above, which
     was added after these were captured.</p>
  ${examples}

  <h2>Connect it</h2>
  <p>Add <code>${esc(info.publicUrl)}/mcp</code> to <a href="/claude">claude.ai or Claude
     Desktop</a> or to <a href="/claude-code">Claude Code</a>, sign in with Google, and ask.</p>`;

  return guidePage({
    info,
    path: "/tools",
    title: "All 32 Google Search Console MCP tools, with views, limits and real output",
    description: "Every tool in the Search Console MCP server on one page: what each does, " +
      "which draw an interactive view, input limits, error behaviour and real output.",
    kicker: "Reference",
    h1: "All 32 tools",
    ledeHtml: "What each tool does, grouped by the job you would reach for it to do, " +
      "followed by how results are shown, what they carry, where the limits are, and " +
      "real output from the hosted instance.",
    bodyHtml,
  });
}

// -- comparison -----------------------------------------------------------------

function comparePage(info: SiteInfo): string {
  const rows = COMPARISON.map(([q, a]) => `<tr><td>${esc(q)}</td><td>${a}</td></tr>`).join("");
  const bodyHtml = `
  <h2>The questions worth asking</h2>
  <p>Ask these of any Search Console MCP server. Other servers are not named here:
     their specifications change, and a table about them would be stale or
     unverified. These are the answers for this one.</p>
  <table><tr><th>Question</th><th>This server</th></tr>${rows}</table>

  <h2>Why a remote server</h2>
  <p>Most MCP servers are local-only: one process, on one laptop, holding one
     credential. That is why they cannot be shared, and why the claude.ai and
     Claude Desktop connector interfaces cannot add them at all.</p>
  <p>This one runs as a hosted service over Streamable HTTP and implements the
     MCP authorization spec: dynamic client registration, PKCE, rotating tokens,
     and a consent screen of its own. That is what lets a connector interface
     add it from nothing but a URL. It also means a team shares one deployment
     while each person signs in as themselves and sees only their own
     properties. Nobody copies a credential anywhere.</p>

  <h2>Hosted, or your own</h2>
  <table>
    <tr><th></th><th>Hosted at <code>${esc(info.publicUrl.replace(/^https?:\/\//, ""))}</code></th><th>Your own copy</th></tr>
    <tr><td>Setup</td><td>Add a URL, sign in with Google</td><td>Clone, build, bring a Google OAuth client</td></tr>
    <tr><td>Where the Google token lives</td><td>On this server, encrypted</td><td>On your machine or your server</td></tr>
    <tr><td>Access to Google</td><td>Read-only</td><td>Read-only, or full if you choose</td></tr>
    <tr><td>Indexing tools</td><td>Not available</td><td>Available with full access</td></tr>
  </table>
  <p>The <a href="/self-host">self-hosting guide</a> covers the second column.</p>`;

  return guidePage({
    info,
    path: "/compare",
    title: "How this Google Search Console MCP server compares",
    description: "The questions worth asking of any Search Console MCP server (setup, " +
      "clients, properties, permissions, data storage, coverage, price), answered for this one.",
    kicker: "Comparison",
    h1: "How it compares",
    ledeHtml: "What to ask of any Search Console MCP server before you connect it to your " +
      "account, and the answers for this one.",
    bodyHtml,
  });
}

// -- questions ------------------------------------------------------------------

function faqPage(info: SiteInfo): string {
  const bodyHtml = `
  <h2>Questions and answers</h2>
  ${FAQ.map(([q, a]) => `<div class="faq st"><h3>${esc(q)}</h3><p>${a}</p></div>`).join("\n")}`;

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map(([q, a]) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: {
        "@type": "Answer",
        // Schema.org answers are plain prose, so the answer is reduced to its
        // text by the same parser that builds the Markdown pages, not by a
        // regular expression: one pass of a tag-stripping pattern can leave a
        // tag behind when tags are nested inside each other's remains.
        text: parse(a).text,
      },
    })),
  };

  return guidePage({
    info,
    path: "/faq",
    title: "Google Search Console MCP server: questions and answers",
    description: "What the Search Console MCP server is, what it can and cannot change, " +
      "what it stores, whether it shows charts, and what happens when Google's API fails.",
    kicker: "Questions",
    h1: "Questions",
    ledeHtml: "What it is, what it can touch, what it keeps, and what happens when " +
      "something goes wrong.",
    bodyHtml,
    extraJsonLd: [faqJsonLd],
  });
}

// -- the registry -------------------------------------------------------------

export interface PublicPage {
  path: string;
  render: (info: SiteInfo) => string;
}

/** Every HTML page the server serves publicly. Routes and the sitemap both read this. */
export const PUBLIC_PAGES: PublicPage[] = [
  { path: "/", render: landingPage },
  { path: "/claude", render: claudePage },
  { path: "/claude-code", render: claudeCodePage },
  { path: "/tools", render: toolsPage },
  ...TOOL_GROUPS.filter((g) => GROUP_COPY[g.path]).map((g) => ({
    path: g.path,
    render: (info: SiteInfo) => toolGroupPage(g, info),
  })),
  { path: "/ai-mode-queries", render: aiModePage },
  { path: "/self-host", render: selfHostPage },
  { path: "/compare", render: comparePage },
  { path: "/faq", render: faqPage },
  { path: "/privacy", render: privacyPage },
];

const PAGE_BY_PATH = new Map(PUBLIC_PAGES.map((p) => [p.path, p]));

/**
 * Links to another registered page are pointed at that page's Markdown, so an
 * agent that follows a link stays in Markdown even if it does not negotiate.
 * Everything else (the MCP endpoint, GitHub, an #anchor on this page) is left
 * as written. An absolute link to this deployment's own origin is rewritten too.
 */
function rewriteInternalLink(href: string, base: string | undefined): string {
  const m = /^([^?#]*)([?#][\s\S]*)?$/.exec(href);
  if (!m) return href;
  let path = m[1];
  let origin = "";
  if (base && path.startsWith(`${base}/`)) {
    origin = base;
    path = path.slice(base.length);
  }
  return PAGE_BY_PATH.has(path) ? `${origin}${markdownPathFor(path)}${m[2] ?? ""}` : href;
}

/**
 * Rendering is the expensive half of serving a page and parsing it back is the
 * rest, so the conversion is remembered: it is redone only when the HTML it came
 * from changes (the star count in the header is the one thing that does, hourly).
 * One entry per page and variant, so it cannot grow.
 */
const markdownCache = new Map<string, { html: string; markdown: string }>();

/**
 * A page as Markdown, generated from the HTML the browser gets so the two cannot
 * drift. `footer` appends the trademark notice that sits in the page footer,
 * which is outside <main> but is a statement a reader of either form should see.
 */
export function pageMarkdown(page: PublicPage, info: SiteInfo, options: { footer?: boolean } = {}): string {
  const html = page.render(info);
  const key = `${page.path}|${info.publicUrl}|${options.footer ? "footer" : "body"}`;
  const hit = markdownCache.get(key);
  if (hit && hit.html === html) return hit.markdown;

  const base = canonicalBase(info.publicUrl);
  const markdown = htmlToMarkdown(html, {
    select: options.footer ? ["main", "footer .note"] : ["main"],
    rewriteHref: (href) => rewriteInternalLink(href, base),
  });
  markdownCache.set(key, { html, markdown });
  return markdown;
}

/** The sitemap for a published origin. */
export function sitemapXml(base: string): string {
  const urls = PUBLIC_PAGES
    .map((p) => `<url><loc>${base}${p.path}</loc><lastmod>${SITE_UPDATED}</lastmod></url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

/**
 * /llms.txt: a plain-text map of the site for language models, in the format
 * proposed at llmstxt.org. Built from the same registry and tool list as the
 * pages, so it cannot describe a page or a tool that does not exist.
 */
export function llmsTxt(info: SiteInfo): string {
  const base = canonicalBase(info.publicUrl) ?? "";
  const lines = [
    `# ${PRODUCT_NAME}`,
    "",
    "> A hosted, open-source remote MCP server that connects Google Search Console to " +
      "Claude and other MCP clients. Read-only (webmasters.readonly), every property from " +
      "one connection, and 32 tools that return diagnoses with provenance rather than raw " +
      "rows. Free to use; Apache 2.0.",
    "",
    `MCP endpoint: ${info.publicUrl}/mcp (Streamable HTTP, MCP OAuth with dynamic client registration and PKCE).`,
    `Maintained by ${AUTHOR.name} (${AUTHOR.url}). Forked from ${UPSTREAM.name} by ${UPSTREAM.author} (${UPSTREAM.repoUrl}).`,
    `Version ${SERVER_VERSION}; content updated ${SITE_UPDATED}.`,
    "",
    "## Setup",
    `- [Connect to claude.ai and Claude Desktop](${base}${markdownPathFor("/claude")}): custom connector, Google sign-in, troubleshooting`,
    `- [Use it in Claude Code](${base}${markdownPathFor("/claude-code")}): claude mcp add, scopes, sign-in with /mcp`,
    `- [Self-host it](${base}${markdownPathFor("/self-host")}): run locally over stdio or as your own remote server`,
    "",
    "## Tools",
    `- [All 32 tools](${base}${markdownPathFor("/tools")}): every tool on one page, which ones draw an interactive view, input limits, error behaviour, real output`,
    ...TOOL_GROUPS.map((g) => `- [${g.title}](${base}${markdownPathFor(g.path)}): ${g.tools.map((t) => t.name).join(", ")}`),
    `- Not available on the hosted instance (need write access): ${WRITE_TOOLS.join(", ")}`,
    "",
    "## About",
    `- [How it compares](${base}${markdownPathFor("/compare")}): the questions to ask of any Search Console MCP server, answered for this one`,
    `- [Questions](${base}${markdownPathFor("/faq")}): what it is, what it can change, what it stores`,
    "",
    "## Policies and source",
    `- [Privacy policy](${base}${markdownPathFor("/privacy")})`,
    ...(info.repoUrl ? [`- [Source code](${info.repoUrl})`] : []),
    "",
    "## Optional",
    `- [Every page above as one Markdown file](${base}/llms-full.txt): the full text, for a client that wants it in one request`,
    "",
  ];
  return lines.join("\n");
}

/**
 * /llms-full.txt: every public page as Markdown in one file. The site documents
 * every tool with its parameters and defaults, which is exactly what an agent
 * wants in a single request rather than ten, so this ships instead of
 * redirecting to the overview. Built from the same per-page Markdown as the
 * .md routes. The trademark notice is stated once, at the end.
 */
export function llmsFullTxt(info: SiteInfo): string {
  const base = canonicalBase(info.publicUrl) ?? "";
  const parts = [
    `# ${PRODUCT_NAME}: full text`,
    "",
    `> Every public page of this site as Markdown, in one file. The index is ${base}/llms.txt; each page is also served on its own at its .md address.`,
    "",
  ];
  for (const page of PUBLIC_PAGES) {
    parts.push("---", "", `Source: ${base}${page.path}`, "", pageMarkdown(page, info).trimEnd(), "");
  }
  // The notice lives only in the footer template; read it from there rather than
  // keep a second copy that could disagree with it.
  const notice = htmlToMarkdown(PUBLIC_PAGES[0].render(info), { select: ["footer .note"] }).trim();
  parts.push("---", "", notice, "");
  return parts.join("\n");
}

/** Every tool name the pages mention, for the test that pins them to the server. */
export const DOCUMENTED_TOOLS: string[] = [...ALL_TOOL_NAMES, ...WRITE_TOOLS];
