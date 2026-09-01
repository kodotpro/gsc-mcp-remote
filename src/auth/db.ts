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
  id              TEXT PRIMARY KEY,   -- the state we send to Google
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

export function openAuthDb(dbPath: string): AuthDb {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}
