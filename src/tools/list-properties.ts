import { getSearchConsoleClient, defaultSiteUrl } from "../auth.js";

interface Property {
  siteUrl: string;
  permissionLevel: string;
  type: "domain" | "url-prefix";
  isDefault: boolean;
  canAnalyse: boolean;
}

interface ListPropertiesResult {
  properties: Property[];
  total: number;
  defaultProperty: string | null;
  summary: string;
}

/**
 * Every Search Console property the authenticated credential can see.
 *
 * Upstream called sites.list only inside the interactive setup wizard, so at
 * runtime the model had no way to discover which properties exist — it could
 * only be told. Without this, a site_url parameter on every tool is still
 * unusable unless the caller already knows the exact property strings, and
 * they are easy to get wrong (sc-domain:example.com vs https://example.com/).
 */
export async function listProperties(): Promise<ListPropertiesResult> {
  const client = await getSearchConsoleClient();
  const response = await client.sites.list({});

  const configuredDefault = defaultSiteUrl() ?? null;

  const properties: Property[] = (response.data.siteEntry || []).map((entry) => {
    const siteUrl = entry.siteUrl || "";
    const permissionLevel = entry.permissionLevel || "unknown";
    return {
      siteUrl,
      permissionLevel,
      type: siteUrl.startsWith("sc-domain:") ? "domain" : "url-prefix",
      isDefault: siteUrl === configuredDefault,
      // siteUnverifiedUser cannot read Search Analytics; surfacing this stops
      // the model from reporting an empty result as "no traffic".
      canAnalyse: permissionLevel !== "siteUnverifiedUser",
    };
  });

  properties.sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));

  const analysable = properties.filter((p) => p.canAnalyse).length;
  const summary =
    properties.length === 0
      ? "This Google account has no Search Console properties. Add and verify a property in Search Console first."
      : `${properties.length} propert${properties.length === 1 ? "y" : "ies"} accessible, ` +
        `${analysable} readable for Search Analytics. ` +
        (configuredDefault
          ? `Default when a tool is called without site_url: ${configuredDefault}.`
          : "No default property is configured, so every tool call must pass site_url.");

  return {
    properties,
    total: properties.length,
    defaultProperty: configuredDefault,
    summary,
  };
}
