/**
 * SQLite storage for the OAuth subsystem, via node:sqlite — no native
 * dependencies, one file on the data volume, WAL mode for concurrent reads.
 *
 * Only the OAuth server path imports this module, so stdio mode keeps working
 * on Node 18 even though node:sqlite needs a newer runtime. The HTTP entry
 * translates a missing builtin into a clear "OAuth mode needs Node 24+" error.
 */
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export type AuthDb = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

-- One Google identity per user; the refresh token is vault-encrypted.
CREATE TABLE IF NOT EXISTS google_tokens (
  user_id            TEXT PRIMARY KEY REFERENCES users(id),
  refresh_token_enc  TEXT NOT NULL,
  scope              TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',   -- active | revoked
  updated_at         INTEGER NOT NULL
);

-- Dynamically registered MCP clients (claude.ai, Claude Code, Inspector...).
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id   TEXT PRIMARY KEY,
  data        TEXT NOT NULL,          -- full registration JSON
  created_at  INTEGER NOT NULL
);

-- An /authorize request parked while the person is at Google's consent screen.
CREATE TABLE IF NOT EXISTS pending_authorizations (
  id              TEXT PRIMARY KEY,   -- names the row on the consent page
  -- Independent random value handed to Google as the OAuth state. Deliberately NOT the
  -- id: when it was, possessing the id was enough to complete someone else's
  -- Google leg, which is how a victim's account could be bound to an
  -- attacker's client. See auth/browser-binding.ts.
  google_state    TEXT NOT NULL UNIQUE,
  -- SHA-256 of the cookie set on the /authorize response. Required at BOTH the
  -- consent POST and the Google callback, so a flow can only be advanced by
  -- the browser that started it.
  browser_hash    TEXT NOT NULL,
  client_id       TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  redirect_uri    TEXT NOT NULL,
  client_state    TEXT,
  scopes          TEXT NOT NULL,
  resource        TEXT,
  expires_at      INTEGER NOT NULL
);

-- Single-use authorization codes we mint after Google sign-in completes.
CREATE TABLE IF NOT EXISTS auth_codes (
  code_hash       TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  redirect_uri    TEXT NOT NULL,
  scopes          TEXT NOT NULL,
  resource        TEXT,
  expires_at      INTEGER NOT NULL,
  used            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS access_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  scopes      TEXT NOT NULL,
  resource    TEXT,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_tokens_user ON access_tokens(user_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  scopes      TEXT NOT NULL,
  resource    TEXT,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id           TEXT PRIMARY KEY REFERENCES users(id),
  default_property  TEXT
);
`;

/**
 * Brings an existing database up to the current schema.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
 * a deployment upgraded in place would keep the old `pending_authorizations`
 * and every sign-in would fail on the missing columns.
 *
 * That table is safe to rebuild rather than migrate: every row is an
 * in-progress sign-in with a ten-minute TTL, and it holds no durable state.
 * Anyone mid-flow at the moment of deploy sees "start the connection again",
 * which is the same thing a restart has always done to them. Nothing else in
 * the schema is touched, so users, vaulted Google tokens and live MCP tokens
 * all survive untouched.
 */
function migrate(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(pending_authorizations)").all() as { name: string }[];
  if (columns.length > 0 && !columns.some((c) => c.name === "google_state")) {
    db.exec("DROP TABLE pending_authorizations;");
    console.error("[db] rebuilt pending_authorizations for browser-bound authorization flows");
  }
}

export function openAuthDb(dbPath: string): AuthDb {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // Concurrent writers (the per-request last_seen_at update among them) should
  // wait briefly rather than fail outright with SQLITE_BUSY.
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  db.exec(SCHEMA);
  return db;
}
