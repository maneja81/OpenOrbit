import { describe, expect, it } from "vitest";
import { formatRemaining, formatApprovalWindow, hasExpired } from "./approvalCountdown";

describe("formatRemaining", () => {
  it("formats minutes and seconds with a padded seconds field", () => {
    expect(formatRemaining(5 * 60 * 1000)).toBe("5:00");
    expect(formatRemaining(4 * 60 * 1000 + 9000)).toBe("4:09");
    expect(formatRemaining(20_000)).toBe("0:20");
  });

  it("rounds up, so a live clock never shows 0:00 while time remains", () => {
    expect(formatRemaining(1)).toBe("0:01");
    expect(formatRemaining(999)).toBe("0:01");
  });

  it("floors at 0:00 rather than going negative", () => {
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-5000)).toBe("0:00");
  });
});

describe("formatApprovalWindow", () => {
  // The whole point of this helper: the duration comes from the deadline main sent, so a
  // changed APPROVAL_TIMEOUT_MS can't leave the copy claiming something else.
  it("names whole minutes in minutes", () => {
    expect(formatApprovalWindow(5 * 60 * 1000)).toBe("5 minutes");
    expect(formatApprovalWindow(60 * 1000)).toBe("1 minute");
  });

  it("names sub-minute windows in seconds", () => {
    expect(formatApprovalWindow(20 * 1000)).toBe("20 seconds");
    expect(formatApprovalWindow(1000)).toBe("1 second");
  });

  it("keeps ragged durations in seconds rather than rounding to a wrong minute count", () => {
    expect(formatApprovalWindow(90 * 1000)).toBe("90 seconds");
    expect(formatApprovalWindow(150 * 1000)).toBe("150 seconds");
  });

  it("does not go negative", () => {
    expect(formatApprovalWindow(-1000)).toBe("0 seconds");
  });
});

describe("hasExpired", () => {
  it("is true at and past the deadline", () => {
    expect(hasExpired(1000, 1000)).toBe(true);
    expect(hasExpired(1000, 1001)).toBe(true);
  });

  it("is false before it", () => {
    expect(hasExpired(1000, 999)).toBe(false);
  });
});
