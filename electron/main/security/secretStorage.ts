import crypto from "node:crypto";
import { getSetting, setSetting } from "../db/settingsStore";

const ENCRYPTION_KEY_NAME = "_encryptionFallbackKey";

/**
 * All secrets (chat/voice API keys, connector OAuth client id/secret, connector
 * credentials, MCP server env vars) are encrypted with AES-256-GCM using a key generated
 * once and stored in this app's own SQLite database — deliberately not Electron's
 * OS-backed safeStorage (Keychain/DPAPI/libsecret). The key lives next to the data it
 * protects, so this is obfuscation against casual inspection, not real protection against
 * anyone with access to this machine's files — an accepted tradeoff for this app.
 */
function getEncryptionKey(): Buffer {
  const existing = getSetting<string | null>(ENCRYPTION_KEY_NAME, null);
  if (existing) return Buffer.from(existing, "base64");
  const key = crypto.randomBytes(32);
  setSetting(ENCRYPTION_KEY_NAME, key.toString("base64"));
  return key;
}

export function encryptSecret(plainText: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `nodeCrypto:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (stored.startsWith("nodeCrypto:")) {
    const [, ivB64, authTagB64, dataB64] = stored.split(":");
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
    } catch {
      // GCM auth failure (corrupted/truncated value, or a key that no longer matches)
      // previously threw node:crypto's raw "Unsupported state or unable to authenticate
      // data" straight out of this function, with no caller wrapping it — surfacing as an
      // opaque crash rather than something the user could act on (reconnect the account,
      // re-enter the key).
      throw new Error("Failed to decrypt stored secret — it may be corrupted or the encryption key has changed.");
    }
  }
  return stored;
}
