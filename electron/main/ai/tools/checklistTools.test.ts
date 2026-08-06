import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations";

let db: Database.Database;

vi.mock("../../db/index", () => ({
  getDb: () => db,
}));

import {
  writeChecklist,
  writeChecklistParams,
  isLeakedChecklistJson,
  isLeakedToolNarration,
  isLeakedChecklistReply,
} from "./checklistTools";
import { getChecklistForTrace } from "../../db/checklistStore";

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("writeChecklist (backs the write_checklist tool)", () => {
  it("stores items scoped to the calling agent and trace", async () => {
    const rows = writeChecklist(
      { items: [{ text: "Understand intent", status: "completed" }] },
      "Orbit",
      "trace-1"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_name).toBe("Orbit");
    expect(rows[0].trace_id).toBe("trace-1");
  });

  it("scopes two agents in the same turn to their own separate checklists", () => {
    writeChecklist({ items: [{ text: "Orbit's step", status: "pending" }] }, "Orbit", "trace-1");
    writeChecklist({ items: [{ text: "Cipher's step", status: "pending" }] }, "Cipher", "trace-1");

    const all = getChecklistForTrace("trace-1");
    expect(all.map((r) => `${r.agent_name}: ${r.text}`).sort()).toEqual(["Cipher: Cipher's step", "Orbit: Orbit's step"]);
  });

  it("replaces rather than appends on a second call from the same agent", () => {
    writeChecklist({ items: [{ text: "First plan", status: "pending" }] }, "Orbit", "trace-1");
    writeChecklist({ items: [{ text: "Revised plan", status: "in_progress" }] }, "Orbit", "trace-1");

    const rows = getChecklistForTrace("trace-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("Revised plan");
    expect(rows[0].status).toBe("in_progress");
  });
});

describe("writeChecklistParams schema", () => {
  it("accepts a well-formed checklist", () => {
    const result = writeChecklistParams.safeParse({
      items: [{ text: "Do the thing", status: "pending" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty checklist (clearing it)", () => {
    expect(writeChecklistParams.safeParse({ items: [] }).success).toBe(true);
  });

  it("rejects an unknown status value", () => {
    const result = writeChecklistParams.safeParse({
      items: [{ text: "Do the thing", status: "done" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an item with empty text", () => {
    const result = writeChecklistParams.safeParse({
      items: [{ text: "", status: "pending" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects text over the length cap", () => {
    const result = writeChecklistParams.safeParse({
      items: [{ text: "x".repeat(201), status: "pending" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("isLeakedChecklistJson (KI-6 guard)", () => {
  it("flags a leaked write_checklist argument shape", () => {
    expect(isLeakedChecklistJson('{"items":[{"text":"Check location setting","status":"completed"}]}')).toBe(true);
  });

  it("flags one with surrounding whitespace/newlines", () => {
    expect(isLeakedChecklistJson('\n  {"items":[{"text":"Do it","status":"pending"}]}  \n')).toBe(true);
  });

  it("does not flag ordinary prose", () => {
    expect(isLeakedChecklistJson("Your location setting is currently turned off. Want me to enable it?")).toBe(false);
  });

  it("does not flag prose that merely mentions items/status", () => {
    expect(isLeakedChecklistJson("Here's the status of your items: all good.")).toBe(false);
  });

  it("does not flag unrelated JSON", () => {
    expect(isLeakedChecklistJson('{"temperature": 36, "city": "Delhi"}')).toBe(false);
  });

  it("does not flag malformed JSON", () => {
    expect(isLeakedChecklistJson('{"items":[{"text":"Do it", "status":')).toBe(false);
  });

  it("does not flag an empty string", () => {
    expect(isLeakedChecklistJson("")).toBe(false);
  });
});

describe("isLeakedToolNarration", () => {
  // Seen in production three turns running: the model describes the call instead of making
  // it, and that description becomes the whole user-visible reply. One of those turns had a
  // correct researched answer in hand and shipped this instead.
  it("flags a narrated call with a plan", () => {
    expect(
      isLeakedToolNarration('write_checklist with plan "Tell Mohit his location access is enabled" completed')
    ).toBe(true);
  });

  it("flags the bare narrated call", () => {
    expect(isLeakedToolNarration("write_checklist completed")).toBe(true);
  });

  it("flags it when the tool name is written in backticks", () => {
    expect(isLeakedToolNarration("`write_checklist` completed")).toBe(true);
  });

  it("does not flag a real answer that happens to be short", () => {
    expect(isLeakedToolNarration("You're in Hyderabad, India.")).toBe(false);
  });

  it("does not flag a genuine explanation of what the tool does", () => {
    expect(
      isLeakedToolNarration(
        "write_checklist is the tool I use to publish my plan for a turn, which is what drives the checklist " +
          "widget you can see on the right of the screen while I work through a request for you."
      )
    ).toBe(false);
  });

  it("does not flag a reply that merely mentions the tool later on", () => {
    expect(isLeakedToolNarration("I've enabled it. My plan is tracked with write_checklist as I go.")).toBe(false);
  });

  it("does not flag an empty string", () => {
    expect(isLeakedToolNarration("")).toBe(false);
  });
});

describe("isLeakedChecklistReply (what the guard actually calls)", () => {
  it("catches the JSON shape", () => {
    expect(isLeakedChecklistReply('{"items":[{"text":"Do it","status":"pending"}]}')).toBe(true);
  });

  it("catches the narrated shape", () => {
    expect(isLeakedChecklistReply("write_checklist completed")).toBe(true);
  });

  it("passes an ordinary reply through", () => {
    expect(isLeakedChecklistReply("Your location access is on. Want me to look something up?")).toBe(false);
  });
});

describe("isLeakedToolNarration across an agent's other tools", () => {
  const tools = ["ask_user", "get_current_location", "create_task", "web_search"];

  // write_checklist was only where this showed up first — the prompt demands it hardest.
  // Nothing about narrating a call instead of making it is specific to that tool.
  it("flags a narrated ask_user call", () => {
    expect(isLeakedToolNarration("ask_user completed", tools)).toBe(true);
  });

  it("flags a narrated call with trailing detail", () => {
    expect(isLeakedToolNarration('create_task with title "Call Amar" completed', tools)).toBe(true);
  });

  it("still flags write_checklist when no tool names are supplied", () => {
    expect(isLeakedToolNarration("write_checklist completed")).toBe(true);
  });

  it("does not flag a tool name it wasn't told about", () => {
    expect(isLeakedToolNarration("some_other_tool completed", tools)).toBe(false);
  });

  it("does not flag a real answer that opens with a tool's subject matter", () => {
    expect(isLeakedToolNarration("Web search results are in: three articles cover it.", tools)).toBe(false);
  });

  it("does not flag a genuine sentence that merely ends in a status word", () => {
    expect(isLeakedToolNarration("Your reminder for tomorrow is now updated.", tools)).toBe(false);
  });

  it("treats regex metacharacters in a tool name as literal text", () => {
    expect(isLeakedToolNarration("a.b completed", ["a.b"])).toBe(true);
    expect(isLeakedToolNarration("axb completed", ["a.b"])).toBe(false);
  });
});
