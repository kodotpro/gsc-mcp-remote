import { ASSETS, GUIDES, PRODUCT_NAME } from "./site-content.js";

/**
 * The visual language for this deployment's public pages: k-o.pro's.
 *
 * Everything here is constrained by the Content-Security-Policy in http.ts:
 * `default-src 'none'` with `style-src 'unsafe-inline'` and `font-src 'self'`.
 * That rules out external stylesheets, any JavaScript, and <img> from other
 * origins, so the design leans on what survives those limits: inline CSS, one
 * self-hosted font, inline SVG, and `prefers-color-scheme`.
 *
 * Tokens are k-o.pro's own, read from its stylesheet: the warm paper ground,
 * near-black ink, hairline borders, a mint accent, Host Grotesk at medium
 * weight with tight tracking for headings, monospace for labels and pills, an
 * ink pill for the primary action, 20px figures and 8px tiles. The MCP Apps
 * view (src/app-view/view.css) uses the same values, so a result rendered in a
 * client and the page that documents the tool look like one product.
 *
 * An earlier version of this file ported k-o.pro's previous design (Manrope,
 * Instrument Serif, a glass header) and swapped its colours for Google's
 * Material palette. k-o.pro has since been redesigned, and that port no longer
 * matched either site.
 */

/** Public paths of the self-hosted fonts, served by http.ts from dist/fonts. */
export const FONT_ROUTES = {
  // k-o.pro's face. One variable file covers the three weights used (400-600).
  // Also loaded by the MCP Apps view (src/app-view), cross-origin.
  "host-grotesk-latin.woff2": "font/woff2",
} as const;

export type FontFile = keyof typeof FONT_ROUTES;

/**
 * Images, served from dist/img. The k-o.pro wordmark is a single black
 * transparent PNG, flipped to white in dark mode with a CSS filter rather than
 * shipping a second file (see .site-logo). The rest are the icon set and the
 * 1200x630 social card; their names carry a version because this route is
 * served immutable, so a changed image has to ship under a new name.
 */
export const IMAGE_ROUTES = {
  "k-o-pro.png": "image/png",
  // v1 is the previous design. It stays served because links already shared
  // point at it and the route is immutable; new shares get v2.
  "og-card-v1.png": "image/png",
  "og-card-v2.png": "image/png",
  "icon-192-v1.png": "image/png",
  "apple-touch-icon-v1.png": "image/png",
  "favicon-v1.ico": "image/x-icon",
} as const;

export type ImageFile = keyof typeof IMAGE_ROUTES;

/**
 * Latin subset only, lifted from k-o.pro's build.
 *
 * The `Fallback` face is not decoration: it re-declares the metric overrides
 * k-o.pro's build generates, so the system font shown during `swap` occupies
 * the same space as the real one and the heading does not reflow when the
 * webfont lands. k-o.pro's monospace (Geist Mono) is not shipped: it carries
 * the least of the brand and system monospace costs nothing.
 */
const FONT_FACES = `
@font-face{font-family:"Host Grotesk";font-style:normal;font-weight:400 600;font-display:swap;
 src:url(/fonts/host-grotesk-latin.woff2) format("woff2");
 unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Host Grotesk Fallback";src:local(Arial);
 ascent-override:96.69%;descent-override:30.01%;line-gap-override:0%;size-adjust:104.98%}
`;

/**
 * k-o.pro's palette, under the variable names the rest of this file already
 * used: ground / surface / ink / text / muted / line, and the mint accent with
 * its darker "ink" for text and its tint for fills.
 *
 * k-o.pro has no dark theme. The dark values are derived from the same hues
 * rather than left out, because these pages have always followed the system
 * setting and a bright paper page at night would be a regression.
 */
const TOKENS = `
:root{
 --background:#f2f0eb; --foreground:#141412; --text:#3a3832;
 --card:#fbfaf7; --raised:#edeae2; --muted-foreground:#57544c;
 --border:#1414121f; --border-strong:#14141238;
 --accent:#5fe3a1; --brand:#367152; --brand-surface:#d9f5e4;
 --warn:#8a5a10; --warn-tint:#f4e7cf; --error:#a23e2a; --error-tint:#f6e1dc;
 --brand-mid:#5fe3a1;
 --radius:20px; --radius-tile:8px;
 --font-sans:"Host Grotesk","Host Grotesk Fallback",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
 --font-display:var(--font-sans);
 --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
 color-scheme:light;
}
@media (prefers-color-scheme:dark){
 :root{
  --background:#171614; --foreground:#f2f0eb; --text:#d9d5cb;
  --card:#1f1e1b; --raised:#2a2925; --muted-foreground:#a8a397;
  --border:#f2f0eb1f; --border-strong:#f2f0eb38;
  --brand:#5fe3a1; --brand-surface:#1f3a2c;
  --warn:#e0b25a; --warn-tint:#3a2f17; --error:#e8806d; --error-tint:#3d221c;
  color-scheme:dark;
 }
}
`;

/**
 * The header bar and the primary button. The class names are historical (the
 * previous design used a glass material here); k-o.pro's header is a flat bar
 * of translucent ground with a hairline under it, and its primary action is a
 * solid ink pill.
 */
const GLASS = `
.glass{background:none;border:0}
.glass-brand{background:var(--foreground);color:var(--background);border:1px solid var(--foreground)}
.glass-brand:hover{background:color-mix(in oklch,var(--foreground) 86%,var(--background))}
`;

/** The hero: plain ground, closed by a hairline, as on k-o.pro. */
const HERO = `
.hero{position:relative;border-bottom:1px solid var(--border)}
.hero-inner{padding:3rem 1rem 3.25rem}
@media (width >= 48rem){.hero-inner{padding:4.5rem 2rem 4.5rem}}
/* The hero's own bottom padding is the spacing; a trailing element's margin
   would stack on top of it. */
.hero-inner > :last-child{margin-bottom:0}
/* Wider than a fixed 46rem, but capped well short of .wrap's 86rem: tool
   tables and paragraphs get room without two-column tables turning sparse or
   lines running past a readable measure. */
.page-body{padding-block:2.75rem 1rem;max-width:56rem}
.page-body > h2:first-child{margin-top:0}
/* The previous design drew a grid and a glow behind the hero. The markup that
   carried them is still emitted; it simply has nothing to show. */
.hero-bg{display:none}
`;

const BASE = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--text);
 font-family:var(--font-sans);font-size:1.0625rem;line-height:1.5;
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
h1,h2,h3{line-height:1.1;margin:0;text-wrap:balance;color:var(--foreground)}
h1{font-weight:500;letter-spacing:-.035em;line-height:1.04;
 font-size:clamp(2.2rem,5.6vw,3.6rem)}
h2{font-weight:500;letter-spacing:-.025em;
 font-size:clamp(1.55rem,3.2vw,2rem);margin:3rem 0 .85rem}
h3{font-size:1.06rem;font-weight:600;letter-spacing:-.01em;margin:1.75rem 0 .4rem}
p,li{margin:0 0 .95rem;text-wrap:pretty}
ul{padding-left:1.15rem;margin:0 0 .95rem}
li{margin-bottom:.5rem}
a{color:inherit;text-underline-offset:.18em;
 text-decoration-color:color-mix(in oklch,currentColor 40%,transparent)}
a:hover{text-decoration-color:currentColor}
/* k-o.pro marks emphasis with a mint rule under ink text, not with a link
   colour. Scoped to main so the header and footer links stay plain chrome, and
   kept off buttons and pills, which carry their own treatment. */
main a:not(.btn){color:var(--foreground);text-decoration:none;padding-bottom:2px;
 background:linear-gradient(var(--accent),var(--accent)) no-repeat 0 100%/0% 2px,
            linear-gradient(currentColor,currentColor) no-repeat 0 100%/100% 1px;
 transition:background-size .5s cubic-bezier(.2,.7,.2,1)}
main a:not(.btn):hover{background-size:100% 2px,100% 1px}
strong{font-weight:600;color:var(--foreground)}
code{font-family:var(--font-mono);font-size:.84em;
 background:var(--raised);
 padding:.14em .4em;border-radius:6px}
pre{font-family:var(--font-mono);font-size:.82rem;line-height:1.5;
 background:var(--card);border:1px solid var(--border);
 border-radius:var(--radius-tile);
 padding:.9rem 1.1rem;overflow-x:auto;margin:0 0 1rem}
pre code{background:none;padding:0;font-size:1em}
table{border-collapse:collapse;width:100%;font-size:.94rem;margin:0 0 1rem}
th,td{text-align:left;padding:.55rem .7rem;border-bottom:1px solid var(--border);
 vertical-align:top}
th{font-family:var(--font-mono);font-weight:400;color:var(--muted-foreground);font-size:.72rem;
 text-transform:uppercase;letter-spacing:.04em}
.lede{font-size:1.15rem;line-height:1.55;color:var(--muted-foreground);
 max-width:34rem;margin-bottom:1.75rem}
.kicker{display:inline-block;font-family:var(--font-mono);font-size:.72rem;font-weight:400;letter-spacing:.06em;
 text-transform:uppercase;color:var(--muted-foreground);margin-bottom:1rem}
.note{font-size:.88rem;color:var(--muted-foreground)}
:focus-visible{outline:2px solid var(--brand);outline-offset:3px;border-radius:4px}
`;

const HEADER_FOOTER = `
.site-head{position:sticky;top:0;z-index:50;width:100%;
 background:color-mix(in oklch,var(--background) 82%,transparent);
 -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
 border-bottom:1px solid var(--border)}
@media (prefers-reduced-transparency:reduce){
 .site-head{-webkit-backdrop-filter:none;backdrop-filter:none;background:var(--background)}
}
.head-pill{display:flex;align-items:center;justify-content:space-between;gap:.75rem;
 padding:.7rem 0}
.head-mark{display:inline-flex;align-items:center;gap:.6rem;
 text-decoration:none;white-space:nowrap;min-width:0}
/* One black transparent PNG for both themes. Inverting it in dark mode costs
   nothing and avoids a second asset; the mark is pure black on transparency,
   so the inverse is exactly the white variant k-o.pro ships. */
.site-logo{display:block;height:1.5rem;width:auto}
@media (prefers-color-scheme:dark){.site-logo{filter:invert(1)}}
.head-sub{color:var(--muted-foreground);font-family:var(--font-mono);font-weight:400;font-size:.75rem;
 border-left:1px solid var(--border);padding-left:.6rem;display:none}
@media (width >= 34rem){.head-sub{display:inline}}
/* The repo link: mark, then the star count as a bordered counter, echoing
   GitHub's own button so the number reads as "stars" without a label. */
.gh{display:inline-flex;align-items:center;gap:.5rem;text-decoration:none;
 font-size:.84rem;font-weight:500;white-space:nowrap;color:var(--foreground);
 border:1px solid var(--border-strong);border-radius:9999px;
 padding:.45rem .6rem .45rem .8rem}
.gh:hover{background:var(--raised)}
.gh svg{width:1.05rem;height:1.05rem;flex:none}
.gh-stars{display:inline-flex;align-items:center;gap:.2rem;
 border-left:1px solid var(--border);padding-left:.5rem;
 font-family:var(--font-mono);font-size:.75rem;
 color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.gh-label{display:none}
@media (width >= 30rem){.gh-label{display:inline}}
.site-foot{margin-top:4rem;border-top:1px solid var(--border);color:var(--foreground)}
.site-foot .wrap{padding-block:2.5rem}
.site-foot a{color:inherit}
.foot-links{display:flex;flex-wrap:wrap;gap:.4rem 1.25rem;
 font-size:.92rem;font-weight:500;margin-bottom:1.25rem;padding:0;list-style:none}
.foot-links li{margin:0}
.site-foot .note{color:var(--muted-foreground);margin:0}
`;

const COMPONENTS = `
.card{background:var(--card);border:1px solid var(--border);
 border-radius:var(--radius);padding:1.25rem 1.4rem;margin:0 0 1rem}
.card h3{margin-top:0}
.card p:last-child,.card ul:last-child{margin-bottom:0}
.grid{display:grid;gap:.75rem;margin:0 0 1rem}
@media (width >= 40rem){.grid-2{grid-template-columns:1fr 1fr}}
.pill-row{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.5rem;padding:0;list-style:none}
.pill-row li{margin:0;font-family:var(--font-mono);font-size:.75rem;font-weight:400;
 display:inline-flex;align-items:center;gap:.45rem;min-height:26px;
 background:var(--background);
 border:1px solid var(--border);border-radius:9999px;padding:0 .7rem;
 color:var(--text)}
.pill-row li::before{content:"";width:.375rem;height:.375rem;border-radius:9999px;
 background:var(--accent);flex:none}
.step{border-left:2px solid var(--brand-mid);padding-left:1.1rem;margin-bottom:1.5rem}
.step h3{margin-top:0}
.step p:last-child,.step pre:last-child{margin-bottom:0}
.cta-row{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin:0 0 1rem}
.btn{display:inline-flex;align-items:center;gap:.5rem;text-decoration:none;
 font-weight:500;font-size:.94rem;border-radius:9999px;padding:.72rem 1.4rem;
 white-space:nowrap;
 transition:transform .35s cubic-bezier(.2,.7,.2,1),background-color .3s,border-color .3s}
.btn:hover{transform:translateY(-2px)}
.btn svg{width:1.05rem;height:1.05rem;flex:none}
.btn-ghost{border:1px solid var(--border-strong);color:var(--foreground);background:none}
.btn-ghost:hover{background:var(--raised)}
@media (prefers-reduced-motion:reduce){.btn:hover{transform:none}}
.faq{border-top:1px solid var(--border);padding-top:1.1rem;margin-top:1.1rem}
.faq h3{margin-top:0}
.faq p:last-child{margin-bottom:0}
.tool-name{font-family:var(--font-mono);font-size:.86em;white-space:nowrap}
/* The product name's suffix sits under the h1's main line, smaller, so the
   h1 carries the whole name without the display face wrapping awkwardly. */
.h1-sub{display:block;font-family:var(--font-sans);font-weight:400;
 font-size:clamp(1.05rem,2.4vw,1.35rem);letter-spacing:-.01em;line-height:1.3;color:var(--muted-foreground);
 margin-top:.6rem}
.crumbs{font-size:.85rem;color:var(--muted-foreground);margin:0 0 1rem;padding:0;
 list-style:none;display:flex;flex-wrap:wrap;gap:.35rem}
.crumbs li{margin:0}
.crumbs li + li::before{content:"/";margin-right:.35rem;opacity:.6}
.crumbs a{color:inherit}
/* Real tool output. No JavaScript is allowed here, so the expandable blocks on
   the landing page are plain details elements, which need none. */
.example{margin:0 0 1.5rem}
.example pre{max-height:26rem;overflow:auto}
.example figcaption{margin:0 0 .6rem}
.example .note{margin:.5rem 0 0}
details.example-toggle{border:1px solid var(--border);border-radius:var(--radius-tile);
 padding:.75rem 1rem;margin:0 0 .75rem;background:var(--card)}
details.example-toggle[open]{padding-bottom:1rem}
details.example-toggle > summary{cursor:pointer;font-weight:600;color:var(--foreground)}
details.example-toggle > summary .note{font-weight:400}
details.example-toggle > .example{margin:1rem 0 0}
.params td:first-child{white-space:nowrap}
.tool-block{border-top:1px solid var(--border);padding-top:1.1rem;margin-top:1.4rem}
.tool-block h3{margin-top:0}
.ask{font-style:italic}
.more{font-weight:600}
.related{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1rem;padding:0;list-style:none}
.related li{margin:0}
main .related a{display:inline-block;border:1px solid var(--border-strong);border-radius:9999px;
 padding:.3rem .85rem;font-size:.88rem;font-weight:500;background:none;
 transition:background-color .35s,border-color .35s}
main .related a:hover{background:var(--raised);border-color:var(--foreground)}
.byline{font-size:.92rem}
.foot-label{font-family:var(--font-mono);font-size:.72rem;font-weight:400;letter-spacing:.06em;text-transform:uppercase;
 margin:0 0 .5rem;color:var(--muted-foreground)}
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

/**
 * Motion, taken rule for rule from k-o.pro's stylesheet: the same keyframes,
 * durations, delays and its one easing curve, cubic-bezier(.2,.7,.2,1).
 *
 *  - .hw     each headline word rises out of a blur, 42ms after the last
 *  - .mark   the mint rule draws itself under a phrase once the headline lands
 *  - .fade   the rest of the hero follows, staggered by --d
 *  - .st     a block fades up out of a blur as it scrolls into view
 *  - .lift   a linked card rises on hover; .arw nudges its arrow
 *  - .hbar   a bar grows from nothing when its figure appears
 *  - .dot    the live-status dot pulses
 *
 * One thing differs in mechanism. k-o.pro reveals on scroll with a script that
 * toggles a class; these pages allow no script at all (default-src 'none'), so
 * the reveal is a CSS scroll-driven animation instead, behind @supports.
 * Browsers without it (Firefox, at the time of writing) show the content with
 * no reveal, which is also what everyone gets under prefers-reduced-motion:
 * every rule that hides or moves anything sits inside the no-preference query,
 * so nothing can be left invisible.
 */
const MOTION = `
.mark{background:linear-gradient(var(--accent),var(--accent)) no-repeat 0 90%/100% .13em;
 -webkit-box-decoration-break:clone;box-decoration-break:clone}
.arw{display:inline-block;transition:transform .4s cubic-bezier(.2,.7,.2,1)}
a:hover .arw{transform:translate(4px)}
.lift{transition:transform .5s cubic-bezier(.2,.7,.2,1),box-shadow .5s cubic-bezier(.2,.7,.2,1)}
.lift:hover{transform:translateY(-4px);box-shadow:0 28px 56px -32px #14141261}
.dot{position:relative;flex:none;width:.5rem;height:.5rem;border-radius:50%;background:var(--accent)}
.hbar{transform-origin:0}
@media (prefers-reduced-motion:no-preference){
 @keyframes hw{0%{opacity:0;filter:blur(10px);transform:translateY(.45em)}to{opacity:1;filter:none;transform:none}}
 @keyframes mark{to{background-size:100% .13em}}
 @keyframes fade{0%{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
 @keyframes ping{0%{opacity:.9;transform:scale(.6)}80%,to{opacity:0;transform:scale(1.7)}}
 @keyframes st{0%{opacity:0;filter:blur(6px);transform:translateY(32px)}to{opacity:1;filter:none;transform:none}}
 @keyframes growX{0%{transform:scaleX(0)}to{transform:scaleX(1)}}
 .hw{display:inline-block;animation:.95s cubic-bezier(.2,.7,.2,1) both hw;
  animation-delay:calc(var(--i,0) * 42ms + .12s)}
 .mark{background-size:0% .13em;animation:1.1s cubic-bezier(.2,.7,.2,1) 1.15s forwards mark}
 .fade{animation:.9s cubic-bezier(.2,.7,.2,1) both fade;animation-delay:calc(var(--d,0) * .11s + .85s)}
 .dot::after{content:"";position:absolute;inset:-4px;border:1.5px solid var(--accent);border-radius:50%;
  animation:2.4s ease-out infinite ping}
 @supports (animation-timeline:view()){
  .st{animation:st cubic-bezier(.2,.7,.2,1) both;animation-timeline:view();animation-range:entry 0% entry 55%}
  .st .hbar{animation:growX cubic-bezier(.2,.7,.2,1) both;animation-timeline:view();animation-range:entry 20% cover 35%}
 }
}
`;

/**
 * Static renderings of the MCP Apps view, for the pages. Same tokens and the
 * same shapes as src/app-view/view.css, drawn with plain HTML so they need no
 * script and no image file, stay sharp at any size and follow the theme.
 */
const DEMO = `
.demo{margin:0 0 1.5rem}
.demo-frame{background:var(--background);border:1px solid var(--border);border-radius:var(--radius);
 padding:1.25rem;box-shadow:0 28px 56px -40px #14141261}
.demo figcaption{font-size:.85rem;color:var(--muted-foreground);margin:.7rem .25rem 0}
.demo-eyebrow{font-family:var(--font-mono);font-size:.69rem;letter-spacing:.06em;text-transform:uppercase;
 color:var(--muted-foreground);margin:0 0 .35rem}
.demo-title{font-size:1.35rem;font-weight:500;letter-spacing:-.02em;line-height:1.15;color:var(--foreground);margin:0}
.demo-sub{font-size:.875rem;color:var(--muted-foreground);margin:.25rem 0 1rem}
.demo-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr));gap:.5rem;margin:0 0 .25rem}
.demo-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-tile);padding:.75rem .9rem;min-width:0}
.demo-card .k{font-family:var(--font-mono);font-size:.69rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted-foreground)}
.demo-card .v{font-size:1.6rem;line-height:1.15;font-weight:500;color:var(--foreground);margin-top:.35rem;font-variant-numeric:tabular-nums}
.demo-card .d{font-family:var(--font-mono);font-size:.75rem;margin-top:.25rem}
.good{color:var(--brand)} .bad{color:var(--error)}
.demo-tile{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-tile);overflow-x:auto}
.demo-tile table{margin:0;font-size:.875rem;font-variant-numeric:tabular-nums}
.demo-tile th,.demo-tile td{padding:.55rem .75rem;vertical-align:middle;border-bottom:1px solid var(--border)}
.demo-tile tr:last-child td{border-bottom:0}
.demo-tile td{color:var(--foreground)}
.demo-tile .n{text-align:right;white-space:nowrap}
.hbar-track{display:inline-block;vertical-align:middle;width:3.5rem;height:6px;margin-left:.5rem;
 background:var(--border);border-radius:999px;overflow:hidden}
.hbar{display:block;height:100%;background:var(--accent);border-radius:999px}
.hbar.neg{background:var(--error)}
.tag{display:inline-flex;align-items:center;min-height:24px;padding:0 .6rem;border-radius:999px;
 font-family:var(--font-mono);font-size:.75rem;white-space:nowrap;
 color:var(--text);background:var(--background);border:1px solid var(--border)}
.tag.ok{color:var(--brand);background:var(--brand-surface);border-color:transparent}
.tag.warn{color:var(--warn);background:var(--warn-tint);border-color:transparent}
.tag.err{color:var(--error);background:var(--error-tint);border-color:transparent}
`;

/** The "how it works" diagram, the group cards and the what's-new list. */
const BLOCKS = `
.flow{display:grid;gap:.5rem;margin:0 0 1.25rem;align-items:stretch}
@media (width >= 48rem){.flow{grid-template-columns:1fr auto 1fr auto 1fr}}
.flow-node{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-tile);padding:1rem 1.1rem}
.flow-node h3{margin:0 0 .35rem;font-size:1rem}
.flow-node p{margin:0;font-size:.875rem;color:var(--muted-foreground)}
.flow-node .k{display:block;font-family:var(--font-mono);font-size:.69rem;letter-spacing:.05em;text-transform:uppercase;
 color:var(--muted-foreground);margin-bottom:.5rem}
.flow-node.mid{border-color:var(--foreground)}
.flow-arrow{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.2rem;
 font-family:var(--font-mono);font-size:.69rem;color:var(--muted-foreground);text-align:center;padding:.15rem .25rem}
.flow-arrow b{font-family:var(--font-sans);font-weight:400;font-size:1.25rem;line-height:1;color:var(--foreground)}
@media (width < 48rem){.flow-arrow b{transform:rotate(90deg)}}
.grid > .card{margin:0;display:flex;flex-direction:column}
.grid > .card .go{margin-top:auto;padding-top:.6rem}
.h1-sub + .lede,h1 + .lede{margin-top:1.1rem}
/* The header is sticky, so an in-page link must stop short of it. */
h2[id]{scroll-margin-top:5.5rem}
.grid-3{grid-template-columns:1fr}
@media (width >= 40rem){.grid-3{grid-template-columns:1fr 1fr}}
@media (width >= 64rem){.grid-3{grid-template-columns:1fr 1fr 1fr}}
/* A card that is one link: its last line is the anchor, stretched over the
   whole card, so the heading stays a plain heading (in the Markdown form too)
   while the entire tile is the click target. */
.card.lift{position:relative}
main .card a.cover{background:none;padding:0}
.card a.cover::after{content:"";position:absolute;inset:0;border-radius:var(--radius)}
.card.lift:hover .arw{transform:translate(4px)}
.card .count{font-family:var(--font-mono);font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;
 color:var(--muted-foreground);margin:0 0 .5rem}
.card .go{margin:.6rem 0 0;font-size:.9rem;font-weight:500;color:var(--foreground)}
.status{display:inline-flex;align-items:center;gap:.6rem;font-family:var(--font-mono);font-size:.72rem;
 letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground);margin-bottom:1rem}
.news{list-style:none;padding:0;margin:0 0 1rem;border-top:1px solid var(--border)}
.news li{display:grid;grid-template-columns:5.5rem 1fr;gap:.75rem;margin:0;padding:.7rem 0;border-bottom:1px solid var(--border)}
.news .ver{font-family:var(--font-mono);font-size:.75rem;color:var(--muted-foreground);padding-top:.2rem}
`;

export const THEME_CSS = FONT_FACES + TOKENS + BASE + GLASS + HERO + HEADER_FOOTER + COMPONENTS + MOTION + DEMO + BLOCKS;

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

/**
 * Where a page's Markdown lives: /claude.md for /claude, and /index.md for the
 * root. A path suffix rather than a query string so it is an ordinary
 * cacheable URL that a link can point at.
 */
export function markdownPathFor(path: string): string {
  return path === "/" ? "/index.md" : `${path}.md`;
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
  /**
   * Where this page's Markdown representation lives. Advertised as
   * <link rel="alternate" type="text/markdown"> for the crawlers that read the
   * DOM; the same pointer goes out as an HTTP Link header for fetchers that
   * never read the body (see http.ts).
   */
  markdownPath?: string;
}

export interface Crumb {
  label: string;
  /** Omitted on the current page, which is not linked. */
  path?: string;
}

/** The visible breadcrumb trail; pages pair it with breadcrumbJsonLd(). */
export function crumbs(trail: Crumb[]): string {
  const items = trail
    .map((c) => (c.path ? `<li><a href="${esc(c.path)}">${esc(c.label)}</a></li>` : `<li aria-current="page">${esc(c.label)}</li>`))
    .join("");
  return `<ol class="crumbs" aria-label="Breadcrumb">${items}</ol>`;
}

/** BreadcrumbList for a trail, or nothing when there is no public origin to name. */
export function breadcrumbJsonLd(trail: Crumb[], base: string | undefined, currentPath: string): unknown[] {
  if (!base) return [];
  return [{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      item: `${base}${c.path ?? currentPath}`,
    })),
  }];
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
  // og:image needs an absolute URL, so like the canonical it is only emitted
  // when the deployment has a real https origin to build one from.
  const origin = o.canonical ? new URL(o.canonical).origin : undefined;
  const social = o.canonical && origin
    ? [
        `<link rel="canonical" href="${esc(o.canonical)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="${esc(PRODUCT_NAME)}">`,
        `<meta property="og:title" content="${esc(o.title)}">`,
        o.description ? `<meta property="og:description" content="${esc(o.description)}">` : "",
        `<meta property="og:url" content="${esc(o.canonical)}">`,
        `<meta property="og:image" content="${esc(origin + ASSETS.ogImage)}">`,
        `<meta property="og:image:width" content="1200">`,
        `<meta property="og:image:height" content="630">`,
        `<meta property="og:image:alt" content="${esc(PRODUCT_NAME)}: 32 tools, read-only, every property, open source">`,
        `<meta name="twitter:card" content="summary_large_image">`,
      ].filter(Boolean).join("")
    : "";

  // Relative, so they work on any deployment. /favicon.ico is also served at
  // the root for clients that request it without reading the markup.
  const icons = [
    `<link rel="icon" href="/favicon.ico" sizes="48x48">`,
    `<link rel="icon" href="${ASSETS.icon192}" type="image/png" sizes="192x192">`,
    `<link rel="apple-touch-icon" href="${ASSETS.appleTouchIcon}">`,
  ].join("");

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
    o.markdownPath ? `<link rel="alternate" type="text/markdown" href="${esc(o.markdownPath)}">` : "",
    social,
    icons,
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
<p class="foot-label">Guides</p>
<ul class="foot-links">
${GUIDES.map((g) => `<li><a href="${esc(g.path)}">${esc(g.label)}</a></li>`).join("\n")}
</ul>
<p class="foot-label">Project</p>
<ul class="foot-links">
<li><a href="/">Overview</a></li>
<li><a href="/privacy">Privacy</a></li>
<li><a href="/llms.txt">llms.txt</a></li>
${repoFoot}${contact}
<li><a href="https://k-o.pro" rel="noopener">k-o.pro</a></li>
</ul>
<p class="note">Not affiliated with or endorsed by Google or Anthropic.
&ldquo;Google&rdquo; and &ldquo;Google Search Console&rdquo; are trademarks of Google LLC.</p>
</div></footer>
</body></html>`;
}
