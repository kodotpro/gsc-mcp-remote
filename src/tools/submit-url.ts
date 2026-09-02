import { google } from "googleapis";
import { getAuthMode } from "../auth.js";
import { getUserContext } from "../request-context.js";
import { authenticateWithOAuth, getScopeTier } from "../oauth.js";
import * as fs from "fs";

async function getIndexingClient() {
  const mode = getAuthMode();

  // Multi-user hosted mode: this path authenticates via google.options(),
  // which is PROCESS-GLOBAL — it would act as the server's own credential, not
  // as the caller, and would leak that identity into other tenants' requests.
  // The Indexing API also needs a write scope the hosted deployment never
  // requests. Refuse rather than do the wrong thing quietly.
  if (getUserContext()) {
    throw new Error(
      "URL submission is not available on this hosted server. It runs read-only and per-user, " +
      "and the Indexing API needs write access the server never requests. " +
      "Run the server locally (stdio) with GSC_SCOPES=full to submit URLs for your own sites."
    );
  }

  if (mode === "oauth" && getScopeTier() === "readonly") {
    throw new Error(
      "URL submission needs full access, but this install is in read only mode (GSC_SCOPES=readonly). " +
      "Re-run `node dist/index.js setup --reauth` and choose full access, then try again."
    );
  }

  if (mode === "oauth") {
    const oauth2Client = await authenticateWithOAuth();
    google.options({ auth: oauth2Client });
  } else {
    const keyFile = process.env.GSC_KEY_FILE;
    if (!keyFile || !fs.existsSync(keyFile)) {
      throw new Error("GSC_KEY_FILE is required for indexing API in service_account mode.");
    }
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ["https://www.googleapis.com/auth/indexing"],
    });
    google.options({ auth });
  }

  return google.indexing("v3");
}

interface SubmitResult {
  url: string;
  type: string;
  notifyTime: string | null;
  success: boolean;
  error: string | null;
  note: string;
}

export async function submitUrl(
  url: string,
  action: "URL_UPDATED" | "URL_DELETED" = "URL_UPDATED"
): Promise<SubmitResult> {
  try {
    const indexing = await getIndexingClient();

    const response = await indexing.urlNotifications.publish({
      requestBody: {
        url,
        type: action,
      },
    });

    return {
      url,
      type: action,
      notifyTime: response.data.urlNotificationMetadata?.latestUpdate?.notifyTime || null,
      success: true,
      error: null,
      note:
        "Google has been notified. The Indexing API officially supports JobPosting and BroadcastEvent schema types, but processes requests for all page types. Priority is not guaranteed for non-job pages.",
    };
  } catch (err: any) {
    return {
      url,
      type: action,
      notifyTime: null,
      success: false,
      error: err.message || String(err),
      note:
        "Submission failed. Ensure the Indexing API is enabled in your Google Cloud project and the service account has owner access in Search Console.",
    };
  }
}

export async function submitBatch(
  urls: string[],
  action: "URL_UPDATED" | "URL_DELETED" = "URL_UPDATED"
): Promise<{ results: SubmitResult[]; summary: { total: number; succeeded: number; failed: number; note: string } }> {
  if (urls.length > 200) {
    throw new Error(
      `Google's Indexing API has a daily quota of 200 requests. You provided ${urls.length} URLs. Please reduce to 200 or fewer.`
    );
  }

  const results: SubmitResult[] = [];

  for (const url of urls) {
    const result = await submitUrl(url, action);
    results.push(result);

    // Small delay to avoid rate limiting
    if (urls.length > 10) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    results,
    summary: {
      total: urls.length,
      succeeded,
      failed,
      note: `Daily quota is 200 URL notifications. ${succeeded} submitted successfully, ${failed} failed.`,
    },
  };
}
