/**
 * Output schemas: the declared shape of what a tool returns.
 *
 * Every analysis tool returns the same envelope, `{ _meta, data }`, as JSON
 * text. It is now also returned as `structuredContent`, so a client (and the
 * MCP Apps view) gets a typed object instead of parsing a string. For the ten
 * tools below the shape of `data` is declared too, as an `outputSchema` in
 * tools/list: a client can know what a tool returns before calling it.
 *
 * Why only ten. An output schema is paid for by every client in every
 * conversation, like a description, and v3.10.0 had just halved that bill.
 * These ten are the tools whose shape is pinned from both sides: by the
 * fixture tests in scripts/check-analytics.mjs and by the view that draws
 * them. Declaring a shape nothing checks would be a promise nobody keeps.
 *
 * The SDK enforces a declared schema: a result that does not match is replaced
 * by an error. So the schemas are deliberately tolerant where tolerance costs
 * nothing: objects are open (extra fields are allowed), and every number may be
 * null, because that is what JSON makes of NaN and what a division by zero
 * upstream would produce. A wrong TYPE still fails, which is the point.
 */
import { z } from "zod";

const num = z.number().nullable();
const str = z.string();

/**
 * The provenance block withMeta puts on every result (source, tool, parameters,
 * note, untrusted_text). Declared as an open object and not field by field:
 * spelled out, it added 330 bytes to each of the ten schemas to describe
 * something that is identical everywhere and already explained in the server
 * instructions.
 */
const META = z.looseObject({});

const totals = z.looseObject({ clicks: num, impressions: num, ctr: num.describe("percent"), position: num });

const DATA: Record<string, z.ZodType> = {
  quick_wins: z.array(z.looseObject({
    query: str, clicks: num, impressions: num, ctr: num.describe("percent"), position: num,
    opportunity: num.describe("estimated extra clicks at position 3"),
  })),
  ctr_opportunities: z.array(z.looseObject({
    page: str, clicks: num, impressions: num, ctr: num.describe("percent"), position: num,
    expectedCtr: num.describe("percent"), ctrGap: num.describe("percentage points"), potentialExtraClicks: num,
  })),
  traffic_drops: z.array(z.looseObject({
    page: str, currentClicks: num, priorClicks: num, clickChange: num,
    currentPosition: num, priorPosition: num, positionChange: num.describe("positive is worse"), diagnosis: str,
  })),
  content_gaps: z.array(z.looseObject({ query: str, impressions: num, clicks: num, position: num })),
  content_decay: z.array(z.looseObject({
    page: str,
    period1Clicks: num.describe("most recent 30 days"), period2Clicks: num, period3Clicks: num.describe("oldest 30 days"),
    totalClickLoss: num, period1Position: num, period2Position: num, period3Position: num, positionTrend: str,
  })),
  ctr_vs_benchmark: z.array(z.looseObject({
    page: str, clicks: num, impressions: num, actualCtr: num.describe("percent"), position: num,
    benchmarkCtr: num.describe("percent"), gap: num.describe("percentage points"), verdict: str,
  })),
  cannibalization_check: z.array(z.looseObject({
    query: str, totalImpressions: num,
    pages: z.array(z.looseObject({ page: str, clicks: num, impressions: num, position: num })),
  })),
  check_alerts: z.looseObject({
    alerts: z.array(z.looseObject({
      severity: z.enum(["critical", "warning", "info"]),
      type: z.enum(["position_drop", "ctr_drop", "click_drop", "disappeared"]),
      entity: str, detail: str, currentValue: num, previousValue: num, change: num,
    })),
    summary: z.looseObject({ critical: num, warning: num, info: num, total: num }),
    period: z.looseObject({ days: num, startDate: str, endDate: str }),
    thresholds: z.looseObject({ positionDrop: num, ctrDrop: num, clickDrop: num }),
  }),
  site_snapshot: z.looseObject({
    period: z.looseObject({ startDate: str, endDate: str }),
    current: totals,
    prior: totals,
    change: z.looseObject({
      clicks: num, clicksPercent: num, impressions: num, impressionsPercent: num,
      ctr: num.describe("percentage points"), position: num.describe("negative is better"),
    }),
  }),
  multi_site_dashboard: z.looseObject({
    periodDays: num,
    sites: z.array(z.looseObject({
      siteUrl: str,
      current: totals,
      change: z.looseObject({ clicksPercent: num, impressionsPercent: num, ctr: num, position: num }),
      health: z.enum(["healthy", "warning", "declining"]),
    })),
    summary: str,
  }),
};

/** The `outputSchema` shape for a tool, or undefined when it declares none. */
export function outputShapeFor(name: string): { _meta: z.ZodType; data: z.ZodType } | undefined {
  if (!Object.prototype.hasOwnProperty.call(DATA, name)) return undefined;
  return { _meta: META, data: DATA[name] };
}

/** The tools that declare an output schema. */
export const TOOLS_WITH_OUTPUT_SCHEMA: readonly string[] = Object.keys(DATA);
