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

/**
 * Makes the database files private to this user.
 *
 * SQLite creates the database and its -wal/-shm companions with the process
 * umask, so a deployment whose directory was pre-created by hand (the
 * self-hosting runbook did this) ended up with 0644 files that any other local
 * account could read: user emails, token hashes and registered clients' secrets.
 * Tighten what already exists; the umask set at startup covers what SQLite
 * creates later.
 *
 * The DIRECTORY is deliberately left alone. It may be shared (an operator can
 * point GSC_OAUTH_DB_FILE anywhere), and 0600 files cannot be read through a
 * traversable directory.
 */
function lockDownDataFiles(dbPath: string): void {
  const attempts: [string, number][] = [
    [dbPath, 0o600],
    [`${dbPath}-wal`, 0o600],
    [`${dbPath}-shm`, 0o600],
  ];
  for (const [target, mode] of attempts) {
    try {
      const current = fs.statSync(target).mode & 0o777;
      if ((current & ~mode) !== 0) {
        fs.chmodSync(target, mode);
        console.error(`[db] tightened permissions on ${target} from ${current.toString(8)} to ${mode.toString(8)}`);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") continue;
      // Not ours to change (different owner). Say so loudly instead of crashing
      // a server that may be otherwise fine: the operator must fix ownership.
      console.error(`[db] WARNING: could not restrict permissions on ${target}: ${(err as Error).message}`);
    }
  }
}

export function openAuthDb(dbPath: string): AuthDb {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  lockDownDataFiles(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // Concurrent writers (the per-request last_seen_at update among them) should
  // wait briefly rather than fail outright with SQLITE_BUSY.
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  db.exec(SCHEMA);
  // The -wal/-shm files exist now; make sure they inherit the same privacy.
  lockDownDataFiles(dbPath);
  return db;
}

/**
 * A sample of vaulted refresh-token ciphertexts, used at boot to prove the vault
 * key still matches the data (see loadOrCreateVaultKey).
 */
export function sampleVaultedCiphertexts(db: AuthDb, limit = 500): string[] {
  const rows = db.prepare(
    "SELECT refresh_token_enc FROM google_tokens WHERE refresh_token_enc <> '' LIMIT ?"
  ).all(limit) as { refresh_token_enc: string }[];
  return rows.map((r) => r.refresh_token_enc);
}

/**
 * After the operator accepts a replacement key (GSC_ALLOW_NEW_VAULT_KEY=1), the
 * rows the new key cannot open are dead weight AND a trap: left in place they
 * would make the next start without the flag refuse to boot (none of the sampled
 * rows decrypt) even though the key is now right. So they are erased here, with
 * the same cascade as a revoked Google grant, and each affected user's client
 * re-runs sign-in on its next request. Returns how many users were affected.
 */
export function retireUnreadableVaultRows(db: AuthDb, canDecrypt: (ciphertext: string) => boolean): number {
  const rows = db.prepare("SELECT user_id, refresh_token_enc FROM google_tokens WHERE refresh_token_enc <> ''").all() as {
    user_id: string;
    refresh_token_enc: string;
  }[];
  let retired = 0;
  for (const row of rows) {
    if (canDecrypt(row.refresh_token_enc)) continue;
    db.prepare("UPDATE google_tokens SET refresh_token_enc = '', status = 'revoked', updated_at = ? WHERE user_id = ?").run(Date.now(), row.user_id);
    db.prepare("DELETE FROM access_tokens WHERE user_id = ?").run(row.user_id);
    db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?").run(row.user_id);
    retired++;
  }
  return retired;
}
