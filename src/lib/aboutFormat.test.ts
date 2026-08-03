import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, formatPlatformName, formatReleaseDate, formatUptime } from "./aboutFormat";

describe("formatBytes", () => {
  it("scales through the units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(19_188_940)).toBe("18.3 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });

  it("renders an empty store honestly rather than hiding it", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("does not produce NaN for missing or negative input", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
  });
});

describe("formatUptime", () => {
  it("formats hours and minutes", () => {
    expect(formatUptime(8_040_000)).toBe("2h 14m");
    expect(formatUptime(720_000)).toBe("12m");
    expect(formatUptime(3_600_000)).toBe("1h 0m");
  });

  it("reads as text below a minute instead of 0m", () => {
    expect(formatUptime(0)).toBe("Less than a minute");
    expect(formatUptime(59_000)).toBe("Less than a minute");
  });
});

describe("formatReleaseDate", () => {
  it("formats an ISO timestamp in a fixed, timezone-independent form", () => {
    expect(formatReleaseDate("2026-07-12T09:30:00Z")).toBe("12 Jul 2026");
    expect(formatReleaseDate("2026-01-01T00:00:00Z")).toBe("1 Jan 2026");
  });

  it("returns empty for the no-release case rather than Invalid Date", () => {
    expect(formatReleaseDate("")).toBe("");
    expect(formatReleaseDate("not a date")).toBe("");
  });
});

describe("formatPlatformName", () => {
  it("maps kernel identifiers to product names", () => {
    expect(formatPlatformName("darwin")).toBe("macOS");
    expect(formatPlatformName("win32")).toBe("Windows");
    expect(formatPlatformName("linux")).toBe("Linux");
  });

  it("passes an unknown platform through rather than blanking it", () => {
    expect(formatPlatformName("freebsd")).toBe("freebsd");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(1204)).toBe("1,204");
    expect(formatCount(0)).toBe("0");
  });
});
