/**
 * The OAuth authorization-server role, implementing the SDK's
 * OAuthServerProvider contract on SQLite.
 *
 * Shape of the flow ("the sandwich"): a Claude client registers via DCR and
 * starts /authorize; we park that request and send the person to Google's
 * consent screen; Google returns identity + a refresh token, which goes into
 * the vault; we mint OUR one-time code back to the client, which exchanges it
 * (PKCE-verified by the SDK's token handler) for OUR opaque tokens. Google
 * credentials never reach the client; MCP tokens never reach Google.
 *
 * Token discipline: everything we issue is random and stored only as a
 * SHA-256 hash. Access tokens live 1 hour; refresh tokens live 30 days and
 * ROTATE on every use — presenting an already-rotated refresh token is
 * treated as theft and revokes every token the user has on that client.
 */
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError, InvalidTokenError, InvalidTargetError, AccessDeniedError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

import type { AuthDb } from "./db.js";
import { newToken, sha256hex, vaultEncrypt, vaultDecrypt } from "./crypto.js";
import type { GoogleIdentityLike } from "./google-identity.js";

const ACCESS_TTL_MS = 60 * 60 * 1000;            // 1 hour
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CODE_TTL_MS = 60 * 1000;                   // 1 minute
const PENDING_TTL_MS = 10 * 60 * 1000;           // consent-screen dwell time

/** The one scope this server issues; requests are normalised onto it. */
export const MCP_SCOPE = "gsc:read";

export interface GscOAuthProviderOptions {
  db: AuthDb;
  vaultKey: Buffer;
  identity: GoogleIdentityLike;
  /** Canonical resource identifier tokens are bound to, e.g. https://gsc.k-o.pro/mcp */
  resourceUrl: string;
}

export class GscOAuthProvider implements OAuthServerProvider {
  private readonly db: AuthDb;
  private readonly vaultKey: Buffer;
  private readonly identity: GoogleIdentityLike;
  private readonly resourceUrl: string;

  constructor(opts: GscOAuthProviderOptions) {
    this.db = opts.db;
    this.vaultKey = opts.vaultKey;
    this.identity = opts.identity;
    // Normalise: no trailing slash, no hash — RFC 8707 comparisons are exact.
    this.resourceUrl = opts.resourceUrl.replace(/[#?].*$/, "").replace(/\/+$/, "");
  }

  // ---- client registrations (DCR) ----------------------------------------

  get clientsStore(): OAuthRegisteredClientsStore {
    const db = this.db;
    return {
      getClient(clientId: string): OAuthClientInformationFull | undefined {
        const row = db.prepare("SELECT data FROM oauth_clients WHERE client_id = ?").get(clientId) as { data: string } | undefined;
        return row ? (JSON.parse(row.data) as OAuthClientInformationFull) : undefined;
      },
      registerClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
        db.prepare("INSERT OR REPLACE INTO oauth_clients (client_id, data, created_at) VALUES (?, ?, ?)")
          .run(client.client_id, JSON.stringify(client), Date.now());
        return client;
      },
    };
  }

  // ---- the sandwich -------------------------------------------------------

  /** Parks the client's request and forwards the human to Google. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const pendingId = newToken("pend");
    this.db.prepare(
      `INSERT INTO pending_authorizations
         (id, client_id, code_challenge, redirect_uri, client_state, scopes, resource, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      pendingId,
      client.client_id,
      params.codeChallenge,
      params.redirectUri,
      params.state ?? null,
      MCP_SCOPE,
      params.resource ? params.resource.toString() : null,
      Date.now() + PENDING_TTL_MS
    );
    res.redirect(this.identity.authUrl(pendingId));
  }

  /**
   * Google callback: turns a completed consent into a user record, a vault
   * entry, and a one-time authorization code for the waiting client.
   * Returns the URL to send the browser back to.
   */
  async completeGoogleSignIn(state: string, googleCode: string): Promise<string> {
    const pending = this.db.prepare(
      "SELECT * FROM pending_authorizations WHERE id = ?"
    ).get(state) as
      | { id: string; client_id: string; code_challenge: string; redirect_uri: string; client_state: string | null; scopes: string; resource: string | null; expires_at: number }
      | undefined;

    // Single-use regardless of outcome.
    this.db.prepare("DELETE FROM pending_authorizations WHERE id = ?").run(state);

    if (!pending || pending.expires_at < Date.now()) {
      throw new AccessDeniedError("This sign-in link expired or was already used. Start the connection again from your Claude client.");
    }

    const profile = await this.identity.exchange(googleCode);
    this.identity.assertAllowed(profile.email);

    const now = Date.now();
    let user = this.db.prepare("SELECT id FROM users WHERE google_sub = ?").get(profile.sub) as { id: string } | undefined;
    if (!user) {
      user = { id: randomUUID() };
      this.db.prepare(
        "INSERT INTO users (id, google_sub, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
      ).run(user.id, profile.sub, profile.email, now, now);
    } else {
      this.db.prepare("UPDATE users SET email = ?, last_seen_at = ? WHERE id = ?").run(profile.email, now, user.id);
    }

    if (profile.refreshToken) {
      this.db.prepare(
        `INSERT INTO google_tokens (user_id, refresh_token_enc, scope, status, updated_at)
         VALUES (?, ?, ?, 'active', ?)
         ON CONFLICT(user_id) DO UPDATE SET
           refresh_token_enc = excluded.refresh_token_enc,
           scope = excluded.scope, status = 'active', updated_at = excluded.updated_at`
      ).run(user.id, vaultEncrypt(this.vaultKey, profile.refreshToken), profile.grantedScopes, now);
    } else {
      // prompt=consent should always yield one; guard the rare gap anyway.
      const existing = this.db.prepare(
        "SELECT status FROM google_tokens WHERE user_id = ?"
      ).get(user.id) as { status: string } | undefined;
      if (!existing || existing.status !== "active") {
        throw new AccessDeniedError(
          "Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and connect again."
        );
      }
    }

    const code = newToken("mcp_code");
    this.db.prepare(
      `INSERT INTO auth_codes (code_hash, client_id, user_id, code_challenge, redirect_uri, scopes, resource, expires_at, used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(sha256hex(code), pending.client_id, user.id, pending.code_challenge, pending.redirect_uri, pending.scopes, pending.resource, now + CODE_TTL_MS);

    const redirect = new URL(pending.redirect_uri);
    redirect.searchParams.set("code", code);
    if (pending.client_state) redirect.searchParams.set("state", pending.client_state);
    return redirect.toString();
  }

  // ---- code + token exchange ----------------------------------------------

  /** The SDK's token handler verifies PKCE against this value itself. */
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const row = this.db.prepare(
      "SELECT code_challenge FROM auth_codes WHERE code_hash = ? AND client_id = ? AND used = 0 AND expires_at > ?"
    ).get(sha256hex(authorizationCode), client.client_id, Date.now()) as { code_challenge: string } | undefined;
    if (!row) throw new InvalidGrantError("Authorization code is invalid, expired, or already used.");
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const hash = sha256hex(authorizationCode);
    const row = this.db.prepare(
      "SELECT * FROM auth_codes WHERE code_hash = ? AND client_id = ? AND used = 0 AND expires_at > ?"
    ).get(hash, client.client_id, Date.now()) as
      | { user_id: string; redirect_uri: string; scopes: string; resource: string | null }
      | undefined;
    if (!row) throw new InvalidGrantError("Authorization code is invalid, expired, or already used.");

    if (redirectUri && redirectUri !== row.redirect_uri) {
      throw new InvalidGrantError("redirect_uri does not match the one this code was issued for.");
    }
    // If the client names a resource at exchange time, it must be the one the
    // code was issued for. (When it names none, the stored binding governs and
    // verifyAccessToken enforces it on every request.)
    const requested = resource ? resource.toString().replace(/[#?].*$/, "").replace(/\/+$/, "") : null;
    if (requested !== null && requested !== (row.resource ?? null)) {
      throw new InvalidTargetError("resource does not match the one this code was issued for.");
    }

    this.db.prepare("UPDATE auth_codes SET used = 1 WHERE code_hash = ?").run(hash);
    return this.issueTokens(row.user_id, client.client_id, row.scopes, row.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    _resource?: URL
  ): Promise<OAuthTokens> {
    const hash = sha256hex(refreshToken);
    const row = this.db.prepare(
      "SELECT * FROM refresh_tokens WHERE token_hash = ? AND client_id = ?"
    ).get(hash, client.client_id) as
      | { user_id: string; scopes: string; resource: string | null; expires_at: number; revoked: number }
      | undefined;

    if (!row) throw new InvalidGrantError("Unknown refresh token.");

    // A rotated-out token coming back means it leaked: burn everything this
    // user has on this client, forcing a fresh sign-in.
    if (row.revoked) {
      this.revokeClientTokensForUser(row.user_id, client.client_id);
      throw new InvalidGrantError("Refresh token was already rotated; all sessions for this client were revoked as a precaution.");
    }
    if (row.expires_at < Date.now()) {
      throw new InvalidGrantError("Refresh token expired; sign in again.");
    }

    this.db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?").run(hash);
    return this.issueTokens(row.user_id, client.client_id, row.scopes, row.resource);
  }

  private issueTokens(userId: string, clientId: string, scopes: string, resource: string | null): OAuthTokens {
    const now = Date.now();
    const accessToken = newToken("mcp_at");
    const refreshToken = newToken("mcp_rt");
    this.db.prepare(
      "INSERT INTO access_tokens (token_hash, user_id, client_id, scopes, resource, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(sha256hex(accessToken), userId, clientId, scopes, resource, now + ACCESS_TTL_MS, now);
    this.db.prepare(
      "INSERT INTO refresh_tokens (token_hash, user_id, client_id, scopes, resource, expires_at, created_at, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)"
    ).run(sha256hex(refreshToken), userId, clientId, scopes, resource, now + REFRESH_TTL_MS, now);

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: scopes,
    };
  }

  // ---- request-time verification -------------------------------------------

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = this.db.prepare(
      "SELECT * FROM access_tokens WHERE token_hash = ?"
    ).get(sha256hex(token)) as
      | { user_id: string; client_id: string; scopes: string; resource: string | null; expires_at: number }
      | undefined;

    if (!row || row.expires_at < Date.now()) {
      throw new InvalidTokenError("Access token is invalid or expired.");
    }
    // RFC 8707 audience binding: a token minted for another resource is not
    // valid here, even if it somehow shares our database.
    if (row.resource && row.resource !== this.resourceUrl) {
      throw new InvalidTokenError("Access token was issued for a different resource.");
    }

    const user = this.db.prepare("SELECT email FROM users WHERE id = ?").get(row.user_id) as { email: string } | undefined;
    this.db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(Date.now(), row.user_id);

    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes.split(" "),
      expiresAt: Math.floor(row.expires_at / 1000),
      resource: row.resource ? new URL(row.resource) : undefined,
      extra: { userId: row.user_id, email: user?.email },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const hash = sha256hex(request.token);
    this.db.prepare("DELETE FROM access_tokens WHERE token_hash = ? AND client_id = ?").run(hash, client.client_id);
    this.db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ? AND client_id = ?").run(hash, client.client_id);
  }

  // ---- Google-credential plumbing used by the per-user client factory ------

  getGoogleRefreshToken(userId: string): string {
    const row = this.db.prepare(
      "SELECT refresh_token_enc, status FROM google_tokens WHERE user_id = ?"
    ).get(userId) as { refresh_token_enc: string; status: string } | undefined;
    if (!row || row.status !== "active") {
      throw new Error("No active Google connection for this user; reconnect from your Claude client.");
    }
    return vaultDecrypt(this.vaultKey, row.refresh_token_enc);
  }

  /**
   * The invalid_grant cascade: Google says the refresh token is dead (revoked
   * at myaccount.google.com, password change, expiry), so every MCP token dies
   * with it. The next request 401s and Claude re-runs the connect flow on its
   * own — recovery is self-service by construction.
   */
  markGoogleRevoked(userId: string): void {
    this.db.prepare("UPDATE google_tokens SET status = 'revoked', updated_at = ? WHERE user_id = ?").run(Date.now(), userId);
    this.db.prepare("DELETE FROM access_tokens WHERE user_id = ?").run(userId);
    this.db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?").run(userId);
  }

  private revokeClientTokensForUser(userId: string, clientId: string): void {
    this.db.prepare("DELETE FROM access_tokens WHERE user_id = ? AND client_id = ?").run(userId, clientId);
    this.db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?").run(userId, clientId);
  }

  // ---- per-user settings -----------------------------------------------------

  getDefaultProperty(userId: string): string | undefined {
    const row = this.db.prepare("SELECT default_property FROM user_settings WHERE user_id = ?").get(userId) as { default_property: string | null } | undefined;
    return row?.default_property ?? undefined;
  }

  setDefaultProperty(userId: string, property: string): void {
    this.db.prepare(
      "INSERT INTO user_settings (user_id, default_property) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET default_property = excluded.default_property"
    ).run(userId, property);
  }

  /** Housekeeping, called from the HTTP layer's sweeper. */
  cleanupExpired(): void {
    const now = Date.now();
    this.db.prepare("DELETE FROM pending_authorizations WHERE expires_at < ?").run(now);
    this.db.prepare("DELETE FROM auth_codes WHERE expires_at < ?").run(now);
    this.db.prepare("DELETE FROM access_tokens WHERE expires_at < ?").run(now);
    this.db.prepare("DELETE FROM refresh_tokens WHERE expires_at < ?").run(now);
  }
}
