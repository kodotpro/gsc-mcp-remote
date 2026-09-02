import { getSearchConsoleClient, resolveSiteUrl } from "./auth.js";

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface QueryParams {
  startDate: string;
  endDate: string;
  dimensions: string[];
  dimensionFilterGroups?: Array<{
    filters: Array<{
      dimension: string;
      operator: string;
      expression: string;
    }>;
  }>;
  rowLimit?: number;
  // GSC Search Analytics `type` filter. Values: web (default), image, video,
  // news, discover, googleNews. Added in v2.3 to unlock image-search data.
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  /** Hard ceiling on accumulated rows; defaults to MAX_TOTAL_ROWS. */
  maxTotalRows?: number;
}

/**
 * Ceiling on rows held in memory by one call.
 *
 * Pagination used to run until Google ran out of rows, accumulating every one
 * in an array. A high-cardinality query (query+page dimensions over 16 months)
 * can return hundreds of thousands of rows, and on a shared host that is
 * enough to take the whole process — and every other tenant — down. Callers
 * that legitimately need more can raise it per call; the result says plainly
 * when a cut happened, so an answer is never quietly computed on partial data.
 */
export const MAX_TOTAL_ROWS = Number(process.env.GSC_MAX_TOTAL_ROWS ?? 100000);

/** Set when the last fetchAllRows call stopped early. */
export interface RowFetchResult {
  rows: SearchAnalyticsRow[];
  truncated: boolean;
  limit: number;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function getDateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday (latest available)
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
}

export function getPriorDateRange(days: number): { startDate: string; endDate: string } {
  const currentEnd = new Date();
  currentEnd.setDate(currentEnd.getDate() - 1);
  const currentStart = new Date(currentEnd);
  currentStart.setDate(currentStart.getDate() - days + 1);

  const priorEnd = new Date(currentStart);
  priorEnd.setDate(priorEnd.getDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorStart.getDate() - days + 1);

  return {
    startDate: formatDate(priorStart),
    endDate: formatDate(priorEnd),
  };
}

/**
 * Fetches all rows from the Search Analytics API with automatic pagination.
 * Uses dataState: 'all' so data matches the GSC dashboard exactly.
 */
export async function fetchAllRows(params: QueryParams, siteUrlOverride?: string): Promise<SearchAnalyticsRow[]> {
  const { rows } = await fetchRows(params, siteUrlOverride);
  return rows;
}

/**
 * Same fetch, but reports whether the row ceiling cut the result short.
 * Tools that surface totals should prefer this and pass the flag on.
 */
export async function fetchRows(params: QueryParams, siteUrlOverride?: string): Promise<RowFetchResult> {
  const client = await getSearchConsoleClient();
  const siteUrl = resolveSiteUrl(siteUrlOverride);
  const allRows: SearchAnalyticsRow[] = [];
  const maxTotal = Math.max(1, params.maxTotalRows ?? MAX_TOTAL_ROWS);
  const pageSize = Math.min(params.rowLimit || 25000, maxTotal);
  let startRow = 0;
  let truncated = false;

  while (true) {
    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: params.dimensions,
        dimensionFilterGroups: params.dimensionFilterGroups,
        rowLimit: pageSize,
        startRow,
        dataState: "all",
        // Pass through the type filter when provided. Defaults server-side to
        // `web` when omitted, matching prior behaviour.
        ...(params.type ? { type: params.type } : {}),
      },
    });

    const rows = response.data.rows;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      allRows.push({
        keys: row.keys || [],
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr || 0,
        position: row.position || 0,
      });
    }

    if (allRows.length >= maxTotal) {
      // Stop before the next page rather than after it: the point is to bound
      // peak memory, not to report a tidy number.
      truncated = allRows.length > maxTotal || rows.length === pageSize;
      allRows.length = Math.min(allRows.length, maxTotal);
      break;
    }
    if (rows.length < pageSize) break;
    startRow += pageSize;
  }

  return { rows: allRows, truncated, limit: maxTotal };
}
