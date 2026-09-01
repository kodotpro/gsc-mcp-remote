/**
 * Per-user Google API clients.
 *
 * Replaces the process-global `google.options({ auth })` model: each user gets
 * their own OAuth2 client seeded with their vault refresh token, so every
 * Search Console call runs as the person who asked — and Google's own property
 * permissions do the access control.
 *
 * The cache validates a credential once per fill by forcing a token refresh.
 * If Google answers invalid_grant (access revoked, password change), the
 * provider burns the user's MCP tokens too: the current request fails with a
 * clear message, the next one 401s, and the client re-runs the connect flow.
 */
import { google, searchconsole_v1 } from "googleapis";
import type { GscOAuthProvider } from "./provider.js";
import type { GoogleIdentityLike } from "./google-identity.js";

const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  sc: searchconsole_v1.Searchconsole;
  expiresAt: number;
}

export class UserClientFactory {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly provider: GscOAuthProvider,
    private readonly identity: GoogleIdentityLike
  ) {}

  async searchConsoleFor(userId: string): Promise<searchconsole_v1.Searchconsole> {
    const hit = this.cache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.sc;

    const refreshToken = this.provider.getGoogleRefreshToken(userId);
    const auth = new google.auth.OAuth2(this.identity.clientId, this.identity.clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });

    try {
      await auth.getAccessToken(); // one refresh per cache fill validates the credential
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("invalid_grant")) {
        this.provider.markGoogleRevoked(userId);
        this.cache.delete(userId);
        throw new Error(
          "Google has revoked this connection (access removed, password changed, or token expired). " +
          "Reconnect from your Claude client to sign in again."
        );
      }
      throw err;
    }

    const sc = google.searchconsole({ version: "v1", auth });
    this.cache.set(userId, { sc, expiresAt: Date.now() + CACHE_TTL_MS });
    return sc;
  }

  evict(userId: string): void {
    this.cache.delete(userId);
  }
}
