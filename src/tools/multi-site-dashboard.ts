import { fetchAllRows, getDateRange, getPriorDateRange } from "../analytics.js";
import { configuredSiteUrls, defaultSiteUrl } from "../auth.js";

interface SiteHealth {
  siteUrl: string;
  current: { clicks: number; impressions: number; ctr: number; position: number };
  change: {
    clicksPercent: number;
    impressionsPercent: number;
    ctr: number;
    position: number;
  };
  health: "healthy" | "warning" | "declining";
}

interface MultiSiteDashboardResult {
  periodDays: number;
  sites: SiteHealth[];
  summary: string;
}

async function siteSnapshotForUrl(
  siteUrl: string,
  days: number
): Promise<SiteHealth> {
  const current = getDateRange(days);
  const prior = getPriorDateRange(days);

  const [currentRows, priorRows] = await Promise.all([
    fetchAllRows({ startDate: current.startDate, endDate: current.endDate, dimensions: ["date"] }, siteUrl),
    fetchAllRows({ startDate: prior.startDate, endDate: prior.endDate, dimensions: ["date"] }, siteUrl),
  ]);

  const sum = (rows: typeof currentRows) => {
    let clicks = 0, impressions = 0, posWeight = 0;
    for (const r of rows) {
      clicks += r.clicks;
      impressions += r.impressions;
      // Each row's position is already impression-weighted within the row, so
      // weighting by impressions here reproduces the true period-wide average
      posWeight += r.position * r.impressions;
    }
    return {
      clicks,
      impressions,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
      position: impressions > 0 ? Math.round((posWeight / impressions) * 10) / 10 : 0,
    };
  };

  const c = sum(currentRows);
  const p = sum(priorRows);

  const clicksPercent = p.clicks > 0
    ? Math.round(((c.clicks - p.clicks) / p.clicks) * 10000) / 100
    : 0;

  let health: "healthy" | "warning" | "declining";
  if (clicksPercent >= 0) {
    health = "healthy";
  } else if (clicksPercent > -20) {
    health = "warning";
  } else {
    health = "declining";
  }

  return {
    siteUrl,
    current: c,
    change: {
      clicksPercent,
      impressionsPercent: p.impressions > 0
        ? Math.round(((c.impressions - p.impressions) / p.impressions) * 10000) / 100
        : 0,
      ctr: Math.round((c.ctr - p.ctr) * 100) / 100,
      position: Math.round((c.position - p.position) * 10) / 10,
    },
    health,
  };
}

/** Concurrent property snapshots; each one paginates, so this is not free. */
const MAX_CONCURRENCY = 4;
const MAX_PROPERTIES = 25;

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function multiSiteDashboard(
  siteUrls?: string[],
  days: number = 28
): Promise<MultiSiteDashboardResult> {
  // Deliberately does NOT call getConfig(): that throws when GSC_SITE_URL is
  // unset, which broke this tool even when the caller named properties
  // explicitly — and unset is the normal case both for multi-property use and
  // for the hosted per-user deployment, where there is no process-wide default.
  const explicit = (siteUrls ?? []).map((u) => u.trim()).filter(Boolean);
  const configured = configuredSiteUrls();
  const fallback = defaultSiteUrl();

  const urls = explicit.length > 0
    ? explicit
    : configured.length > 0
      ? configured
      : fallback
        ? [fallback]
        : [];

  if (urls.length === 0) {
    throw new Error(
      "No properties to compare. Pass site_urls with the properties you want, " +
      "or set GSC_SITE_URLS. Call list_properties to see what this account can access."
    );
  }
  if (urls.length > MAX_PROPERTIES) {
    throw new Error(
      `Too many properties in one call (${urls.length}). The limit is ${MAX_PROPERTIES}, ` +
      `because each one paginates its own Search Analytics query. Split the request.`
    );
  }

  // Bounded fan-out: unbounded Promise.all over N paginating queries is how a
  // large account turns one tool call into a memory and quota spike.
  const sites = await mapLimited(urls, MAX_CONCURRENCY, (url) => siteSnapshotForUrl(url, days));

  const healthyCount = sites.filter((s) => s.health === "healthy").length;
  const warningCount = sites.filter((s) => s.health === "warning").length;
  const decliningCount = sites.filter((s) => s.health === "declining").length;

  const summary =
    `${sites.length} sites analysed over ${days} days. ` +
    `${healthyCount} healthy, ${warningCount} warning, ${decliningCount} declining.`;

  return {
    periodDays: days,
    sites,
    summary,
  };
}
