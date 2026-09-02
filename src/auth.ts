import { google } from "googleapis";
import { searchconsole_v1 } from "googleapis";
import * as fs from "fs";
import { authenticateWithOAuth, getScopeTier, scopesForTier } from "./oauth.js";
import { getUserContext } from "./request-context.js";

let cachedClient: searchconsole_v1.Searchconsole | null = null;

export type AuthMode = "service_account" | "oauth";

export function getAuthMode(): AuthMode {
  const mode = process.env.GSC_AUTH_MODE?.toLowerCase();
  if (mode === "oauth") return "oauth";
  return "service_account";
}

/**
 * Properties named by GSC_SITE_URLS, in declaration order. Empty when the var
 * is unset. GSC_SITE_URL, when set, is always the first entry.
 */
export function configuredSiteUrls(): string[] {
  const single = process.env.GSC_SITE_URL?.trim();
  const list = process.env.GSC_SITE_URLS
    ? process.env.GSC_SITE_URLS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const ordered = single ? [single, ...list.filter((s) => s !== single)] : list;
  return ordered;
}

/**
 * The property a tool falls back to when the caller names none.
 * Undefined when nothing is configured, which is legitimate: every tool now
 * accepts an explicit site_url, so a server with no default is still usable.
 */
export function defaultSiteUrl(): string | undefined {
  // A signed-in user's own saved default (set via set_default_property on the
  // hosted deployment) takes precedence over the process-wide env default.
  const ctx = getUserContext();
  const userDefault = ctx?.settings.getDefaultProperty();
  if (userDefault) return userDefault;
  return configuredSiteUrls()[0];
}

/**
 * Single decision point for "which property does this call run against".
 *
 * An explicit per-call site_url always wins; otherwise the configured default
 * is used. Resolution deliberately does NOT consult auth config, so a caller
 * that always passes site_url needs no GSC_SITE_URL at all — which is what
 * lets one server process serve a whole account (and, later, many users).
 */
export function resolveSiteUrl(requested?: string): string {
  const explicit = requested?.trim();
  if (explicit) return explicit;

  const fallback = defaultSiteUrl();
  if (!fallback) {
    const remote = Boolean(getUserContext());
    throw new Error(
      "No Search Console property specified. Pass site_url on the tool call" +
      (remote
        ? ", or save one with set_default_property. "
        : ", or set GSC_SITE_URL (or GSC_SITE_URLS) to provide a default. ") +
      "Call list_properties to see every property this account can access."
    );
  }
  return fallback;
}

export function getConfig() {
  const mode = getAuthMode();
  const siteUrl = process.env.GSC_SITE_URL;
  const siteUrls = configuredSiteUrls();

  if (mode === "service_account") {
    const keyFile = process.env.GSC_KEY_FILE;
    if (!keyFile) {
      throw new Error(
        "GSC_KEY_FILE environment variable is required in service_account mode. " +
        "Set it to the path of your service account JSON key file, " +
        "or switch to OAuth by setting GSC_AUTH_MODE=oauth."
      );
    }
    if (!siteUrl && siteUrls.length === 0) {
      throw new Error(
        "GSC_SITE_URL environment variable is required. " +
        "Set it to your GSC property URL (e.g. https://yoursite.com/ or sc-domain:yoursite.com)."
      );
    }
    if (!fs.existsSync(keyFile)) {
      throw new Error(`Service account key file not found at: ${keyFile}`);
    }
    return { keyFile, siteUrl: siteUrl || siteUrls[0], siteUrls };
  }

  // OAuth mode
  if (!siteUrl && siteUrls.length === 0) {
    throw new Error(
      "GSC_SITE_URL environment variable is required. " +
      "Set it to your GSC property URL (e.g. https://yoursite.com/ or sc-domain:yoursite.com)."
    );
  }
  return { keyFile: undefined, siteUrl: siteUrl || siteUrls[0], siteUrls };
}

/**
 * Deadline for every Google API call.
 *
 * googleapis sets none by default, so a hung or very slow Google response
 * would occupy a session — and, on a hosted server, one of that user's
 * request-rate slots — indefinitely. A bounded failure the caller can retry is
 * strictly better than a request that never returns.
 */
export const GOOGLE_TIMEOUT_MS = Number(process.env.GSC_GOOGLE_TIMEOUT_MS ?? 60_000);

async function getServiceAccountClient(): Promise<searchconsole_v1.Searchconsole> {
  const { keyFile } = getConfig();

  // Same scope set as the OAuth flow, including auth/indexing on the full
  // tier so submit_url / submit_batch work in service-account mode too (#2).
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: scopesForTier(getScopeTier()),
  });

  google.options({ auth, timeout: GOOGLE_TIMEOUT_MS });
  return google.searchconsole("v1");
}

async function getOAuthClient(): Promise<searchconsole_v1.Searchconsole> {
  const oauth2Client = await authenticateWithOAuth();
  google.options({ auth: oauth2Client, timeout: GOOGLE_TIMEOUT_MS });
  return google.searchconsole("v1");
}

export async function getSearchConsoleClient(): Promise<searchconsole_v1.Searchconsole> {
  // Multi-user (OAuth HTTP) mode: every request carries its user's own client,
  // so all 33 tools run as the person asking without any of them changing.
  const ctx = getUserContext();
  if (ctx) return ctx.getSearchConsole();

  if (cachedClient) return cachedClient;

  const mode = getAuthMode();

  if (mode === "oauth") {
    cachedClient = await getOAuthClient();
  } else {
    cachedClient = await getServiceAccountClient();
  }

  return cachedClient;
}
