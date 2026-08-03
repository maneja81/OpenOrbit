import { describe, expect, it } from "vitest";
import { formatMessageTime } from "./chatTime";

describe("formatMessageTime", () => {
  it("formats an epoch as local hour and minute", () => {
    const stamp = Date.UTC(2026, 7, 1, 14, 15, 30);
    // Asserted against the same locale call rather than a literal like "14:15": the suite
    // runs on whatever timezone and locale the machine has, and a hardcoded string would
    // pass in one CI region and fail in another.
    expect(formatMessageTime(stamp)).toBe(
      new Date(stamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    );
  });

  it("pads the minute to two digits", () => {
    // Built with the local-time constructor, not Date.UTC: the minute has to survive the
    // conversion to be assertable, and a UTC 9:05 lands on :35 in a half-hour-offset zone.
    const stamp = new Date(2026, 7, 1, 9, 5, 0).getTime();
    expect(formatMessageTime(stamp)).toMatch(/\b9:05\b/);
  });

  it("returns nothing for a missing or unparseable stamp", () => {
    // The meta row should drop the time rather than render "Invalid Date". Zero counts as
    // missing here — no real message is stamped at the epoch.
    expect(formatMessageTime(0)).toBe("");
    expect(formatMessageTime(Number.NaN)).toBe("");
    expect(formatMessageTime(-1)).toBe("");
    expect(formatMessageTime(Number.POSITIVE_INFINITY)).toBe("");
  });
});
