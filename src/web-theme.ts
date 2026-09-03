/**
 * The visual language for this deployment's public pages, ported from k-o.pro.
 *
 * Everything here is constrained by the Content-Security-Policy in http.ts:
 * `default-src 'none'` with `style-src 'unsafe-inline'` and `font-src 'self'`.
 * That rules out external stylesheets, any JavaScript, and <img> — so the
 * design leans on what survives those limits: inline CSS, self-hosted fonts,
 * inline SVG, and `prefers-color-scheme` instead of a scripted theme toggle.
 *
 * Layout, type and the container/breakpoint system are copied from k-o.pro's
 * globals.css rather than approximated, so the two sites stay recognisably the
 * same product. Color is the deliberate exception — see the note above TOKENS.
 * Where the original relies on machinery that cannot come along — Tailwind,
 * the `[data-theme]` attribute a script sets, the SVG lens filter behind
 * `.glass` — this uses the fallback that design system already sanctions (see
 * the notes at each site).
 */

/** Public paths of the self-hosted fonts, served by http.ts from dist/fonts. */
export const FONT_ROUTES = {
  "manrope-latin.woff2": "font/woff2",
  "instrument-serif-latin.woff2": "font/woff2",
} as const;

export type FontFile = keyof typeof FONT_ROUTES;

/**
 * Images, served from dist/img. Just the k-o.pro wordmark: a single black
 * transparent PNG, flipped to white in dark mode with a CSS filter rather than
 * shipping a second file (see .site-logo).
 */
export const IMAGE_ROUTES = {
  "k-o-pro.png": "image/png",
} as const;

export type ImageFile = keyof typeof IMAGE_ROUTES;

/**
 * Latin subsets only, lifted from k-o.pro's Next build. Manrope is the variable
 * body face (200-800), Instrument Serif the display face used for headings.
 *
 * The `*-fallback` faces are not decoration: they re-declare the metric
 * overrides Next generates so the system font substituted during `swap` occupies
 * the same space as the real one, which keeps the heading from reflowing when
 * the webfont lands. Geist Mono is deliberately not shipped — it is the least
 * brand-carrying of the three and system monospace costs nothing.
 */
const FONT_FACES = `
@font-face{font-family:Manrope;font-style:normal;font-weight:200 800;font-display:swap;
 src:url(/fonts/manrope-latin.woff2) format("woff2");
 unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Manrope Fallback";src:local(Arial);
 ascent-override:103.31%;descent-override:29.07%;line-gap-override:0%;size-adjust:103.19%}
@font-face{font-family:"Instrument Serif";font-style:normal;font-weight:400;font-display:swap;
 src:url(/fonts/instrument-serif-latin.woff2) format("woff2");
 unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Instrument Serif Fallback";src:local("Times New Roman");
 ascent-override:117.94%;descent-override:36.93%;line-gap-override:0%;size-adjust:83.94%}
`;

/**
 * Colors are Google's own Material palette — the same tokens Search Console's
 * UI itself runs on — rather than k-o.pro's indigo. This is the one place this
 * file deliberately diverges from k-o.pro: this subdomain sits next to the
 * product it wraps, so it borrows that product's color language instead.
 * Layout, type and the glass material are unchanged and still k-o.pro's.
 *
 * G Blue 600 (#1a73e8) is the accent used for links, selected states and
 * primary actions across Search Console, Gmail, Cloud Console and the rest of
 * Google's product surface; G Grey 900/700/300 (#202124/#5f6368/#dadce0) are
 * the text and border grays in the same family. Values are plain hex rather
 * than hand-converted to oklch, so there is no risk of a conversion error
 * shifting them off the real color.
 *
 * Search Console itself has no public dark theme to copy, so dark mode below
 * uses Google's own standard dark-surface palette instead — the one Cloud
 * Console and other Google products switch to — rather than a literal GSC
 * screenshot match.
 *
 * The site switches on a `[data-theme]` attribute written by a script; with no
 * JavaScript available here the same values hang off `prefers-color-scheme`
 * instead, which costs the manual toggle and nothing else.
 */
const TOKENS = `
:root{
 --background:#ffffff; --foreground:#202124;
 --card:#f8f9fa; --muted-foreground:#5f6368;
 --border:#dadce0;
 --brand:#1a73e8; --brand-surface:#e8f0fe;
 --brand-mid:#aecbfa;
 --footer:#202124; --footer-foreground:#ffffff;
 --radius:1.125rem;
 --grid-line:oklch(0% 0 0deg / 0.045);
 --glass-tint:45%; --glass-hi:48%; --glass-hi2:22%; --glass-hi3:10%;
 --font-sans:Manrope,"Manrope Fallback",system-ui,-apple-system,"Segoe UI",sans-serif;
 --font-display:"Instrument Serif","Instrument Serif Fallback",Georgia,serif;
 --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
 color-scheme:light;
}
@media (prefers-color-scheme:dark){
 :root{
  --background:#202124; --foreground:#e8eaed;
  --card:#292a2d; --muted-foreground:#9aa0a6;
  --border:#3c4043;
  --brand:#8ab4f8; --brand-surface:#28313f;
  --brand-mid:#4285f4;
  --footer:#17181a; --footer-foreground:#ffffff;
  --grid-line:oklch(100% 0 0deg / 0.055);
  --glass-tint:42%; --glass-hi:24%; --glass-hi2:12%; --glass-hi3:20%;
  color-scheme:dark;
 }
}
`;

/**
 * The liquid-glass material, minus the lens.
 *
 * k-o.pro upgrades `.glass` to a `feDisplacementMap` refraction behind an
 * `@supports` gate, with plain blur+saturate as the declared fallback. The
 * filter needs `feImage` to load a displacement map, which `default-src 'none'`
 * forbids — so this uses that sanctioned fallback rather than weakening the
 * policy for an effect that is nearly invisible at header-pill size.
 */
const GLASS = `
.glass{
 -webkit-backdrop-filter:blur(24px) saturate(180%);
 backdrop-filter:blur(24px) saturate(180%);
 background:color-mix(in oklch,var(--card) var(--glass-tint),transparent);
 border-top:1px solid color-mix(in oklch,white var(--glass-hi),transparent);
 border-right:1px solid color-mix(in oklch,white var(--glass-hi2),transparent);
 border-bottom:1px solid color-mix(in oklch,white var(--glass-hi3),transparent);
 border-left:1px solid color-mix(in oklch,white var(--glass-hi2),transparent);
 box-shadow:
  inset 0 1px 0 color-mix(in oklch,white 65%,transparent),
  inset 0 0 0 1px color-mix(in oklch,white 8%,transparent),
  inset 0 -1px 1px color-mix(in oklch,black 6%,transparent),
  0 1px 2px color-mix(in oklch,black 4%,transparent),
  0 12px 32px -8px color-mix(in oklch,black 12%,transparent);
}
@media (prefers-color-scheme:dark){
 .glass{
  border-bottom:1px solid color-mix(in oklch,black var(--glass-hi3),transparent);
  box-shadow:
   inset 0 1px 0 color-mix(in oklch,white 16%,transparent),
   inset 0 0 0 1px color-mix(in oklch,white 5%,transparent),
   inset 0 -1px 1px color-mix(in oklch,black 25%,transparent),
   0 1px 2px color-mix(in oklch,black 30%,transparent),
   0 16px 40px -10px color-mix(in oklch,black 55%,transparent);
 }
}
/* Brand-tinted glass, for the one primary action on the page. */
.glass-brand{
 -webkit-backdrop-filter:blur(20px) saturate(180%);
 backdrop-filter:blur(20px) saturate(180%);
 background:color-mix(in oklch,var(--brand) 92%,transparent);
 color:oklch(100% 0 0deg);
 border-top:1px solid color-mix(in oklch,white 55%,transparent);
 border-right:1px solid color-mix(in oklch,white 28%,transparent);
 border-bottom:1px solid color-mix(in oklch,black 12%,transparent);
 border-left:1px solid color-mix(in oklch,white 28%,transparent);
 box-shadow:
  inset 0 1px 0 color-mix(in oklch,white 45%,transparent),
  0 8px 24px -6px color-mix(in oklch,var(--brand) 55%,transparent);
}
/* Real Liquid Glass turns opaque when the system asks for less transparency.
   Match that rather than leaving translucent text half-legible for the people
   who explicitly opted out. */
@media (prefers-reduced-transparency:reduce){
 .glass{-webkit-backdrop-filter:none;backdrop-filter:none;background:var(--card)}
 .glass-brand{-webkit-backdrop-filter:none;backdrop-filter:none;background:var(--brand)}
}
`;

/** Hero backdrop: k-o.pro's masked 40px grid under a slow brand-coloured glow. */
const HERO = `
.hero{position:relative;isolation:isolate;
 border-bottom:1px solid var(--border)}
.hero-inner{padding:3rem 1rem 3.25rem}
@media (width >= 48rem){.hero-inner{padding:4.5rem 2rem 4.5rem}}
/* The hero's own bottom padding is the spacing; a trailing element's margin
   would stack on top of it. */
.hero-inner > :last-child{margin-bottom:0}
/* Wider than the old fixed 46rem, but capped well short of .wrap's 86rem —
   tool tables and paragraphs get more room without the two-column tables
   turning sparse or lines running past a readable measure. */
.page-body{padding-block:2.75rem 1rem;max-width:56rem}
.page-body > h2:first-child{margin-top:0}
/* Reaches above the hero's own box so the grid and glow run unbroken behind
   the header, which sits in front of it on z-index. Two things depend on that:
   the hero has no visible seam where it meets the top of the page, and the
   glass pill has something to refract at rest instead of flat background.
   The overflow lives here rather than on .hero so the glow is clipped to this
   extended box — clipping it at the hero's edge is what drew the seam. */
.hero-bg{position:absolute;left:0;right:0;bottom:0;top:-8rem;
 overflow:hidden;z-index:-1;pointer-events:none}
.hero-grid{position:absolute;inset:0;
 background-image:linear-gradient(var(--grid-line) 1px,transparent 1px),
                  linear-gradient(90deg,var(--grid-line) 1px,transparent 1px);
 background-size:40px 40px;
 -webkit-mask-image:linear-gradient(to bottom,black 0%,transparent 78%);
 mask-image:linear-gradient(to bottom,black 0%,transparent 78%)}
.hero-glow{position:absolute;left:50%;top:-30%;width:46rem;height:46rem;margin-left:-23rem;
 background:radial-gradient(circle,oklch(60% 0.16 255deg),transparent 65%);
 opacity:.07;animation:glow-drift 14s ease-in-out infinite;will-change:transform}
@media (prefers-color-scheme:dark){.hero-glow{opacity:.12}}
@keyframes glow-drift{
 0%,100%{transform:translate(0,0) scale(1)}
 38%{transform:translate(-22px,18px) scale(1.07)}
 72%{transform:translate(14px,-12px) scale(.96)}
}
@media (prefers-reduced-motion:reduce){.hero-glow{animation:none}}
`;

const BASE = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--foreground);
 font-family:var(--font-sans);font-size:1rem;line-height:1.65;
 font-synthesis-weight:none;-webkit-font-smoothing:antialiased;
 display:flex;flex-direction:column;min-height:100vh}
/* Matches k-o.pro's own .container utility step for step (same breakpoints,
   same max-widths, same padding), so the header pill and hero read as the
   same site rather than a narrower cousin of it. Long-form content overrides
   this back down for readability — see .page-body below. */
.wrap{width:100%;max-width:40rem;margin-inline:auto;padding-inline:1rem}
@media (width >= 40rem){.wrap{max-width:40rem}}
@media (width >= 48rem){.wrap{max-width:48rem;padding-inline:2rem}}
@media (width >= 64rem){.wrap{max-width:64rem}}
@media (width >= 80rem){.wrap{max-width:80rem}}
@media (width >= 86rem){.wrap{max-width:86rem}}
main{flex:1}
h1,h2,h3{line-height:1.15;margin:0;text-wrap:balance}
h1{font-family:var(--font-display);font-weight:400;letter-spacing:-.01em;
 font-size:clamp(2.5rem,7vw,3.75rem)}
h2{font-family:var(--font-display);font-weight:400;letter-spacing:-.01em;
 font-size:clamp(1.6rem,3.4vw,2rem);margin:3rem 0 .85rem}
h3{font-size:1.02rem;font-weight:700;margin:1.75rem 0 .4rem}
p,li{margin:0 0 .95rem;text-wrap:pretty}
ul{padding-left:1.15rem;margin:0 0 .95rem}
li{margin-bottom:.5rem}
a{color:inherit;text-underline-offset:.18em;
 text-decoration-color:color-mix(in oklch,currentColor 40%,transparent)}
a:hover{text-decoration-color:currentColor}
/* Google's own convention: content links are blue, chrome stays neutral —
   the same split as Search Console's sidebar, where every item is gray except
   the active one. Scoped to <main> so header/footer nav (logo, GH pill, the
   footer link list) stay neutral chrome rather than turning into link-blue. */
main a{color:var(--brand)}
strong{font-weight:700}
code{font-family:var(--font-mono);font-size:.875em;
 background:color-mix(in oklch,var(--foreground) 7%,transparent);
 padding:.14em .4em;border-radius:6px}
pre{font-family:var(--font-mono);font-size:.85rem;line-height:1.5;
 background:var(--card);border:1px solid var(--border);
 border-radius:calc(var(--radius) - 6px);
 padding:.9rem 1.1rem;overflow-x:auto;margin:0 0 1rem}
pre code{background:none;padding:0;font-size:1em}
table{border-collapse:collapse;width:100%;font-size:.94rem;margin:0 0 1rem}
th,td{text-align:left;padding:.55rem .7rem;border-bottom:1px solid var(--border);
 vertical-align:top}
th{font-weight:700;color:var(--muted-foreground);font-size:.82rem;
 text-transform:uppercase;letter-spacing:.04em}
.lede{font-size:1.15rem;line-height:1.55;color:var(--muted-foreground);
 max-width:34rem;margin-bottom:1.75rem}
.kicker{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.09em;
 text-transform:uppercase;color:var(--brand);margin-bottom:1rem}
.note{font-size:.88rem;color:var(--muted-foreground)}
:focus-visible{outline:2px solid var(--brand);outline-offset:3px;border-radius:4px}
`;

const HEADER_FOOTER = `
.site-head{position:sticky;top:0;z-index:50;width:100%;padding-top:.75rem}
@media (width >= 48rem){.site-head{padding-top:1rem}}
.head-pill{display:flex;align-items:center;justify-content:space-between;gap:.75rem;
 border-radius:9999px;padding:.55rem .75rem .55rem 1.25rem}
.head-mark{display:inline-flex;align-items:center;gap:.6rem;
 text-decoration:none;white-space:nowrap;min-width:0}
/* One black transparent PNG for both themes. Inverting it in dark mode costs
   nothing and avoids a second asset; the mark is pure black on transparency,
   so the inverse is exactly the white variant k-o.pro ships. */
.site-logo{display:block;height:1.6rem;width:auto}
@media (prefers-color-scheme:dark){.site-logo{filter:invert(1)}}
.head-sub{color:var(--muted-foreground);font-weight:600;font-size:.85rem;
 border-left:1px solid var(--border);padding-left:.6rem;display:none}
@media (width >= 34rem){.head-sub{display:inline}}
/* The repo link: mark, then the star count as a bordered counter, echoing
   GitHub's own button so the number reads as "stars" without a label. */
.gh{display:inline-flex;align-items:center;gap:.5rem;text-decoration:none;
 font-size:.85rem;font-weight:700;white-space:nowrap;
 border:1px solid var(--border);border-radius:9999px;
 padding:.35rem .5rem .35rem .7rem;
 background:color-mix(in oklch,var(--background) 55%,transparent)}
.gh:hover{border-color:color-mix(in oklch,var(--brand) 45%,var(--border))}
.gh svg{width:1.05rem;height:1.05rem;flex:none}
.gh-stars{display:inline-flex;align-items:center;gap:.2rem;
 border-left:1px solid var(--border);padding-left:.5rem;
 color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.gh-label{display:none}
@media (width >= 30rem){.gh-label{display:inline}}
.site-foot{margin-top:4rem;background:var(--footer);color:var(--footer-foreground)}
.site-foot .wrap{padding-block:2.25rem}
.site-foot a{color:inherit}
.foot-links{display:flex;flex-wrap:wrap;gap:.4rem 1.25rem;
 font-size:.9rem;font-weight:600;margin-bottom:1rem;padding:0;list-style:none}
.foot-links li{margin:0}
.site-foot .note{color:color-mix(in oklch,var(--footer-foreground) 62%,transparent);
 margin:0}
`;

const COMPONENTS = `
.card{background:var(--brand-surface);border:1px solid var(--border);
 border-radius:var(--radius);padding:1.25rem 1.4rem;margin:0 0 1rem}
.card h3{margin-top:0}
.card p:last-child,.card ul:last-child{margin-bottom:0}
.grid{display:grid;gap:.75rem;margin:0 0 1rem}
@media (width >= 40rem){.grid-2{grid-template-columns:1fr 1fr}}
.pill-row{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.5rem;padding:0;list-style:none}
.pill-row li{margin:0;font-size:.78rem;font-weight:600;
 display:inline-flex;align-items:center;gap:.45rem;
 background:color-mix(in oklch,var(--card) 70%,transparent);
 border:1px solid var(--border);border-radius:9999px;padding:.25rem .75rem;
 color:var(--muted-foreground)}
.pill-row li::before{content:"";width:.375rem;height:.375rem;border-radius:9999px;
 background:color-mix(in oklch,var(--brand) 60%,transparent);flex:none}
.step{border-left:2px solid var(--brand-mid);padding-left:1.1rem;margin-bottom:1.5rem}
.step h3{margin-top:0}
.step p:last-child,.step pre:last-child{margin-bottom:0}
.cta-row{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin:0 0 1rem}
.btn{display:inline-flex;align-items:center;gap:.5rem;text-decoration:none;
 font-weight:700;font-size:.95rem;border-radius:9999px;padding:.7rem 1.35rem;
 white-space:nowrap;transition:transform .12s ease}
.btn:hover{transform:translateY(-1px)}
.btn svg{width:1.05rem;height:1.05rem;flex:none}
.btn-ghost{border:1px solid var(--border);color:inherit;
 background:color-mix(in oklch,var(--card) 60%,transparent)}
.btn-ghost:hover{border-color:color-mix(in oklch,var(--brand) 45%,var(--border))}
@media (prefers-reduced-motion:reduce){.btn:hover{transform:none}}
.faq{border-top:1px solid var(--border);padding-top:1.1rem;margin-top:1.1rem}
.faq h3{margin-top:0}
.faq p:last-child{margin-bottom:0}
.tool-name{font-family:var(--font-mono);font-size:.86em;white-space:nowrap}
`;

/** The GitHub mark, inline because `default-src 'none'` forbids <img>. */
export const GITHUB_MARK =
  `<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">` +
  `<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>` +
  `</svg>`;

const STAR_MARK =
  `<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" ` +
  `style="width:.85rem;height:.85rem">` +
  `<path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>` +
  `</svg>`;

export const THEME_CSS = FONT_FACES + TOKENS + BASE + GLASS + HERO + HEADER_FOOTER + COMPONENTS;

/** Shared by every page here, so the two cannot drift apart. */
export const esc = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Star counts are rendered the way GitHub renders them — 1200 as "1.2k" — so
 * the pill stays the same width as the number grows.
 */
export function formatStars(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "";
  if (count < 1000) return String(Math.round(count));
  const thousands = count / 1000;
  return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`;
}

/**
 * The repo link for the header. `stars` omitted — or unavailable because
 * GitHub could not be reached — renders the link with no counter rather than a
 * zero, which would read as a real and unflattering number.
 */
export function repoLink(repoUrl: string, stars?: number): string {
  const slug = repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/+$/, "");
  const label = slug && slug !== repoUrl ? slug : "GitHub";
  const formatted = typeof stars === "number" ? formatStars(stars) : "";
  const counter = formatted
    ? `<span class="gh-stars">${STAR_MARK}${esc(formatted)}</span>`
    : "";
  const aria = formatted
    ? `${label} on GitHub, ${stars} ${stars === 1 ? "star" : "stars"}`
    : `${label} on GitHub`;
  return `<a class="gh" href="${esc(repoUrl)}" rel="noopener" aria-label="${esc(aria)}">` +
    `${GITHUB_MARK}<span class="gh-label">${esc(label)}</span>${counter}</a>`;
}

export interface ShellOptions {
  title: string;
  description?: string;
  /** Rendered inside <main>. */
  body: string;
  repoUrl?: string;
  stars?: number;
  contactEmail?: string;
  /** Keeps the OAuth-facing pages out of the index. */
  noindex?: boolean;
  /**
   * Absolute URL of this page, used for canonical and og:url. Omitted unless
   * the deployment published a real one — see canonicalBase.
   */
  canonical?: string;
  /** Structured data objects, emitted as application/ld+json. */
  jsonLd?: unknown[];
}

/**
 * The origin to build absolute URLs from, or undefined when there isn't a
 * trustworthy one.
 *
 * publicUrl falls back to `http://127.0.0.1:8787` when GSC_PUBLIC_URL is unset,
 * and pointing a canonical, og:url or sitemap at that is worse than emitting
 * nothing: it would tell a crawler the page's real address is a loopback
 * address. So absolute-URL metadata is gated on an https origin, which only a
 * genuinely published deployment has.
 */
export function canonicalBase(publicUrl: string): string | undefined {
  try {
    const url = new URL(publicUrl);
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export function shell(o: ShellOptions): string {
  // og:image is deliberately absent: there is no artwork for this service yet,
  // and a card with a broken image is worse than a text-only one.
  const social = o.canonical
    ? [
        `<link rel="canonical" href="${esc(o.canonical)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="Google Search Console MCP">`,
        `<meta property="og:title" content="${esc(o.title)}">`,
        o.description ? `<meta property="og:description" content="${esc(o.description)}">` : "",
        `<meta property="og:url" content="${esc(o.canonical)}">`,
        `<meta name="twitter:card" content="summary">`,
      ].filter(Boolean).join("")
    : "";

  // A <script> body is raw text, so HTML entities are NOT decoded inside it —
  // running this through esc() would emit `&quot;` and produce invalid JSON that
  // no consumer can read. Escaping `<` as the JSON string escape \u003c is both
  // valid JSON and enough to make `</script>` unrepresentable, which is the only
  // way markup could break out. JSON-LD is a data block rather than executable
  // script, so `default-src 'none'` permits it — verified in a browser.
  const structured = (o.jsonLd ?? [])
    .map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, "\\u003c")}</script>`)
    .join("");

  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${esc(o.title)}</title>`,
    o.description ? `<meta name="description" content="${esc(o.description)}">` : "",
    o.noindex ? `<meta name="robots" content="noindex">` : "",
    social,
    `<style>${THEME_CSS}</style>`,
    structured,
  ].filter(Boolean).join("");

  const nav = o.repoUrl ? repoLink(o.repoUrl, o.stars) : "";
  const contact = o.contactEmail
    ? `<li><a href="mailto:${esc(o.contactEmail)}">${esc(o.contactEmail)}</a></li>`
    : "";
  const repoFoot = o.repoUrl
    ? `<li><a href="${esc(o.repoUrl)}" rel="noopener">Source on GitHub</a></li>`
    : "";

  return `<!doctype html><html lang="en"><head>${head}</head><body>
<header class="site-head"><div class="wrap"><div class="head-pill glass">
<a class="head-mark" href="/"><img class="site-logo" src="/img/k-o-pro.png" width="649" height="274" alt="k-o.pro"><span class="head-sub">Search Console MCP</span></a>
${nav}
</div></div></header>
<main>${o.body}</main>
<footer class="site-foot"><div class="wrap">
<ul class="foot-links">
<li><a href="/">Overview</a></li>
<li><a href="/privacy">Privacy</a></li>
${repoFoot}${contact}
<li><a href="https://k-o.pro" rel="noopener">k-o.pro</a></li>
</ul>
<p class="note">Not affiliated with or endorsed by Google or Anthropic.
&ldquo;Google&rdquo; and &ldquo;Google Search Console&rdquo; are trademarks of Google LLC.</p>
</div></footer>
</body></html>`;
}
