/**
 * Token generation, hashing, and the vault cipher for the OAuth subsystem.
 *
 * MCP tokens are opaque random strings stored only as SHA-256 hashes, so a
 * leaked database does not leak usable credentials. Google refresh tokens
 * must be recoverable (they are presented to Google), so they are encrypted
 * with AES-256-GCM under a key that lives in a file beside the database —
 * never in the database itself, and never in the repository.
 *
 * Losing the vault key is survivable but never silent: the server refuses to
 * start with a key that does not match the database unless the operator says so
 * (GSC_ALLOW_NEW_VAULT_KEY=1), after which every user signs in once more and
 * Google issues fresh refresh tokens.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Unguessable, URL-safe token with a greppable prefix (e.g. mcp_at_...). */
export function newToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/** Storage form of any secret we only ever need to compare, not recover. */
export function sha256hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface VaultKeyOptions {
  /**
   * Ciphertexts already vaulted under SOME key (a sample is enough). Supplied
   * by the caller so this module stays free of database types.
   *
   * It exists because the key file is the one thing that can silently change
   * under a populated database: a restore that forgets the key, a wiped volume,
   * a wrong mount. Generating a fresh key in that situation used to succeed and
   * report healthy, leaving every stored Google token permanently undecryptable
   * and, worse, a database encrypted under two different keys once anyone
   * reconnected before the operator noticed.
   */
  sampleCiphertexts?: () => string[];
  /**
   * Explicit operator consent to proceed with a key that does not match the
   * vaulted data (or to replace a corrupt key file). The caller then erases the
   * connections that can no longer be read, so the NEXT start needs no flag.
   */
  allowReplacement?: boolean;
}

/** True when the ciphertext decrypts under the key. */
export function canDecrypt(key: Buffer, ciphertext: string): boolean {
  try {
    vaultDecrypt(key, ciphertext);
    return true;
  } catch {
    return false;
  }
}

const REPLACEMENT_HINT =
  "If the old key is truly gone, start once with GSC_ALLOW_NEW_VAULT_KEY=1: " +
  "a new key is created, every stored Google connection that can no longer be read is erased, " +
  "and each user reconnects once. Then remove the flag.";

/**
 * Reads the vault key, creating it (0600, in a 0700 directory) on first run.
 *
 * FAILS CLOSED. A missing key beside a database that already holds vaulted
 * tokens, or a key that decrypts none of them, is an incident to surface, not a
 * condition to paper over with a new key.
 */
export function loadOrCreateVaultKey(keyPath: string, opts: VaultKeyOptions = {}): Buffer {
  const samples = opts.sampleCiphertexts?.() ?? [];
  const allow = opts.allowReplacement === true;

  // statSync, not lstat: a key provided through a symlink (a Kubernetes secret
  // volume, a /etc -> /var layout) is legitimate. What must be a regular file is
  // the thing the link points at.
  let st: fs.Stats | null = null;
  try {
    st = fs.statSync(keyPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (st && !st.isFile()) {
    throw new Error(`Vault key at ${keyPath} is not a regular file (it is a directory or device); refusing to use it.`);
  }

  if (st) {
    // If a restore, a copy or a careless umask left the key readable by others,
    // repair it: the key is the one secret that turns a copied database into
    // plaintext tokens. But never let a file we cannot chmod (read-only mount,
    // another owner) stop the server from starting; say so instead.
    if ((st.mode & 0o077) !== 0) {
      try {
        fs.chmodSync(keyPath, 0o600);
        console.error(`[vault] tightened permissions on ${keyPath} to 0600 (it was ${(st.mode & 0o777).toString(8)})`);
      } catch (err: unknown) {
        console.error(`[vault] WARNING: ${keyPath} is readable by other accounts (mode ${(st.mode & 0o777).toString(8)}) and could not be tightened: ${(err as Error).message}`);
      }
    }
    const raw = fs.readFileSync(keyPath, "utf8").trim();
    const key = Buffer.from(raw, "hex");
    if (key.length === 32) {
      if (samples.length > 0 && !samples.some((c) => canDecrypt(key, c))) {
        if (!allow) {
          throw new Error(
            `The vault key at ${keyPath} does not decrypt any of the ${samples.length} stored Google token(s) sampled. ` +
            `This is the wrong key for this database (a restore without the matching key, or a replaced volume). ` +
            `Starting would leave every user unable to use the server. Restore the key that matches the database. ${REPLACEMENT_HINT}`
          );
        }
        console.error("[vault] GSC_ALLOW_NEW_VAULT_KEY=1: continuing with a key that matches no stored token; unreadable connections will be erased.");
      }
      return key;
    }
    // Malformed (truncated by a full disk, hand-edited). Replacing it is the
    // operator's explicit call, and the flag is how they make it.
    if (!allow) {
      throw new Error(
        `Vault key at ${keyPath} is not a 64-character hex string. Restore it from your backup, or, if it is truly gone, ` +
        `${REPLACEMENT_HINT} (The corrupt file is moved aside, not deleted.)`
      );
    }
    const aside = `${keyPath}.invalid-${Date.now()}`;
    fs.renameSync(keyPath, aside);
    console.error(`[vault] GSC_ALLOW_NEW_VAULT_KEY=1: the key at ${keyPath} was not valid; moved it to ${aside}.`);
    // fall through and create a fresh one
  }

  if (samples.length > 0 && !allow) {
    throw new Error(
      `No vault key at ${keyPath}, but the database already holds ${samples.length > 1 ? "vaulted Google tokens" : "a vaulted Google token"}. ` +
      `Creating a new key now would make every stored token permanently undecryptable while the server reports healthy. ` +
      `Restore the original key file to ${keyPath}. ${REPLACEMENT_HINT}`
    );
  }

  const key = randomBytes(32);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  // "wx": never overwrite and never follow a planted symlink; two processes
  // racing to create the key cannot both succeed with different values.
  fs.writeFileSync(keyPath, key.toString("hex") + "\n", { mode: 0o600, flag: "wx" });
  console.error(`[vault] created new encryption key at ${keyPath}`);
  return key;
}

/** v1:<iv>:<tag>:<ciphertext>, all base64url. */
export function vaultEncrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

export function vaultDecrypt(key: Buffer, stored: string): string {
  const [version, ivB64, tagB64, ctB64] = stored.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Vault entry has an unknown format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}
