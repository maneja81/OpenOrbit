import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

const MIGRATION_ID = "20260802231500";

/**
 * Rewinds a fully-migrated database to the state it was in *before* the providers migration, so
 * the seeding can be exercised against a database that looks like a real existing install.
 *
 * Migrations are selected by absence from the ledger, so removing the row is what makes this one
 * run again on the next `runMigrations` — the same mechanism the run-openorbit skill documents
 * for replaying a migration by hand.
 */
function rewindToBeforeProviders(db: Database.Database): void {
  db.exec("DROP TABLE IF EXISTS providers");
  db.prepare("DELETE FROM schema_migrations WHERE id = ?").run(MIGRATION_ID);
}

function setSetting(db: Database.Database, name: string, rawJson: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (setting_name, setting_value) VALUES (?, ?)").run(name, rawJson);
}

function seedLegacyInstall(db: Database.Database, opts: { url?: string; key?: string }): void {
  rewindToBeforeProviders(db);
  if (opts.url !== undefined) setSetting(db, "appSettings.chatApiUrl", JSON.stringify(opts.url));
  if (opts.key !== undefined) setSetting(db, "appSettings.chatApiKey", JSON.stringify(opts.key));
  runMigrations(db);
}

function providerRows(db: Database.Database) {
  return db.prepare("SELECT id, api_url, api_key FROM providers ORDER BY id").all() as {
    id: string;
    api_url: string;
    api_key: string;
  }[];
}

describe("the providers migration", () => {
  it("adds agents.provider_id defaulting to '' so existing agents inherit Chat", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare(
      "INSERT INTO agents (id, name, prompt, model, icon, tagline, description) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-1", "Agent", "prompt", "model", "icon", "", "");
    const agent = db.prepare("SELECT provider_id FROM agents WHERE id = ?").get("agent-1") as { provider_id: string };
    // '' is what makes this column inert on an existing install: nothing changes until a user
    // deliberately points an agent somewhere else.
    expect(agent.provider_id).toBe("");
    db.close();
  });

  it("seeds nothing on a fresh install", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    // A row here would make the Settings screen claim a provider is configured when the user has
    // never entered anything.
    expect(providerRows(db)).toEqual([]);
    db.close();
  });

  it("treats an install that never set a URL as OpenAI", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    // An empty chatApiUrl meant "use OpenAI's" everywhere in ai/provider.ts, so this is not a
    // guess — it is the behaviour the install already had.
    seedLegacyInstall(db, { url: "", key: "nodeCrypto:aaa:bbb:ccc" });
    expect(providerRows(db)).toEqual([{ id: "openai", api_url: "", api_key: "nodeCrypto:aaa:bbb:ccc" }]);
    db.close();
  });

  it.each([
    ["https://openrouter.ai/api/v1", "openrouter"],
    ["https://api.openai.com/v1", "openai"],
    ["https://api.anthropic.com/v1", "anthropic"],
  ])("recognises %s as %s", (url, expected) => {
    const db = new Database(":memory:");
    runMigrations(db);
    seedLegacyInstall(db, { url, key: "nodeCrypto:x:y:z" });
    expect(providerRows(db).map((r) => r.id)).toEqual([expected]);
    db.close();
  });

  it("keeps an unrecognised host as a local provider rather than dropping it", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    seedLegacyInstall(db, { url: "http://192.168.1.50:11434/v1", key: "nodeCrypto:x:y:z" });
    // A custom OpenAI-compatible host is exactly what `local` is for. Dropping the row would
    // silently disconnect a setup that was working a moment ago.
    expect(providerRows(db)).toEqual([
      { id: "local", api_url: "http://192.168.1.50:11434/v1", api_key: "nodeCrypto:x:y:z" },
    ]);
    db.close();
  });

  it("copies the key as ciphertext without decrypting it", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const ciphertext = "nodeCrypto:aXY=:dGFn:ZW5j";
    seedLegacyInstall(db, { url: "https://api.openai.com/v1", key: ciphertext });
    // Byte-identical. A decrypt/re-encrypt round trip would add a way for the migration to throw
    // — and a migration that throws takes the app's launch with it.
    expect(providerRows(db)[0].api_key).toBe(ciphertext);
    db.close();
  });

  it("leaves the legacy settings rows in place so a downgrade still finds them", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    seedLegacyInstall(db, { url: "https://api.openai.com/v1", key: "nodeCrypto:x:y:z" });
    const legacy = db
      .prepare("SELECT setting_value FROM settings WHERE setting_name = ?")
      .get("appSettings.chatApiKey") as { setting_value: string } | undefined;
    expect(legacy?.setting_value).toBe(JSON.stringify("nodeCrypto:x:y:z"));
    db.close();
  });

  it("survives a settings row holding something that is not JSON", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    rewindToBeforeProviders(db);
    // Rows written by older builds, or hand-edited, really are out there — jsonColumn.ts exists
    // for this. One of them must not abort the migration and with it the app's launch.
    setSetting(db, "appSettings.chatApiUrl", "{not json");
    setSetting(db, "appSettings.chatApiKey", JSON.stringify("nodeCrypto:x:y:z"));
    expect(() => runMigrations(db)).not.toThrow();
    // The unreadable URL is treated as absent, which lands it on the OpenAI default.
    expect(providerRows(db)).toEqual([{ id: "openai", api_url: "", api_key: "nodeCrypto:x:y:z" }]);
    db.close();
  });

  it("is idempotent — replaying it does not clobber an edited row", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    seedLegacyInstall(db, { url: "https://api.openai.com/v1", key: "nodeCrypto:original" });
    db.prepare("UPDATE providers SET api_key = ? WHERE id = ?").run("nodeCrypto:rotated", "openai");

    // Re-run without dropping the table: the ON CONFLICT DO NOTHING is what protects a key the
    // user has since changed.
    db.prepare("DELETE FROM schema_migrations WHERE id = ?").run(MIGRATION_ID);
    runMigrations(db);

    expect(providerRows(db)[0].api_key).toBe("nodeCrypto:rotated");
    db.close();
  });
});

vi.mock("../security/secretStorage", () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => {
    if (v === "enc:BOOM") throw new Error("keychain locked");
    return v.replace(/^enc:/, "");
  },
}));

vi.mock("../devLog", () => ({ devLog: () => {} }));

let db: Database.Database;
vi.mock("./index", () => ({
  getDb: () => db,
}));

import {
  deleteProvider,
  getProviderCredentials,
  isProviderConfigured,
  listVisibleProviders,
  saveProvider,
} from "./providersStore";

describe("providersStore", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("creates a row on first save and encrypts the key", () => {
    saveProvider("openai", { apiUrl: "https://api.openai.com/v1", apiKey: "sk-secret" });
    const stored = db.prepare("SELECT api_key FROM providers WHERE id = ?").get("openai") as { api_key: string };
    // The plaintext must not be what lands on disk.
    expect(stored.api_key).toBe("enc:sk-secret");
    expect(getProviderCredentials("openai")).toEqual({ apiUrl: "https://api.openai.com/v1", apiKey: "sk-secret" });
  });

  it("never exposes a key value to the renderer", () => {
    saveProvider("openai", { apiUrl: "https://api.openai.com/v1", apiKey: "sk-secret" });
    const visible = listVisibleProviders();
    expect(visible).toEqual([{ id: "openai", apiUrl: "https://api.openai.com/v1", keySet: true }]);
    // Spelled out separately: the assertion above would still pass if a key field were added
    // alongside the ones listed, and this is the whole point of the shape.
    expect(JSON.stringify(visible)).not.toContain("sk-secret");
    expect(JSON.stringify(visible)).not.toContain("enc:");
  });

  it("leaves the stored key alone when a save omits it", () => {
    saveProvider("openai", { apiUrl: "https://api.openai.com/v1", apiKey: "sk-secret" });
    // What a URL-only edit sends, and what an untouched masked field sends on blur. If this
    // cleared the key, editing the URL would silently sign the user out of their provider.
    saveProvider("openai", { apiUrl: "https://proxy.example.com/v1" });
    expect(getProviderCredentials("openai")).toEqual({ apiUrl: "https://proxy.example.com/v1", apiKey: "sk-secret" });
  });

  it("clears the key on an explicit empty string", () => {
    saveProvider("openai", { apiUrl: "https://api.openai.com/v1", apiKey: "sk-secret" });
    saveProvider("openai", { apiKey: "" });
    // The only route to removing a key that isn't the Danger Zone's full database wipe.
    expect(getProviderCredentials("openai")).toEqual({ apiUrl: "https://api.openai.com/v1", apiKey: "" });
    expect(listVisibleProviders()[0].keySet).toBe(false);
  });

  it("reports a key that will not decrypt as still configured", () => {
    db.prepare("INSERT INTO providers (id, api_url, api_key) VALUES (?, ?, ?)").run("openai", "", "enc:BOOM");
    // Degrades instead of throwing — the renderer gates the whole app's render on this loading.
    expect(getProviderCredentials("openai")).toEqual({ apiUrl: "", apiKey: "" });
    // But it is still a configured row. Reporting it unset would invite the user to overwrite a
    // key that a keychain unlock would have recovered.
    expect(listVisibleProviders()[0].keySet).toBe(true);
    expect(isProviderConfigured("openai")).toBe(true);
  });

  it("returns null for a provider that was never configured", () => {
    expect(getProviderCredentials("anthropic")).toBeNull();
    expect(isProviderConfigured("anthropic")).toBe(false);
  });

  it("forgets a provider entirely on delete", () => {
    saveProvider("anthropic", { apiUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant" });
    deleteProvider("anthropic");
    expect(getProviderCredentials("anthropic")).toBeNull();
    expect(listVisibleProviders()).toEqual([]);
  });

  it("keeps providers independent of one another", () => {
    saveProvider("openai", { apiUrl: "https://api.openai.com/v1", apiKey: "sk-openai" });
    saveProvider("anthropic", { apiUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant" });
    saveProvider("openai", { apiKey: "" });
    // One provider's credentials must never be reachable through another's id — that would be a
    // key sent to a host the user didn't choose.
    expect(getProviderCredentials("anthropic")?.apiKey).toBe("sk-ant");
    expect(getProviderCredentials("openai")?.apiKey).toBe("");
  });
});
