import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrations";

describe("migration 17 — knowledge_files.category", () => {
  it("adds a category column defaulting to 'Uncategorized'", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare(
      "INSERT INTO knowledge_files (path, title, original_name) VALUES (?, ?, ?)"
    ).run("/tmp/a.md", "A", "a.md");
    const row = db.prepare("SELECT category FROM knowledge_files WHERE path = ?").get("/tmp/a.md") as {
      category: string;
    };
    expect(row.category).toBe("Uncategorized");
    db.close();
  });
});

describe("migration 19 — knowledge_files.source_url", () => {
  it("adds a source_url column defaulting to an empty string", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare(
      "INSERT INTO knowledge_files (path, title, original_name) VALUES (?, ?, ?)"
    ).run("/tmp/b.md", "B", "b.md");
    const row = db.prepare("SELECT source_url FROM knowledge_files WHERE path = ?").get("/tmp/b.md") as {
      source_url: string;
    };
    expect(row.source_url).toBe("");
    db.close();
  });
});

describe("migration 35 — knowledge_files.kind", () => {
  it("defaults a plain row to 'file'", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO knowledge_files (path, title, original_name) VALUES (?, ?, ?)").run(
      "/tmp/c.md",
      "C",
      "c.md"
    );
    const row = db.prepare("SELECT kind FROM knowledge_files WHERE path = ?").get("/tmp/c.md") as { kind: string };
    expect(row.kind).toBe("file");
    db.close();
  });

  it("backfills every row carrying a source_url to 'url', including each part of a split page", () => {
    const db = new Database(":memory:");
    // Minimal pre-35 stand-in (same approach as migrations.test.ts's rewrite tests): only the
    // columns migration 35 reads matter. Seeding rows *before* the migration runs is what makes
    // this assert the backfill — rows inserted after a full migration run would simply pick up the
    // 'file' column default and prove nothing.
    db.exec(`CREATE TABLE knowledge_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      source_url TEXT NOT NULL DEFAULT ''
    );`);
    // Pinning to 34 runs 35 *and* every later migration, so the stand-in also needs the agents
    // table 36 writes to. A real database always has both.
    db.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, prompt TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '');`);
    db.pragma("user_version = 34");
    const insert = db.prepare("INSERT INTO knowledge_files (path, source_url) VALUES (?, ?)");
    insert.run("/tmp/p1.md", "https://example.com/long");
    insert.run("/tmp/p2.md", "https://example.com/long");
    insert.run("/tmp/plain.md", "");

    runMigrations(db);

    const kinds = db
      .prepare("SELECT path, kind FROM knowledge_files ORDER BY path")
      .all() as { path: string; kind: string }[];
    expect(kinds).toEqual([
      { path: "/tmp/p1.md", kind: "url" },
      { path: "/tmp/p2.md", kind: "url" },
      { path: "/tmp/plain.md", kind: "file" },
    ]);
    db.close();
  });
});

describe("migration 36 — knowledgeAgent's seeded prompt and description", () => {
  const OLD_DESCRIPTION =
    "Reads and searches the documents (Markdown, text, CSV, PDF, Word, Excel, PowerPoint, HTML, OpenDocument, legacy .doc/.xls, and code/data files) you've added to the knowledge base.";

  /** Minimal pre-36 stand-in — only the columns migration 36 reads matter, plus the
   * knowledge_files table migration 35 alters on its way past. */
  function seedAgent(fields: { id: string; prompt: string; description: string }): Database.Database {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT ''
    );`);
    db.exec(`CREATE TABLE knowledge_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      source_url TEXT NOT NULL DEFAULT ''
    );`);
    db.pragma("user_version = 34");
    db.prepare("INSERT INTO agents (id, prompt, description) VALUES (?, ?, ?)").run(
      fields.id,
      fields.prompt,
      fields.description
    );
    return db;
  }

  function agentRow(db: Database.Database, id: string): { prompt: string; description: string } {
    return db.prepare("SELECT prompt, description FROM agents WHERE id = ?").get(id) as {
      prompt: string;
      description: string;
    };
  }

  it("rewrites both stale folder phrases in an already-seeded prompt", () => {
    const db = seedAgent({
      id: "knowledgeAgent",
      prompt:
        "tools for the local folders the user has explicitly granted via the Folders widget — use these when " +
        "the user asks about files or folders on their computer (separate from the Knowledgebase library).",
      description: OLD_DESCRIPTION,
    });

    runMigrations(db);

    const { prompt, description } = agentRow(db, "knowledgeAgent");
    expect(prompt).not.toContain("Folders widget");
    expect(prompt).not.toContain("separate from the Knowledgebase library");
    expect(prompt).toContain("in the Knowledge widget");
    expect(prompt).toContain("read live rather than copied");
    expect(description).toContain("browses the folders you've attached to it");
    db.close();
  });

  it("leaves a prompt and description the user edited alone", () => {
    // replace() is a no-op when the phrase is absent and the description update is guarded on
    // the exact prior default, so a customised agent survives untouched.
    const db = seedAgent({
      id: "knowledgeAgent",
      prompt: "My own prompt, rewritten by hand.",
      description: "My own description.",
    });

    runMigrations(db);

    expect(agentRow(db, "knowledgeAgent")).toEqual({
      prompt: "My own prompt, rewritten by hand.",
      description: "My own description.",
    });
    db.close();
  });

  it("does not touch other agents that happen to mention the same phrase", () => {
    const db = seedAgent({
      id: "explorerAgent",
      prompt: "granted via the Folders widget",
      description: OLD_DESCRIPTION,
    });

    runMigrations(db);

    expect(agentRow(db, "explorerAgent")).toEqual({
      prompt: "granted via the Folders widget",
      description: OLD_DESCRIPTION,
    });
    db.close();
  });
});

vi.mock("../ai/provider", () => ({
  getDecryptedChatApiKey: vi.fn(),
  getConfiguredChatUrl: vi.fn(() => "https://api.openai.com/v1"),
}));

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

const { notificationShowMock, notificationCtorMock } = vi.hoisted(() => {
  const notificationShowMock = vi.fn();
  const notificationCtorMock = vi.fn(function Notification(this: { show: () => void }) {
    this.show = notificationShowMock;
  });
  return { notificationShowMock, notificationCtorMock };
});
vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) },
  Notification: Object.assign(notificationCtorMock, { isSupported: vi.fn(() => true) }),
}));

const callDaemonMock = vi.fn();
vi.mock("../ai/webSearchDaemon", () => ({
  callDaemon: (...args: unknown[]) => callDaemonMock(...args),
}));

// Real DNS lookups have no place in a unit test — assertPublicHttpUrl's own protocol/
// private-range logic is covered directly in net/urlSafety.test.ts. Wrapped in vi.fn()
// (rather than a bare arrow function) so individual tests can override it to reject,
// to verify the guard is actually wired into the fetch path (see "knowledgebase:addUrls refuses
// a blocked URL" below), not just that the guard itself works in isolation.
const assertPublicHttpUrlMock = vi.fn(async (url: string) => new URL(url));
vi.mock("../net/urlSafety", () => ({
  assertPublicHttpUrl: (url: string) => assertPublicHttpUrlMock(url),
}));

// Sitemap discovery hits the network directly (not via callDaemon) — default to "no
// sitemap found" so existing discoverLinks/addUrls tests exercise the unchanged
// page-scan fallback path; sitemap-present behavior is covered separately.
const fetchSitemapUrlsMock = vi.fn(async () => null as string[] | null);
vi.mock("./sitemapDiscovery", () => ({
  fetchSitemapUrls: () => fetchSitemapUrlsMock(),
}));

let db: Database.Database;
let knowledgeFilesDir: string;

vi.mock("../db", () => ({
  getDb: () => db,
}));

vi.mock("../appDirs", () => ({
  getKnowledgeFilesDir: () => knowledgeFilesDir,
}));

import { ipcMain } from "electron";
import { categorizeContent, registerKnowledgeBaseHandlers, KnowledgebaseFileRecord } from "./knowledgeBase";
import { getAllowedRoots, removeAllowedRoot } from "./filesystem";
import { setSetting } from "../db/settingsStore";
import { getDecryptedChatApiKey } from "../ai/provider";

describe("categorizeContent", () => {
  beforeEach(() => {
    createMock.mockReset();
    vi.mocked(getDecryptedChatApiKey).mockReset();
  });

  it("returns the model's trimmed category label on success", async () => {
    vi.mocked(getDecryptedChatApiKey).mockReturnValue("test-key");
    createMock.mockResolvedValue({
      choices: [{ message: { content: "  Accounting  " } }],
    });
    const category = await categorizeContent("Invoice #1042, total due $500", "invoice.pdf");
    expect(category).toBe("Accounting");
  });

  it("falls back to 'Uncategorized' when no API key is configured", async () => {
    vi.mocked(getDecryptedChatApiKey).mockImplementation(() => {
      throw new Error("No AI provider API key configured. Set one in Settings first.");
    });
    const category = await categorizeContent("some text", "file.txt");
    expect(category).toBe("Uncategorized");
  });

  it("falls back to 'Uncategorized' on a malformed response", async () => {
    vi.mocked(getDecryptedChatApiKey).mockReturnValue("test-key");
    createMock.mockResolvedValue({ choices: [] });
    const category = await categorizeContent("some text", "file.txt");
    expect(category).toBe("Uncategorized");
  });
});

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function getHandlers(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  for (const call of (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls) {
    handlers[call[0] as string] = call[1] as Handler;
  }
  return handlers;
}

describe("knowledge base IPC handlers", () => {
  let tmpRoot: string;
  let sourceDir: string;
  let handlers: Record<string, Handler>;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "agents-kb-test-"));
    sourceDir = path.join(tmpRoot, "source");
    knowledgeFilesDir = path.join(tmpRoot, "knowledge-files");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(knowledgeFilesDir, { recursive: true });

    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    vi.mocked(ipcMain.handle).mockClear();
    callDaemonMock.mockReset();
    assertPublicHttpUrlMock.mockReset();
    assertPublicHttpUrlMock.mockImplementation(async (url: string) => new URL(url));
    fetchSitemapUrlsMock.mockReset();
    fetchSitemapUrlsMock.mockResolvedValue(null);
    notificationShowMock.mockClear();
    notificationCtorMock.mockClear();
    registerKnowledgeBaseHandlers();
    handlers = getHandlers();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("knowledgebase:discoverLinks partitions the fetched page's links into same-domain and external groups", async () => {
    callDaemonMock.mockResolvedValue({
      url: "https://example.com/docs",
      title: "Docs",
      links: [
        { href: "https://example.com/docs/page-1", text: "Page 1" },
        { href: "https://other.com/page", text: "Other" },
      ],
    });

    const result = (await handlers["knowledgebase:discoverLinks"](null, "https://example.com/docs")) as {
      seedUrl: string;
      title: string;
      sameDomainLinks: { url: string; text: string }[];
      externalLinks: { url: string; text: string }[];
    };

    expect(result.seedUrl).toBe("https://example.com/docs");
    expect(result.title).toBe("Docs");
    expect(result.sameDomainLinks).toEqual([{ url: "https://example.com/docs/page-1", text: "Page 1" }]);
    expect(result.externalLinks).toEqual([{ url: "https://other.com/page", text: "Other" }]);
    expect(callDaemonMock).toHaveBeenCalledWith("/fetch-web", {
      url: "https://example.com/docs",
      includeLinks: true,
      readability: true,
    });
  });

  it("knowledgebase:discoverLinks rejects an empty URL without calling the daemon", async () => {
    await expect(handlers["knowledgebase:discoverLinks"](null, "")).rejects.toThrow("knowledgebase:discoverLinks requires a URL");
    expect(callDaemonMock).not.toHaveBeenCalled();
  });

  it("knowledgebase:addUrls never calls the daemon for a URL the SSRF guard rejects", async () => {
    assertPublicHttpUrlMock.mockRejectedValue(new Error('Refusing to fetch a local/private address: "blocked"'));

    const { added, failed } = (await handlers["knowledgebase:addUrls"](null, ["http://127.0.0.1/admin"])) as {
      added: KnowledgebaseFileRecord[];
      failed: { url: string; error: string }[];
    };

    expect(added).toEqual([]);
    expect(failed).toEqual([{ url: "http://127.0.0.1/admin", error: expect.stringContaining("local/private") }]);
    expect(callDaemonMock).not.toHaveBeenCalled();
  });

  it("knowledgebase:addUrls saves a new URL as a synthetic .md file, named from the path, categorized as Websites", async () => {
    callDaemonMock.mockResolvedValue({
      url: "https://example.com/docs",
      title: "Example Docs",
      content: "This is the page content.",
    });
    vi.mocked(getDecryptedChatApiKey).mockReturnValue("test-key");

    const { added, failed } = (await handlers["knowledgebase:addUrls"](null, ["https://example.com/docs"])) as {
      added: KnowledgebaseFileRecord[];
      failed: { url: string; error: string }[];
    };

    expect(failed).toEqual([]);
    expect(added).toHaveLength(1);
    expect(added[0].title).toBe("Example Docs");
    expect(added[0].sourceUrl).toBe("https://example.com/docs");
    expect(added[0].category).toBe("Websites");
    expect(added[0].originalName).toBe("docs.md");
    expect(added[0].path.endsWith(".md")).toBe(true);
    expect(existsSync(added[0].path)).toBe(true);
    const stored = await readFile(added[0].path, "utf8");
    expect(stored).toContain("This is the page content.");
    expect(stored).not.toContain("undefined");
  });

  it("knowledgebase:addUrls names the root/home page after the bare domain", async () => {
    callDaemonMock.mockResolvedValue({
      url: "https://chdsom.com/",
      title: "Home",
      content: "Welcome to the site.",
    });

    const { added } = (await handlers["knowledgebase:addUrls"](null, ["https://chdsom.com/"])) as { added: KnowledgebaseFileRecord[] };

    expect(added[0].originalName).toBe("chdsom.com.md");
  });

  it("knowledgebase:addUrls gives distinct names to URLs differing only by query string", async () => {
    callDaemonMock.mockResolvedValueOnce({ url: "https://example.com/docs?v=1", title: "V1", content: "First." });
    const { added: added1 } = (await handlers["knowledgebase:addUrls"](null, ["https://example.com/docs?v=1"])) as {
      added: KnowledgebaseFileRecord[];
    };
    callDaemonMock.mockResolvedValueOnce({ url: "https://example.com/docs?v=2", title: "V2", content: "Second." });
    const { added: added2 } = (await handlers["knowledgebase:addUrls"](null, ["https://example.com/docs?v=2"])) as {
      added: KnowledgebaseFileRecord[];
    };

    expect(added1[0].originalName).not.toBe(added2[0].originalName);
  });

  it("knowledgebase:addUrls re-syncs an existing row instead of duplicating it when the URL was already added", async () => {
    callDaemonMock.mockResolvedValue({ url: "https://example.com/docs", title: "V1", content: "First version." });
    vi.mocked(getDecryptedChatApiKey).mockImplementation(() => {
      throw new Error("No AI provider API key configured. Set one in Settings first.");
    });
    const first = (await handlers["knowledgebase:addUrls"](null, ["https://example.com/docs"])) as {
      added: KnowledgebaseFileRecord[];
    };
    const firstId = first.added[0].id;

    callDaemonMock.mockResolvedValue({ url: "https://example.com/docs", title: "V2", content: "Second version." });
    const second = (await handlers["knowledgebase:addUrls"](null, ["https://example.com/docs"])) as {
      added: KnowledgebaseFileRecord[];
    };

    expect(second.added).toHaveLength(1);
    expect(second.added[0].id).toBe(firstId);
    expect(second.added[0].title).toBe("V2");
    expect((await handlers["knowledgebase:list"](null)) as KnowledgebaseFileRecord[]).toHaveLength(1);
  });

  it("knowledgebase:addUrls collects per-URL failures without aborting the rest of the batch", async () => {
    callDaemonMock
      .mockResolvedValueOnce({ url: "https://good.com", title: "Good", content: "Fine content." })
      .mockRejectedValueOnce(new Error("Fetch timed out"));
    vi.mocked(getDecryptedChatApiKey).mockImplementation(() => {
      throw new Error("No AI provider API key configured. Set one in Settings first.");
    });

    const { added, failed } = (await handlers["knowledgebase:addUrls"](null, ["https://good.com", "https://bad.com"])) as {
      added: KnowledgebaseFileRecord[];
      failed: { url: string; error: string }[];
    };

    expect(added).toHaveLength(1);
    expect(failed).toEqual([{ url: "https://bad.com", error: "Fetch timed out" }]);
  });

  it("knowledgebase:addUrls fires an OS notification summarizing the batch result", async () => {
    callDaemonMock
      .mockResolvedValueOnce({ url: "https://good.com", title: "Good", content: "Fine content." })
      .mockRejectedValueOnce(new Error("Fetch timed out"));

    await handlers["knowledgebase:addUrls"](null, ["https://good.com", "https://bad.com"]);

    expect(notificationCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: "1 of 2 URLs saved." })
    );
    expect(notificationShowMock).toHaveBeenCalled();
  });

  it("splits content over the 100KB cap into multiple rows sharing one source_url instead of truncating", async () => {
    const big = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ` + "x".repeat(3000)).join("\n\n");
    callDaemonMock.mockResolvedValue({ url: "https://example.com/long", title: "Long Page", content: big });

    const { added } = (await handlers["knowledgebase:addUrls"](null, ["https://example.com/long"])) as {
      added: KnowledgebaseFileRecord[];
    };

    expect(added).toHaveLength(1); // addUrl's external contract: one representative record per URL
    const rows = db
      .prepare("SELECT original_name AS originalName, content, part_index AS partIndex, part_count AS partCount FROM knowledge_files WHERE source_url = ? ORDER BY part_index")
      .all("https://example.com/long") as { originalName: string; content: string; partIndex: number; partCount: number }[];

    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.content.length).toBeLessThanOrEqual(100_000);
      expect(row.content).not.toContain("[…truncated]");
      expect(row.partCount).toBe(rows.length);
    }
    expect(rows[0].originalName).toBe("long.md");
    expect(rows[1].originalName).toBe("long-2.md");
  });

  it("re-syncing a split URL whose content shrank collapses back to one row", async () => {
    const big = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ` + "x".repeat(3000)).join("\n\n");
    callDaemonMock.mockResolvedValue({ url: "https://example.com/long", title: "Long Page", content: big });
    const { added } = (await handlers["knowledgebase:addUrls"](null, ["https://example.com/long"])) as { added: KnowledgebaseFileRecord[] };
    const id = added[0].id;
    const beforeCount = (
      db.prepare("SELECT COUNT(*) AS n FROM knowledge_files WHERE source_url = ?").get("https://example.com/long") as {
        n: number;
      }
    ).n;
    expect(beforeCount).toBeGreaterThan(1);

    callDaemonMock.mockResolvedValue({ url: "https://example.com/long", title: "Long Page", content: "Now short." });
    await handlers["knowledgebase:sync"](null, id);

    const afterCount = (
      db.prepare("SELECT COUNT(*) AS n FROM knowledge_files WHERE source_url = ?").get("https://example.com/long") as {
        n: number;
      }
    ).n;
    expect(afterCount).toBe(1);
  });

  it("knowledgebase:discoverLinks uses sitemap URLs as the same-domain link source when a sitemap exists", async () => {
    callDaemonMock.mockResolvedValue({
      url: "https://example.com/",
      title: "Home",
      links: [{ href: "https://other.com/page", text: "Other" }],
    });
    fetchSitemapUrlsMock.mockResolvedValue([
      "https://example.com/sitemap-page-1",
      "https://example.com/sitemap-page-2",
    ]);

    const result = (await handlers["knowledgebase:discoverLinks"](null, "https://example.com/")) as {
      sameDomainLinks: { url: string; text: string }[];
      externalLinks: { url: string; text: string }[];
    };

    expect(result.sameDomainLinks.map((l) => l.url)).toEqual([
      "https://example.com/sitemap-page-1",
      "https://example.com/sitemap-page-2",
    ]);
    expect(result.externalLinks).toEqual([{ url: "https://other.com/page", text: "Other" }]);
  });

  it("knowledgebase:sync re-fetches from source_url for URL-sourced rows instead of re-reading the stored copy", async () => {
    callDaemonMock.mockResolvedValue({ url: "https://example.com/docs", title: "Original", content: "Original text." });
    vi.mocked(getDecryptedChatApiKey).mockImplementation(() => {
      throw new Error("No AI provider API key configured. Set one in Settings first.");
    });
    const { added } = (await handlers["knowledgebase:addUrls"](null, ["https://example.com/docs"])) as { added: KnowledgebaseFileRecord[] };
    const id = added[0].id;

    callDaemonMock.mockResolvedValue({ url: "https://example.com/docs", title: "Updated", content: "Updated text." });
    const result = (await handlers["knowledgebase:sync"](null, id)) as { updated: string[]; missing: string[] };

    expect(result.missing).toEqual([]);
    const row = db.prepare("SELECT title, content, category FROM knowledge_files WHERE id = ?").get(id) as {
      title: string;
      content: string;
      category: string;
    };
    expect(row.title).toBe("Updated");
    expect(row.content).toContain("Updated text.");
    expect(row.category).toBe("Websites");
  });

  it("rejects an unsupported file extension without touching the DB or filesystem", async () => {
    const filePath = path.join(sourceDir, "notes.pages");
    writeFileSync(filePath, "whatever");

    await expect(handlers["knowledgebase:add"](null, filePath)).rejects.toThrow('Unsupported file type ".pages"');
    expect((await handlers["knowledgebase:list"](null)) as KnowledgebaseFileRecord[]).toEqual([]);
  });

  it("ingests a .md file: extracts the H1 as title and copies it into knowledge-files storage", async () => {
    const filePath = path.join(sourceDir, "resume.md");
    writeFileSync(filePath, "# My Resume\n\nSome content here.");

    const record = (await handlers["knowledgebase:add"](null, filePath)) as KnowledgebaseFileRecord;

    expect(record.title).toBe("My Resume");
    expect(record.originalName).toBe("resume.md");
    // Stored under the app-owned knowledge-files dir, not a reference to the original path.
    expect(record.path).not.toBe(filePath);
    expect(record.path.startsWith(knowledgeFilesDir)).toBe(true);
    expect(existsSync(record.path)).toBe(true);
    expect(existsSync(filePath)).toBe(true); // original untouched
  });

  it("falls back to the filename (without extension) as title when there's no H1", async () => {
    const filePath = path.join(sourceDir, "budget-notes.txt");
    writeFileSync(filePath, "just plain text, no heading");

    const record = (await handlers["knowledgebase:add"](null, filePath)) as KnowledgebaseFileRecord;
    expect(record.title).toBe("budget-notes");
  });

  it("truncates content beyond the 100KB cap", async () => {
    const filePath = path.join(sourceDir, "big.txt");
    writeFileSync(filePath, "x".repeat(150_000));

    const record = (await handlers["knowledgebase:add"](null, filePath)) as KnowledgebaseFileRecord;
    const row = db.prepare("SELECT content FROM knowledge_files WHERE id = ?").get(record.id) as {
      content: string;
    };
    expect(row.content.length).toBeLessThan(150_000);
    expect(row.content.endsWith("[…truncated]")).toBe(true);
  });

  it("knowledgebase:remove deletes both the DB row and the stored copy on disk", async () => {
    const filePath = path.join(sourceDir, "note.txt");
    writeFileSync(filePath, "hello");
    const record = (await handlers["knowledgebase:add"](null, filePath)) as KnowledgebaseFileRecord;
    expect(existsSync(record.path)).toBe(true);

    await handlers["knowledgebase:remove"](null, record.id);

    expect(existsSync(record.path)).toBe(false);
    expect((await handlers["knowledgebase:list"](null)) as KnowledgebaseFileRecord[]).toEqual([]);
  });

  describe("granted folders as knowledge-base rows", () => {
    /** Grants `dir` the same way fs:pickFolder does — by appending to the allowedRoots setting,
     * which stays the single source of truth the rows mirror. */
    function grant(...dirs: string[]): void {
      setSetting("allowedRoots", dirs);
    }

    async function list(): Promise<KnowledgebaseFileRecord[]> {
      return (await handlers["knowledgebase:list"](null)) as KnowledgebaseFileRecord[];
    }

    it("materialises a row for each granted root, categorised so it gets its own tab", async () => {
      const docs = path.join(tmpRoot, "docs");
      mkdirSync(docs);
      grant(docs);

      const rows = await list();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        path: docs,
        originalName: "docs",
        title: "docs",
        category: "Folders",
        kind: "folder",
        sourceUrl: null,
      });
    });

    it("drops the row when the root is revoked elsewhere, without touching the directory", async () => {
      const docs = path.join(tmpRoot, "docs");
      mkdirSync(docs);
      writeFileSync(path.join(docs, "keep.txt"), "keep me");
      grant(docs);
      expect(await list()).toHaveLength(1);

      // Revoked through the filesystem IPC path rather than the knowledge base — the mirror must
      // still self-heal, which is the whole point of reconciling on read.
      removeAllowedRoot(docs);

      expect(await list()).toEqual([]);
      expect(existsSync(path.join(docs, "keep.txt"))).toBe(true);
    });

    it("is idempotent — listing repeatedly never duplicates a row", async () => {
      const docs = path.join(tmpRoot, "docs");
      mkdirSync(docs);
      grant(docs);

      await list();
      await list();

      expect(await list()).toHaveLength(1);
    });

    it("reconciles a root that no longer exists on disk instead of failing", async () => {
      // A granted folder can be deleted or unmounted behind the app's back. Reconciling is a pure
      // DB operation, so the row still appears and only browsing it surfaces the error.
      grant(path.join(tmpRoot, "gone-away"));

      const rows = await list();

      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("folder");
    });

    it("removing a folder row revokes access and never deletes the user's directory", async () => {
      const docs = path.join(tmpRoot, "docs");
      const nested = path.join(docs, "nested");
      mkdirSync(nested, { recursive: true });
      writeFileSync(path.join(docs, "top.txt"), "top");
      writeFileSync(path.join(nested, "deep.txt"), "deep");
      grant(docs);
      const [folderRow] = await list();

      await handlers["knowledgebase:remove"](null, folderRow.id);

      // The whole point of the kind branch: this is the user's own directory, not an app-owned copy.
      expect(existsSync(docs)).toBe(true);
      expect(existsSync(path.join(docs, "top.txt"))).toBe(true);
      expect(existsSync(path.join(nested, "deep.txt"))).toBe(true);
      expect(getAllowedRoots()).toEqual([]);
      expect(await list()).toEqual([]);
    });

    it("a full sync leaves folder rows alone instead of flagging them stale", async () => {
      const docs = path.join(tmpRoot, "docs");
      mkdirSync(docs);
      grant(docs);
      const filePath = path.join(sourceDir, "note.md");
      writeFileSync(filePath, "# Note\n\nbody");
      await handlers["knowledgebase:add"](null, filePath);
      const [folderRow] = (await list()).filter((r) => r.kind === "folder");

      const result = (await handlers["knowledgebase:sync"](null)) as {
        updated: string[];
        missing: { name: string; error: string }[];
      };

      // extract() on a directory throws EISDIR, which the catch would turn into synced_at = NULL
      // plus a "missing" entry the user can do nothing about.
      expect(result.missing).toEqual([]);
      expect(result.updated).toEqual(["note.md"]);
      const after = (await list()).find((r) => r.id === folderRow.id);
      expect(after?.syncedAt).not.toBeNull();
    });

    it("re-syncing a single folder row is a no-op rather than an error", async () => {
      const docs = path.join(tmpRoot, "docs");
      mkdirSync(docs);
      grant(docs);
      const [folderRow] = await list();

      const result = (await handlers["knowledgebase:sync"](null, folderRow.id)) as {
        updated: string[];
        missing: { name: string; error: string }[];
      };

      expect(result).toEqual({ updated: [], missing: [] });
      const after = (await list()).find((r) => r.id === folderRow.id);
      expect(after?.syncedAt).not.toBeNull();
    });

    it("still deletes the stored copy when the row is an ordinary file", async () => {
      // Guards the other half of the branch — the folder carve-out must not weaken file cleanup.
      const filePath = path.join(sourceDir, "note.txt");
      writeFileSync(filePath, "hello");
      const record = (await handlers["knowledgebase:add"](null, filePath)) as KnowledgebaseFileRecord;

      await handlers["knowledgebase:remove"](null, record.id);

      expect(existsSync(record.path)).toBe(false);
    });
  });

  it("knowledgebase:sync marks a row's synced_at NULL when its stored copy has gone missing", async () => {
    const filePath = path.join(sourceDir, "note.txt");
    writeFileSync(filePath, "hello");
    const record = (await handlers["knowledgebase:add"](null, filePath)) as KnowledgebaseFileRecord;

    // Simulate the stored copy disappearing without going through knowledgebase:remove.
    rmSync(record.path);

    const result = (await handlers["knowledgebase:sync"](null)) as {
      updated: string[];
      missing: { name: string; error: string }[];
    };
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].name).toEqual("note.txt");
    expect(result.missing[0].error).toMatch(/ENOENT/);
    expect(result.updated).toEqual([]);

    const row = db.prepare("SELECT synced_at FROM knowledge_files WHERE id = ?").get(record.id) as {
      synced_at: string | null;
    };
    expect(row.synced_at).toBeNull();
  });

  it("knowledgebase:add lets a file be added even when its source folder isn't in allowedRoots", async () => {
    // No allowedRoots setting is configured at all in this test — knowledgebase:add must not
    // depend on it, since ingestion is only ever reachable via an explicit user
    // gesture (file picker / drag-drop), unlike fs:readFile's ongoing-access model.
    const filePath = path.join(sourceDir, "unrestricted.txt");
    writeFileSync(filePath, "unrestricted content");

    const record = (await handlers["knowledgebase:add"](null, filePath)) as KnowledgebaseFileRecord;
    expect(record.originalName).toBe("unrestricted.txt");
  });

  it("rejects adding a file whose content already exists in the knowledge base, even under a different name", async () => {
    const firstPath = path.join(sourceDir, "original.txt");
    writeFileSync(firstPath, "duplicate content");
    await handlers["knowledgebase:add"](null, firstPath);

    const secondPath = path.join(sourceDir, "renamed-copy.txt");
    writeFileSync(secondPath, "duplicate content");

    await expect(handlers["knowledgebase:add"](null, secondPath)).rejects.toThrow(
      'This file has already been added as "original.txt"'
    );
    expect((await handlers["knowledgebase:list"](null)) as KnowledgebaseFileRecord[]).toHaveLength(1);
  });
});
