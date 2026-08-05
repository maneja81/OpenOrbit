import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("../db/checklistStore", () => ({
  getChecklistForTrace: vi.fn(() => []),
}));

import { ipcMain } from "electron";
import { getChecklistForTrace } from "../db/checklistStore";
import { registerChecklistHandlers } from "./checklist";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function handlerFor(channel: string): Handler {
  registerChecklistHandlers();
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`${channel} was never registered`);
  return call[1] as Handler;
}

describe("checklist:get", () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    vi.mocked(getChecklistForTrace).mockClear();
  });

  it("returns the stored checklist for a valid traceId", () => {
    const rows = [
      {
        id: 1,
        trace_id: "trace-1",
        agent_name: "Orbit",
        position: 0,
        text: "Understand intent",
        status: "completed" as const,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ];
    vi.mocked(getChecklistForTrace).mockReturnValueOnce(rows);

    expect(handlerFor("checklist:get")(null, "trace-1")).toEqual(rows);
    expect(getChecklistForTrace).toHaveBeenCalledWith("trace-1");
  });

  it("rejects a missing or non-string traceId rather than passing it through", () => {
    const handler = handlerFor("checklist:get");
    expect(() => handler(null, undefined)).toThrow();
    expect(() => handler(null, "")).toThrow();
    expect(() => handler(null, 42)).toThrow();
    expect(getChecklistForTrace).not.toHaveBeenCalled();
  });
});
