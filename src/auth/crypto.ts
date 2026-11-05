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
   * vaulted data. Every affected user is then asked to reconnect.
   */
  allowReplacement?: boolean;
}

/** True when the ciphertext decrypts under the key. */
function decryptsUnder(key: Buffer, ciphertext: string): boolean {
  try {
    vaultDecrypt(key, ciphertext);
    return true;
  } catch {
    return false;
  }
}

const REPLACEMENT_HINT =
  "If the old key is truly gone, set GSC_ALLOW_NEW_VAULT_KEY=1 for one start: " +
  "every user will then reconnect once and Google issues fresh refresh tokens.";

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

  if (fs.existsSync(keyPath)) {
    const st = fs.lstatSync(keyPath);
    if (!st.isFile()) {
      throw new Error(`Vault key at ${keyPath} is not a regular file (symlink, directory or device); refusing to use it.`);
    }
    // We own this file. If a restore, a copy or a careless umask left it
    // readable by others, repair it rather than trust the environment: the key
    // is the one secret that turns a copied database into plaintext tokens.
    if ((st.mode & 0o077) !== 0) {
      fs.chmodSync(keyPath, 0o600);
      console.error(`[vault] tightened permissions on ${keyPath} to 0600 (it was ${(st.mode & 0o777).toString(8)})`);
    }
    const raw = fs.readFileSync(keyPath, "utf8").trim();
    const key = Buffer.from(raw, "hex");
    if (key.length !== 32) {
      throw new Error(
        `Vault key at ${keyPath} is not a 64-character hex string. ` +
        `If it was corrupted, restore it from your backup. ${REPLACEMENT_HINT}`
      );
    }
    if (samples.length > 0 && !samples.some((c) => decryptsUnder(key, c))) {
      if (!allow) {
        throw new Error(
          `The vault key at ${keyPath} does not decrypt any of the ${samples.length} stored Google token(s) sampled. ` +
          `This is the wrong key for this database (a restore without the matching key, or a replaced volume). ` +
          `Starting would leave every user unable to use the server. Restore the key that matches the database. ${REPLACEMENT_HINT}`
        );
      }
      console.error("[vault] GSC_ALLOW_NEW_VAULT_KEY=1: continuing with a key that matches no stored token; affected users will be asked to reconnect.");
    }
    return key;
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
