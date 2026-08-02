import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrations";

let db: Database.Database;

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("../db", () => ({ getDb: () => db }));
vi.mock("../db/index", () => ({ getDb: () => db }));

import { ipcMain } from "electron";
import { registerTaskHandlers } from "./tasks";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function handlerFor(channel: string): Handler {
  registerTaskHandlers();
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`${channel} was never registered`);
  return call[1] as Handler;
}

const create = (input: unknown) => handlerFor("tasks:create")(null, input);
const update = (id: unknown, patch: unknown) => handlerFor("tasks:update")(null, id, patch);

describe("tasks IPC input validation", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    // tasks.prompt_target_agent_id is a real foreign key, and migrations don't seed agents.
    db.prepare(
      "INSERT INTO agents (id, name, prompt, model) VALUES ('explorerAgent', 'Explorer', 'p', 'gpt-4.1-mini')"
    ).run();
    vi.mocked(ipcMain.handle).mockClear();
  });

  describe("tasks:create", () => {
    it("creates a task from a valid input", () => {
      const row = create({ title: "Water the plants" }) as { title: string };
      expect(row.title).toBe("Water the plants");
    });

    it("accepts every optional field", () => {
      expect(() =>
        create({
          title: "Weekly digest",
          notes: "n",
          dueAt: "2026-08-03T09:00:00Z",
          prompt: "Summarise the week",
          promptTargetAgentId: "explorerAgent",
          recurrenceIntervalMs: 604800000,
          recurrenceParams: { tone: "brief" },
        })
      ).not.toThrow();
    });

    it("refuses input that isn't a plain object", () => {
      for (const bad of [null, "task", 42, ["title"]]) {
        expect(() => create(bad), String(bad)).toThrow("plain object");
      }
    });

    it("refuses a missing or blank title", () => {
      expect(() => create({})).toThrow("non-empty title");
      expect(() => create({ title: "   " })).toThrow("non-empty title");
      expect(() => create({ title: 42 })).toThrow("non-empty title");
    });

    it("refuses a non-string where a string belongs", () => {
      expect(() => create({ title: "t", notes: 42 })).toThrow("notes must be a string");
      expect(() => create({ title: "t", prompt: {} })).toThrow("prompt must be a string");
    });

    it("refuses a recurrence interval that could never work", () => {
      // It becomes a scheduler delay: zero or negative either never fires or fires continuously.
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "3600000"]) {
        expect(() => create({ title: "t", recurrenceIntervalMs: bad }), String(bad)).toThrow(
          "recurrenceIntervalMs must be a positive number"
        );
      }
    });

    it("refuses recurrence params that aren't a flat string map", () => {
      // They are rendered into the task's prompt, so a nested value would reach the model as
      // "[object Object]".
      expect(() => create({ title: "t", recurrenceParams: "tone=brief" })).toThrow("plain object");
      expect(() => create({ title: "t", recurrenceParams: { tone: { a: 1 } } })).toThrow("values must be strings");
    });
  });

  describe("tasks:update", () => {
    function existingId(): string {
      return (create({ title: "Original" }) as { id: string }).id;
    }

    it("applies a valid patch", () => {
      const id = existingId();
      expect((update(id, { title: "Renamed" }) as { title: string }).title).toBe("Renamed");
    });

    it("refuses a missing or blank id", () => {
      for (const bad of [undefined, "", "  ", 42, null]) {
        expect(() => update(bad, { title: "x" }), String(bad)).toThrow("non-empty task id");
      }
    });

    it("refuses a patch that isn't a plain object", () => {
      expect(() => update(existingId(), null)).toThrow("plain object patch");
      expect(() => update(existingId(), ["title"])).toThrow("plain object patch");
    });

    it("refuses an explicitly blank title", () => {
      // Absent means "unchanged"; blank would leave the task unnamed in every list showing it.
      expect(() => update(existingId(), { title: "" })).toThrow("title cannot be empty");
    });

    it("refuses a status outside the three the store knows", () => {
      expect(() => update(existingId(), { status: "finished" })).toThrow("status must be one of");
      expect(() => update(existingId(), { status: 1 })).toThrow("status must be one of");
    });

    it("accepts each real status", () => {
      for (const status of ["pending", "done", "cancelled"]) {
        expect(() => update(existingId(), { status }), status).not.toThrow();
      }
    });
  });

  describe("tasks:complete and tasks:delete", () => {
    it("refuse a missing or blank id", () => {
      for (const channel of ["tasks:complete", "tasks:delete"]) {
        for (const bad of [undefined, "", 42]) {
          expect(() => handlerFor(channel)(null, bad), `${channel} ${bad}`).toThrow("non-empty task id");
        }
      }
    });

    it("still do their job with a real id", () => {
      const id = (create({ title: "Done soon" }) as { id: string }).id;
      expect((handlerFor("tasks:complete")(null, id) as { status: string }).status).toBe("done");
      expect(() => handlerFor("tasks:delete")(null, id)).not.toThrow();
    });
  });
});
