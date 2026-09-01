/**
 * The Google half of the OAuth sandwich.
 *
 * The MCP server issues its own tokens to Claude clients; this module handles
 * the separate relationship with Google — sending the person to Google's
 * consent screen and exchanging the returned code for their identity and a
 * refresh token. Google credentials never leave the server, and Claude never
 * sees them.
 */
import * as fs from "node:fs";
import { google } from "googleapis";

/** What the hosted service asks Google for: identity + read-only GSC. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

export interface GoogleProfile {
  sub: string;
  email: string;
  refreshToken: string | null;
  grantedScopes: string;
}

/** The surface the provider depends on — tests substitute a fake. */
export interface GoogleIdentityLike {
  authUrl(state: string): string;
  exchange(code: string): Promise<GoogleProfile>;
  assertAllowed(email: string): void;
  clientId: string;
  clientSecret: string;
}

export interface GoogleIdentityOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Optional sign-in gates on top of Google's own Testing-mode test-user list. */
  allowedEmails?: string[];
  allowedDomains?: string[];
}

export class GoogleIdentity implements GoogleIdentityLike {
  readonly clientId: string;
  readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly allowedEmails: Set<string>;
  private readonly allowedDomains: Set<string>;

  constructor(opts: GoogleIdentityOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.redirectUri = opts.redirectUri;
    this.allowedEmails = new Set((opts.allowedEmails ?? []).map((e) => e.toLowerCase()));
    this.allowedDomains = new Set((opts.allowedDomains ?? []).map((d) => d.toLowerCase()));
  }

  private client() {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
  }

  authUrl(state: string): string {
    // prompt=consent guarantees a refresh token on every completed sign-in,
    // at the cost of always showing the consent screen. Always-correct beats
    // occasionally-broken for a flow a person runs once per device.
    return this.client().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_SCOPES,
      state,
    });
  }

  async exchange(code: string): Promise<GoogleProfile> {
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      throw new Error("Google returned no id_token; cannot establish who signed in.");
    }
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new Error("Google id_token carried no subject or email.");
    }
    if (payload.email_verified === false) {
      throw new Error("Google reports this email address as unverified.");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      refreshToken: tokens.refresh_token ?? null,
      grantedScopes: tokens.scope ?? "",
    };
  }

  assertAllowed(email: string): void {
    if (this.allowedEmails.size === 0 && this.allowedDomains.size === 0) return;
    const lower = email.toLowerCase();
    const domain = lower.split("@")[1] ?? "";
    if (this.allowedEmails.has(lower) || this.allowedDomains.has(domain)) return;
    throw new Error(
      `${email} is not on this server's allowlist. ` +
      `The operator controls access via GSC_ALLOWED_EMAILS / GSC_ALLOWED_EMAIL_DOMAINS.`
    );
  }
}

/**
 * Builds the identity config from the same credential sources the local mode
 * already uses: env pair first, then a client-secrets JSON (web or installed).
 * A production deployment needs a "Web application" client with the public
 * callback URL registered; local development can reuse a Desktop client,
 * because Google accepts loopback redirects for those without registration.
 */
export function googleIdentityFromEnv(publicUrl: string): GoogleIdentity {
  const redirectUri = new URL("/oauth/google/callback", publicUrl).toString();
  const allowedEmails = (process.env.GSC_ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowedDomains = (process.env.GSC_ALLOWED_EMAIL_DOMAINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const envId = process.env.GSC_GOOGLE_CLIENT_ID ?? process.env.GSC_OAUTH_CLIENT_ID;
  const envSecret = process.env.GSC_GOOGLE_CLIENT_SECRET ?? process.env.GSC_OAUTH_CLIENT_SECRET;
  if (envId && envSecret) {
    return new GoogleIdentity({ clientId: envId, clientSecret: envSecret, redirectUri, allowedEmails, allowedDomains });
  }

  const secretsFile = process.env.GSC_OAUTH_SECRETS_FILE;
  if (secretsFile && fs.existsSync(secretsFile)) {
    const raw = JSON.parse(fs.readFileSync(secretsFile, "utf8"));
    const creds = raw.web || raw.installed;
    if (creds?.client_id && creds?.client_secret) {
      return new GoogleIdentity({
        clientId: creds.client_id,
        clientSecret: creds.client_secret,
        redirectUri,
        allowedEmails,
        allowedDomains,
      });
    }
  }

  throw new Error(
    "OAuth mode needs a Google OAuth client: set GSC_GOOGLE_CLIENT_ID and GSC_GOOGLE_CLIENT_SECRET, " +
    "or point GSC_OAUTH_SECRETS_FILE at a client-secrets JSON. " +
    "For a public deployment create a 'Web application' client with the redirect URI " +
    `${new URL("/oauth/google/callback", publicUrl).toString()} registered.`
  );
}
