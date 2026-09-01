/**
 * Token generation, hashing, and the vault cipher for the OAuth subsystem.
 *
 * MCP tokens are opaque random strings stored only as SHA-256 hashes, so a
 * leaked database does not leak usable credentials. Google refresh tokens
 * must be recoverable (they are presented to Google), so they are encrypted
 * with AES-256-GCM under a key that lives in a file beside the database —
 * never in the database itself, and never in the repository.
 *
 * Losing the vault key is survivable by design: every user just signs in
 * again, and Google issues fresh refresh tokens.
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

/**
 * Reads the vault key, creating it (0600, in a 0700 directory) on first run.
 */
export function loadOrCreateVaultKey(keyPath: string): Buffer {
  if (fs.existsSync(keyPath)) {
    const raw = fs.readFileSync(keyPath, "utf8").trim();
    const key = Buffer.from(raw, "hex");
    if (key.length !== 32) {
      throw new Error(
        `Vault key at ${keyPath} is not a 64-character hex string. ` +
        `If it was corrupted, delete the file: a new key is generated on restart, and every user simply reconnects.`
      );
    }
    return key;
  }
  const key = randomBytes(32);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyPath, key.toString("hex") + "\n", { mode: 0o600 });
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
