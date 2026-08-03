import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal in-memory stand-in for the settings table — encryptSecret/decryptSecret only
// ever read/write the single _encryptionFallbackKey row through these two functions.
const store = new Map<string, unknown>();
vi.mock("../db/settingsStore", () => ({
  getSetting: (name: string, defaultValue: unknown) => (store.has(name) ? store.get(name) : defaultValue),
  setSetting: (name: string, value: unknown) => {
    store.set(name, value);
  },
}));

import { decryptSecret, encryptSecret } from "./secretStorage";

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("encryptSecret / decryptSecret round trip", () => {
  it("decrypts back to the original plaintext", () => {
    const encrypted = encryptSecret("sk-super-secret-key");
    expect(decryptSecret(encrypted)).toBe("sk-super-secret-key");
  });

  it("round-trips an empty string", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("generates the encryption key once and reuses it across calls", () => {
    const first = encryptSecret("a");
    const second = encryptSecret("b");
    // Different values (fresh IV each time) but both decrypt correctly under the same key,
    // proving getEncryptionKey() persisted rather than regenerating per call.
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe("a");
    expect(decryptSecret(second)).toBe("b");
  });

  it("produces a different ciphertext each time (fresh IV per call)", () => {
    const a = encryptSecret("same-plaintext");
    const b = encryptSecret("same-plaintext");
    expect(a).not.toBe(b);
  });
});

describe("the nodeCrypto: prefix contract", () => {
  it("prefixes every encrypted value with nodeCrypto: and three base64 segments", () => {
    const encrypted = encryptSecret("value");
    const parts = encrypted.split(":");
    expect(parts[0]).toBe("nodeCrypto");
    expect(parts).toHaveLength(4); // nodeCrypto, iv, authTag, ciphertext
  });
});

describe("legacy plaintext passthrough", () => {
  it("returns a value with no nodeCrypto: prefix unchanged", () => {
    expect(decryptSecret("plain-legacy-value")).toBe("plain-legacy-value");
  });

  it("does not require getEncryptionKey to have ever been called for a legacy value", () => {
    // No encryptSecret call happened in this test, so the key setting was never touched —
    // decryptSecret on a legacy value must not need it.
    expect(store.has("_encryptionFallbackKey")).toBe(false);
    expect(decryptSecret("un-encrypted")).toBe("un-encrypted");
    expect(store.has("_encryptionFallbackKey")).toBe(false);
  });
});

// KI-18: a stored value prefixed nodeCrypto: that fails GCM authentication (corrupted,
// truncated, or encrypted under a key that no longer matches) used to throw node:crypto's
// raw "Unsupported state or unable to authenticate data" straight out of decryptSecret,
// with no caller wrapping it.
describe("decryptSecret failure path", () => {
  it("throws a clear error instead of a raw crypto exception when the auth tag doesn't match", () => {
    const encrypted = encryptSecret("value");
    const [prefix, iv, authTag, data] = encrypted.split(":");
    // Flip the ciphertext so GCM authentication fails on decrypt.
    const tampered = [prefix, iv, authTag, Buffer.from(data, "base64").reverse().toString("base64")].join(":");

    expect(() => decryptSecret(tampered)).toThrow(/corrupted or the encryption key has changed/);
  });

  it("throws the same clear error for a truncated/malformed nodeCrypto: value", () => {
    expect(() => decryptSecret("nodeCrypto:not-valid-base64-segments")).toThrow(
      /corrupted or the encryption key has changed/
    );
  });
});
