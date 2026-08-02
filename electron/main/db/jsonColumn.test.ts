import { beforeEach, describe, expect, it, vi } from "vitest";

const devLogMock = vi.hoisted(() => vi.fn());
vi.mock("../devLog", () => ({ devLog: devLogMock }));

import { parseJsonColumn, UNPARSEABLE } from "./jsonColumn";

describe("parseJsonColumn", () => {
  beforeEach(() => {
    devLogMock.mockClear();
  });

  it("returns the parsed value for valid JSON", () => {
    expect(parseJsonColumn("x", '{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonColumn("x", "[1,2]")).toEqual([1, 2]);
    expect(parseJsonColumn("x", '"str"')).toBe("str");
  });

  it("preserves falsy values rather than treating them as failures", () => {
    expect(parseJsonColumn("x", "false")).toBe(false);
    expect(parseJsonColumn("x", "0")).toBe(0);
    expect(parseJsonColumn("x", '""')).toBe("");
  });

  it("keeps a stored null distinct from a parse failure", () => {
    // The reason UNPARSEABLE is a symbol and not null: null is a legitimate stored value, and
    // returning it on failure would turn a corrupt row into a real one.
    expect(parseJsonColumn("x", "null")).toBeNull();
    expect(parseJsonColumn("x", "null")).not.toBe(UNPARSEABLE);
  });

  it("returns UNPARSEABLE instead of throwing on malformed input", () => {
    expect(parseJsonColumn("x", "{not json")).toBe(UNPARSEABLE);
    expect(parseJsonColumn("x", "")).toBe(UNPARSEABLE);
    expect(parseJsonColumn("x", "undefined")).toBe(UNPARSEABLE);
  });

  it("logs the label and byte count so the row can be found", () => {
    parseJsonColumn("appSettings.broken", "{not json");
    const line = String(devLogMock.mock.calls.at(-1)?.[0]);
    expect(line).toContain("appSettings.broken");
    expect(line).toContain("9 bytes");
  });

  it("never echoes the value it failed to parse", () => {
    // devLog writes to userData/debug.log — the file users attach to bug reports. JSON.parse's
    // own message quotes up to ~30 characters of its input ("Unexpected token 'h',
    // \"https://ap\"… is not valid JSON"), so logging the raw error would put a half-written
    // appSettings.chatApiUrl's credentials on disk.
    parseJsonColumn("appSettings.chatApiUrl", "https://api.example.com/v1?api_key=SUPERSECRETVALUE");

    const line = String(devLogMock.mock.calls.at(-1)?.[0]);
    expect(line).toContain("appSettings.chatApiUrl");
    expect(line).not.toContain("SUPERSECRETVALUE");
    // Not just the secret — no leading fragment either, which is the form the message takes.
    expect(line).not.toContain("https://");
  });

  it("stays silent when the value parses", () => {
    parseJsonColumn("x", "1");
    expect(devLogMock).not.toHaveBeenCalled();
  });
});
