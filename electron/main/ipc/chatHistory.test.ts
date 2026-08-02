import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrations";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

let db: Database.Database;

vi.mock("../db", () => ({
  getDb: () => db,
}));

import { listMessagesPage, appendMessage } from "./chatHistory";

/** Seeds `count` alternating user/assistant messages, oldest first, numbered so a page's
 * contents can be identified by text. Assistant rows carry a trace so the cost lookup the
 * modal performs has something to key on. */
function seedMessages(count: number): void {
  for (let i = 1; i <= count; i++) {
    const role = i % 2 === 1 ? "user" : "assistant";
    appendMessage({
      role,
      text: `msg-${i}`,
      agentId: role === "assistant" ? "Orbit" : null,
      traceId: role === "assistant" ? `trace-${i}` : null,
    });
  }
}

function textsOf(page: ReturnType<typeof listMessagesPage>): string[] {
  return page.messages.map((m) => m.text);
}

describe("listMessagesPage", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  it("returns an empty page and a zero total for a fresh conversation", () => {
    expect(listMessagesPage(undefined, 20, 0)).toEqual({ messages: [], total: 0 });
  });

  it("page 0 holds the newest messages", () => {
    seedMessages(25);
    const page = listMessagesPage(undefined, 20, 0);
    expect(page.total).toBe(25);
    expect(textsOf(page)[0]).toBe("msg-6");
    expect(textsOf(page).at(-1)).toBe("msg-25");
  });

  it("orders rows oldest-first inside the page so a turn still reads user-then-assistant", () => {
    seedMessages(4);
    expect(textsOf(listMessagesPage(undefined, 20, 0))).toEqual(["msg-1", "msg-2", "msg-3", "msg-4"]);
  });

  it("walks backwards as the page number goes up", () => {
    seedMessages(25);
    const older = listMessagesPage(undefined, 20, 1);
    expect(textsOf(older)).toEqual(["msg-1", "msg-2", "msg-3", "msg-4", "msg-5"]);
    expect(older.total).toBe(25);
  });

  it("covers every message exactly once across all pages", () => {
    seedMessages(47);
    const seen: string[] = [];
    for (let p = 0; p < 3; p++) seen.push(...textsOf(listMessagesPage(undefined, 20, p)));
    expect(seen).toHaveLength(47);
    expect(new Set(seen).size).toBe(47);
  });

  it("returns an empty page past the end without throwing", () => {
    seedMessages(5);
    const page = listMessagesPage(undefined, 20, 9);
    expect(page.messages).toEqual([]);
    // total still reports the real count, so the caller can clamp back into range.
    expect(page.total).toBe(5);
  });

  it("carries trace_id through, which is what the cost lookup keys on", () => {
    seedMessages(2);
    const page = listMessagesPage(undefined, 20, 0);
    expect(page.messages[0].traceId).toBeNull();
    expect(page.messages[1].traceId).toBe("trace-2");
  });

  it("clamps a hostile limit rather than trusting the renderer", () => {
    seedMessages(30);
    // Negative/zero would be a SQL error or an empty page forever; an unbounded limit
    // would defeat paging entirely.
    expect(listMessagesPage(undefined, -5, 0).messages).toHaveLength(1);
    expect(listMessagesPage(undefined, 0, 0).messages).toHaveLength(1);
    expect(listMessagesPage(undefined, 10_000, 0).messages).toHaveLength(30);
  });

  it("clamps a negative page to the newest one", () => {
    seedMessages(25);
    expect(textsOf(listMessagesPage(undefined, 20, -3)).at(-1)).toBe("msg-25");
  });

  it("truncates a fractional page instead of producing a fractional OFFSET", () => {
    seedMessages(25);
    expect(textsOf(listMessagesPage(undefined, 20, 1.7))).toEqual(textsOf(listMessagesPage(undefined, 20, 1)));
  });
});
