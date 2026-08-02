import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { rewriteKnowledgeFilePaths, runMigrations } from "./migrations";

const CURRENT = "/Users/x/Library/Application Support/OpenOrbit/knowledge-files";
const LEGACY = [
  "/Users/x/Library/Application Support/Agents/knowledge-files",
  "/Users/x/Library/Application Support/agents/knowledge-files",
  "/Users/x/Library/Application Support/alex/knowledge-files",
];

let db: Database.Database;

/** Minimal stand-in for the knowledge_files table — only the column under test matters here. */
function seedPaths(...paths: string[]): void {
  const insert = db.prepare("INSERT INTO knowledge_files (path) VALUES (?)");
  for (const p of paths) insert.run(p);
}

function storedPaths(): string[] {
  return (db.prepare("SELECT path FROM knowledge_files ORDER BY id").all() as { path: string }[]).map((r) => r.path);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("CREATE TABLE knowledge_files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE)");
});

describe("rewriteKnowledgeFilePaths", () => {
  it("re-points rows from a legacy root at the current one, preserving the rest of the path", () => {
    seedPaths(`${LEGACY[0]}/abc-123.pdf`, `${LEGACY[0]}/nested/deep.md`);

    expect(rewriteKnowledgeFilePaths(db, CURRENT, LEGACY)).toBe(2);
    expect(storedPaths()).toEqual([`${CURRENT}/abc-123.pdf`, `${CURRENT}/nested/deep.md`]);
  });

  it("handles rows spread across more than one legacy root", () => {
    seedPaths(`${LEGACY[0]}/a.md`, `${LEGACY[2]}/b.md`);

    expect(rewriteKnowledgeFilePaths(db, CURRENT, LEGACY)).toBe(2);
    expect(storedPaths()).toEqual([`${CURRENT}/a.md`, `${CURRENT}/b.md`]);
  });

  it("leaves rows already under the current root untouched", () => {
    seedPaths(`${CURRENT}/already-here.md`);

    expect(rewriteKnowledgeFilePaths(db, CURRENT, LEGACY)).toBe(0);
    expect(storedPaths()).toEqual([`${CURRENT}/already-here.md`]);
  });

  it("leaves paths outside any known root untouched", () => {
    // A path the user pointed at directly, or storage from some other app, must never move.
    seedPaths("/Users/x/Documents/report.pdf", "/tmp/scratch.md");

    expect(rewriteKnowledgeFilePaths(db, CURRENT, LEGACY)).toBe(0);
    expect(storedPaths()).toEqual(["/Users/x/Documents/report.pdf", "/tmp/scratch.md"]);
  });

  it("does not match a sibling directory that merely starts with the legacy prefix", () => {
    // The prefix comparison includes the separator, so knowledge-files-backup is not
    // caught by the knowledge-files prefix.
    seedPaths(`${LEGACY[0]}-backup/old.md`);

    expect(rewriteKnowledgeFilePaths(db, CURRENT, LEGACY)).toBe(0);
    expect(storedPaths()).toEqual([`${LEGACY[0]}-backup/old.md`]);
  });

  it("is a no-op on a second run", () => {
    seedPaths(`${LEGACY[0]}/a.md`);

    expect(rewriteKnowledgeFilePaths(db, CURRENT, LEGACY)).toBe(1);
    expect(rewriteKnowledgeFilePaths(db, CURRENT, LEGACY)).toBe(0);
    expect(storedPaths()).toEqual([`${CURRENT}/a.md`]);
  });

  it("skips a legacy directory identical to the current one", () => {
    seedPaths(`${CURRENT}/a.md`);

    expect(rewriteKnowledgeFilePaths(db, CURRENT, [CURRENT])).toBe(0);
    expect(storedPaths()).toEqual([`${CURRENT}/a.md`]);
  });

  it("does nothing when there are no legacy directories", () => {
    seedPaths(`${CURRENT}/a.md`);

    expect(rewriteKnowledgeFilePaths(db, CURRENT, [])).toBe(0);
  });
});

describe("messages.trace_id (migration 32)", () => {
  let migrated: Database.Database;

  beforeEach(() => {
    migrated = new Database(":memory:");
    runMigrations(migrated);
  });

  function messageColumns(): { name: string; notnull: number; dflt_value: unknown }[] {
    return migrated.pragma("table_info(messages)") as { name: string; notnull: number; dflt_value: unknown }[];
  }

  it("adds the column the per-message cost lookup joins on", () => {
    expect(messageColumns().map((c) => c.name)).toContain("trace_id");
  });

  it("leaves it nullable with no default", () => {
    // Rows written before this migration have an unknowable trace. A NOT NULL DEFAULT ''
    // would instead claim they all share one, making them join to each other.
    const traceId = messageColumns().find((c) => c.name === "trace_id");
    expect(traceId?.notnull).toBe(0);
    expect(traceId?.dflt_value).toBeNull();
  });

  it("preserves rows that predate it, leaving their trace null", () => {
    migrated.prepare("INSERT INTO conversations (id, title) VALUES (1, 'Default')").run();
    migrated.prepare("INSERT INTO messages (conversation_id, role, text) VALUES (1, 'user', 'hi')").run();

    const row = migrated.prepare("SELECT trace_id FROM messages").get() as { trace_id: string | null };
    expect(row.trace_id).toBeNull();
  });

  it("is indexed, since every rendered message looks up its trace", () => {
    const indexes = migrated.pragma("index_list(messages)") as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain("idx_messages_trace_id");
  });
});

describe("stale API key cleanup (migration 27)", () => {
  const MIGRATION_27 = String(27).padStart(14, "0");

  /** Re-runs migration 27 alone: apply everything, drop its ledger row, seed the settings row
   * under test, then run again. Selection is by absence from the ledger, so only 27 replays. */
  function replayMigration27(rawValue: string): Database.Database {
    const fresh = new Database(":memory:");
    runMigrations(fresh);
    fresh.prepare("DELETE FROM schema_migrations WHERE id = ?").run(MIGRATION_27);
    fresh
      .prepare(
        `INSERT INTO settings (setting_name, setting_value) VALUES (?, ?)
         ON CONFLICT(setting_name) DO UPDATE SET setting_value = excluded.setting_value`
      )
      .run("appSettings.chatApiKey", rawValue);
    return fresh;
  }

  function keyRowCount(db: Database.Database): number {
    return (
      db.prepare("SELECT COUNT(*) AS n FROM settings WHERE setting_name = ?").get("appSettings.chatApiKey") as {
        n: number;
      }
    ).n;
  }

  it("keeps a current-format encrypted value", () => {
    const db = replayMigration27(JSON.stringify("nodeCrypto:abc123"));
    runMigrations(db);
    expect(keyRowCount(db)).toBe(1);
    db.close();
  });

  it("deletes a value that parses but isn't in the current format", () => {
    const db = replayMigration27(JSON.stringify("v10:oldSafeStorageBlob"));
    runMigrations(db);
    expect(keyRowCount(db)).toBe(0);
    db.close();
  });

  it("deletes a value that isn't valid JSON instead of failing the migration", () => {
    // Unguarded, this threw inside the migration's transaction: migrations failed, getDb()
    // threw, and the app would not start at all — recoverable only by hand-editing the DB.
    // A row that can't be parsed is by definition not a current-format secret, so it takes
    // the same branch as any other unrecognised value.
    const db = replayMigration27("{not json");

    expect(() => runMigrations(db)).not.toThrow();

    expect(keyRowCount(db)).toBe(0);
    expect(ledgerContains(db, MIGRATION_27)).toBe(true);
    db.close();
  });

  it("still applies the migrations that sort after 27", () => {
    // A throw here used to abort the whole pending run, not just this one migration.
    const db = replayMigration27("{not json");
    const before = (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number }).n;

    runMigrations(db);

    expect((db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number }).n).toBe(before + 1);
    db.close();
  });

  function ledgerContains(db: Database.Database, id: string): boolean {
    return db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(id) !== undefined;
  }
});

describe("schema_migrations ledger", () => {
  const pad = (v: number) => String(v).padStart(14, "0");

  function ledgerIds(db: Database.Database): string[] {
    return (db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as { id: string }[]).map((r) => r.id);
  }

  /** Baseline taken from an actual fresh run rather than hardcoded counts. Hardcoding broke the
   * moment a branch adding migrations merged — the numbers are a property of the migration list,
   * not a fact about it, so every expectation below is derived from this. */
  const baseline = (() => {
    const db = new Database(":memory:");
    runMigrations(db);
    const ids = ledgerIds(db);
    const userVersion = db.pragma("user_version", { simple: true }) as number;
    db.close();
    // Ids above the numeric high-water mark are timestamp-keyed. Adoption of a pre-ledger database
    // only backfills the 1..user_version *integer* range, so these are never covered by it and
    // legitimately re-run once — which is why their `up` is written idempotently. Derived rather
    // than hardcoded for the same reason as the rest of this baseline.
    const timestampIds = ids.filter((id) => Number(id) > userVersion);
    return { ids, count: ids.length, userVersion, timestampIds };
  })();

  it("records every migration it applies to a fresh database", () => {
    const fresh = new Database(":memory:");
    runMigrations(fresh);

    const ids = ledgerIds(fresh);
    expect(ids.length).toBeGreaterThan(0);
    // Every key is padded to the YYYYMMDDHHMMSS width, which is what lets legacy numeric versions
    // and timestamp ids sort correctly against each other.
    expect(ids.every((id) => id.length === 14)).toBe(true);
    expect(ids).toContain(pad(baseline.userVersion));
    expect(new Set(ids).size).toBe(ids.length);
    fresh.close();
  });

  it("is a no-op when run twice", () => {
    const fresh = new Database(":memory:");
    runMigrations(fresh);
    const first = ledgerIds(fresh);

    expect(() => runMigrations(fresh)).not.toThrow();

    expect(ledgerIds(fresh)).toEqual(first);
    fresh.close();
  });

  it("adopts a pre-ledger database without re-running anything", () => {
    // Simulates an install that migrated before this table existed: schema fully up to date, no ledger.
    const existing = new Database(":memory:");
    runMigrations(existing);
    existing.exec("DROP TABLE schema_migrations");

    // Re-running must not re-apply migration 9's CREATE TABLE, which would throw "table already exists".
    expect(() => runMigrations(existing)).not.toThrow();

    // Adoption records the whole 1..user_version range, so it is deliberately *larger* than the set
    // of numeric migrations defined here — the surplus is the reserved 33/34 gap. What matters is
    // that every id that had genuinely been applied is still marked, so none of them re-run.
    // Timestamp ids sit outside that integer range and are re-applied on adoption, which their
    // idempotent `up` absorbs; they are counted separately rather than assumed away.
    const adopted = ledgerIds(existing);
    expect(adopted).toEqual(expect.arrayContaining(baseline.ids));
    expect(adopted).toHaveLength(baseline.userVersion + baseline.timestampIds.length);
    existing.close();
  });

  it("backfills numbers whose migration lives on a branch that has not merged yet", () => {
    // The failure this prevents: worktrees share one real database, so it can sit at a version whose
    // migration is defined only on an unmerged branch. Recording just the locally defined ids would
    // leave that number unmarked, and when the branch does merge its migration would re-run against a
    // schema it had already been applied to — e.g. ADD COLUMN failing with "duplicate column name".
    //
    // Ahead of anything defined here, so the gap is real regardless of how many migrations exist.
    const aheadOfLocal = baseline.userVersion + 4;
    const shared = new Database(":memory:");
    runMigrations(shared);
    shared.exec("DROP TABLE schema_migrations");
    shared.pragma(`user_version = ${aheadOfLocal}`);

    runMigrations(shared);

    const ids = ledgerIds(shared);
    expect(ids).toHaveLength(aheadOfLocal + baseline.timestampIds.length);
    expect(ids).toContain(pad(baseline.userVersion + 1));
    expect(ids).toContain(pad(aheadOfLocal));
    // 33 and 34 are unclaimed on every branch, so they are always a genuine gap in the local list.
    expect(ids).toContain(pad(33));
    expect(ids).toContain(pad(34));
    shared.close();
  });

  it("still creates the http-tools schema when the ledger already records 33 and 34", () => {
    // Why those two migrations carry timestamp ids instead of the 33/34 they were written with.
    // Adoption backfills the whole 1..user_version integer range, so an install that ran main but
    // never this branch has 33 marked applied while having none of the tables it creates. Keyed
    // numerically they would be filtered out as already-applied — permanently, since nothing moves
    // the mark back — and every httpTools:* call would fail on "no such table".
    const shared = new Database(":memory:");
    runMigrations(shared);
    shared.exec("DROP TABLE http_tools");
    shared.exec("DROP TABLE http_tool_collections");
    shared.exec("DROP TABLE schema_migrations");
    shared.pragma(`user_version = ${baseline.userVersion}`);

    runMigrations(shared);

    const tables = (
      shared.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toContain("http_tool_collections");
    expect(tables).toContain("http_tools");
    // agents.http_tool_collection_ids survived the table drops, so re-running the create migration
    // also exercises its ADD COLUMN guard — without it this would throw "duplicate column name".
    const agentColumns = (shared.pragma("table_info(agents)") as { name: string }[]).map((c) => c.name);
    expect(agentColumns).toContain("http_tool_collection_ids");
    shared.close();
  });

  it("runs a migration numbered below the high-water mark — the ratchet bug", () => {
    // Under the old runner this was unreachable forever: `version > user_version` filtered it out and
    // nothing ever set it back, so a migration arriving late on a shared database never ran again.
    // A ledger selects by absence instead, so number order stops mattering.
    //
    // 31 is used because its `up` is a no-op without a MigrationContext (it only re-points paths when
    // given directories), so this asserts *selection* without re-executing DDL that would legitimately
    // conflict with the schema it already produced.
    const db2 = new Database(":memory:");
    runMigrations(db2);
    expect(db2.pragma("user_version", { simple: true })).toBe(baseline.userVersion);
    db2.prepare("DELETE FROM schema_migrations WHERE id = ?").run(pad(31));

    runMigrations(db2);

    expect(ledgerIds(db2)).toContain(pad(31));
    db2.close();
  });

  it("keeps user_version at the highest applied numeric version for a pre-ledger revert", () => {
    const fresh = new Database(":memory:");
    runMigrations(fresh);

    expect(fresh.pragma("user_version", { simple: true })).toBe(baseline.userVersion);
    fresh.close();
  });

  it("rolls back the ledger row when a migration throws", () => {
    // The insert shares the migration's transaction, so a failed migration must not look applied.
    const fresh = new Database(":memory:");
    runMigrations(fresh);
    const before = ledgerIds(fresh);
    fresh.exec("DROP TABLE knowledge_files");
    fresh.prepare("DELETE FROM schema_migrations WHERE id = ?").run(pad(25));

    // Migration 25 alters knowledge_files, which no longer exists.
    expect(() => runMigrations(fresh)).toThrow();

    expect(ledgerIds(fresh)).not.toContain(pad(25));
    expect(ledgerIds(fresh).length).toBe(before.length - 1);
    fresh.close();
  });
});
