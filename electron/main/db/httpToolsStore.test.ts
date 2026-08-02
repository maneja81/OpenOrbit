import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

describe("migration 33 — http tool tables and agents.http_tool_collection_ids", () => {
  it("creates both tables and an agents column defaulting to '[]'", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare("INSERT INTO http_tool_collections (id, name, base_url) VALUES (?, ?, ?)").run(
      "jsonplaceholder",
      "JSONPlaceholder",
      "https://jsonplaceholder.typicode.com"
    );
    const collection = db.prepare("SELECT * FROM http_tool_collections WHERE id = ?").get("jsonplaceholder") as {
      enabled: number;
      allow_private_hosts: number;
      headers: string;
    };
    expect(collection.enabled).toBe(1);
    // Private/loopback hosts must be opt-in, never the default.
    expect(collection.allow_private_hosts).toBe(0);
    expect(collection.headers).toBe("{}");

    db.prepare(
      "INSERT INTO agents (id, name, prompt, model, icon, tagline, description) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-1", "Agent", "prompt", "model", "icon", "", "");
    const agent = db.prepare("SELECT http_tool_collection_ids FROM agents WHERE id = ?").get("agent-1") as {
      http_tool_collection_ids: string;
    };
    expect(agent.http_tool_collection_ids).toBe("[]");

    db.close();
  });

  it("cascades endpoint deletion when its collection is deleted", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    db.prepare("INSERT INTO http_tool_collections (id, name, base_url) VALUES (?, ?, ?)").run("c1", "C", "https://x.dev");
    db.prepare("INSERT INTO http_tools (id, collection_id, name, tool_name) VALUES (?, ?, ?, ?)").run(
      "t1",
      "c1",
      "Get Post",
      "get_post"
    );

    db.prepare("DELETE FROM http_tool_collections WHERE id = ?").run("c1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM http_tools").get()).toEqual({ n: 0 });

    db.close();
  });

  it("rejects two endpoints sharing one tool_name", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare("INSERT INTO http_tool_collections (id, name, base_url) VALUES (?, ?, ?)").run("c1", "C", "https://x.dev");
    db.prepare("INSERT INTO http_tools (id, collection_id, name, tool_name) VALUES (?, ?, ?, ?)").run(
      "t1",
      "c1",
      "Get Post",
      "get_post"
    );

    // The SDK resolves tools by name alone, so a duplicate would silently shadow the other.
    expect(() =>
      db
        .prepare("INSERT INTO http_tools (id, collection_id, name, tool_name) VALUES (?, ?, ?, ?)")
        .run("t2", "c1", "Get Post Again", "get_post")
    ).toThrow(/UNIQUE/i);

    db.close();
  });
});

describe("migration 34 — approval moved off the endpoint", () => {
  it("drops requires_confirmation, so nothing can gate per-endpoint any more", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const columns = (db.pragma("table_info(http_tools)") as { name: string }[]).map((c) => c.name);
    expect(columns).not.toContain("requires_confirmation");
    // The rest of the endpoint shape is untouched by the drop.
    expect(columns).toEqual(
      expect.arrayContaining(["id", "collection_id", "tool_name", "method", "path", "params", "enabled"])
    );

    db.close();
  });
});

vi.mock("../security/secretStorage", () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => v.replace(/^enc:/, ""),
}));

let db: Database.Database;
vi.mock("./index", () => ({
  getDb: () => db,
}));

import {
  createHttpTool,
  createHttpToolCollection,
  deleteHttpTool,
  deleteHttpToolCollection,
  getDecryptedCollectionHeaders,
  isWriteMethod,
  listHttpToolCollections,
  listHttpTools,
  parseHttpToolParams,
  updateHttpTool,
  updateHttpToolCollection,
} from "./httpToolsStore";

describe("httpToolsStore", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  const makeCollection = () =>
    createHttpToolCollection({
      name: "JSONPlaceholder",
      description: "Fake REST API",
      baseUrl: "https://jsonplaceholder.typicode.com",
      headers: { Authorization: "Bearer secret-token" },
    });

  it("encrypts header values at rest and decrypts them only on explicit request", () => {
    const collection = makeCollection();

    // Every header value goes through encryptSecret on the way in (mocked here as an
    // "enc:" prefix — the real one is AES-GCM, so this asserts the call, not the cipher)...
    expect(JSON.parse(collection.headers)).toEqual({ Authorization: "enc:Bearer secret-token" });
    // ...and the bulk list hands back that same stored form rather than decrypting.
    expect(JSON.parse(listHttpToolCollections()[0].headers)).toEqual({ Authorization: "enc:Bearer secret-token" });

    expect(getDecryptedCollectionHeaders(collection.id)).toEqual({ Authorization: "Bearer secret-token" });
  });

  it("derives a snake_case tool_name and keeps it unique across collections", () => {
    const a = makeCollection();
    const b = createHttpToolCollection({ name: "Other API", baseUrl: "https://other.dev" });

    const first = createHttpTool({ collectionId: a.id, name: "Get Post" });
    const second = createHttpTool({ collectionId: b.id, name: "Get Post" });

    expect(first.tool_name).toBe("get_post");
    expect(second.tool_name).toBe("get_post_2");
  });

  it("does not collide a renamed tool with its own existing name", () => {
    const collection = makeCollection();
    const tool = createHttpTool({ collectionId: collection.id, name: "Get Post" });

    // Saving other fields, or renaming to the same name, must not accumulate "_2" suffixes.
    const updated = updateHttpTool(tool.id, { name: "Get Post", description: "Fetch one post" });
    expect(updated.tool_name).toBe("get_post");

    const renamed = updateHttpTool(tool.id, { name: "Fetch Post" });
    expect(renamed.tool_name).toBe("fetch_post");
  });

  it("uppercases the method and stores params as JSON", () => {
    const collection = makeCollection();
    const tool = createHttpTool({
      collectionId: collection.id,
      name: "Create Post",
      method: "post",
      params: [{ name: "title", description: "Post title", type: "string", required: true, location: "body" }],
    });

    expect(tool.method).toBe("POST");
    expect(parseHttpToolParams(tool)).toEqual([
      { name: "title", description: "Post title", type: "string", required: true, location: "body" },
    ]);
  });

  it("rejects a blank name or base URL rather than silently keeping the old value", () => {
    const collection = makeCollection();
    expect(() => updateHttpToolCollection(collection.id, { name: "   " })).toThrow(/cannot be blank/i);
    expect(() => updateHttpToolCollection(collection.id, { baseUrl: "" })).toThrow(/cannot be blank/i);
    expect(() => createHttpToolCollection({ name: "", baseUrl: "https://x.dev" })).toThrow(/required/i);
  });

  it("refuses an endpoint pointed at a collection that does not exist", () => {
    expect(() => createHttpTool({ collectionId: "nope", name: "Get Post" })).toThrow(/Unknown HTTP tool collection/);
  });

  it("detaches a deleted collection from every agent that had it attached", () => {
    const collection = makeCollection();
    createHttpTool({ collectionId: collection.id, name: "Get Post" });

    db.prepare(
      "INSERT INTO agents (id, name, prompt, model, icon, tagline, description, http_tool_collection_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-1", "Agent", "p", "m", "i", "", "", JSON.stringify([collection.id, "other"]));

    deleteHttpToolCollection(collection.id);

    const agent = db.prepare("SELECT http_tool_collection_ids FROM agents WHERE id = ?").get("agent-1") as {
      http_tool_collection_ids: string;
    };
    // A dangling id would silently fail to attach on the next run instead of erroring.
    expect(JSON.parse(agent.http_tool_collection_ids)).toEqual(["other"]);
    expect(listHttpTools()).toHaveLength(0);
  });

  it("lists endpoints scoped to one collection", () => {
    const a = makeCollection();
    const b = createHttpToolCollection({ name: "Other API", baseUrl: "https://other.dev" });
    createHttpTool({ collectionId: a.id, name: "List Posts" });
    const doomed = createHttpTool({ collectionId: b.id, name: "List Users" });

    expect(listHttpTools(a.id).map((t) => t.name)).toEqual(["List Posts"]);
    deleteHttpTool(doomed.id);
    expect(listHttpTools(b.id)).toHaveLength(0);
  });

  it("treats a malformed params column as no parameters instead of throwing", () => {
    expect(parseHttpToolParams({ params: "not json" })).toEqual([]);
    expect(parseHttpToolParams({ params: '{"not":"an array"}' })).toEqual([]);
    expect(parseHttpToolParams({ params: '[{"description":"nameless"}]' })).toEqual([]);
  });

  it("classifies state-changing methods", () => {
    expect(isWriteMethod("post")).toBe(true);
    expect(isWriteMethod("DELETE")).toBe(true);
    expect(isWriteMethod("GET")).toBe(false);
    expect(isWriteMethod("HEAD")).toBe(false);
  });
});
