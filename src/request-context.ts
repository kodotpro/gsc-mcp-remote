/**
 * Per-request user context, carried through AsyncLocalStorage.
 *
 * This is what makes 30 tools multi-user without rewriting them: the HTTP
 * layer wraps each request in runWithUserContext(), and the two functions
 * every tool already funnels through — getSearchConsoleClient() and
 * resolveSiteUrl() in auth.ts — consult the store before falling back to the
 * process-global, env-configured behaviour that stdio mode has always had.
 *
 * Propagation through the MCP transport into tool handlers, including under
 * concurrent requests, is verified by scripts/check-oauth.mjs (and was proven
 * against the real transport before this design was adopted).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { searchconsole_v1 } from "googleapis";

export interface UserContext {
  userId: string;
  email?: string;
  /**
   * Lazy on purpose: initialize/tools-list never touch Google, so a user whose
   * Google connection has died can still connect and get a clear error from
   * the first tool call instead of an opaque failure at handshake time.
   */
  getSearchConsole(): Promise<searchconsole_v1.Searchconsole>;
  settings: {
    getDefaultProperty(): string | undefined;
    setDefaultProperty(property: string): void;
  };
}

const als = new AsyncLocalStorage<UserContext>();

export function runWithUserContext<T>(ctx: UserContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getUserContext(): UserContext | undefined {
  return als.getStore();
}
