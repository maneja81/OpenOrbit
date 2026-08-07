import { describe, expect, it, vi, beforeEach } from "vitest";

const existsSyncMock = vi.fn<(path: string) => boolean>(() => false);
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: string) => existsSyncMock(path),
    default: { ...actual, existsSync: (path: string) => existsSyncMock(path) },
  };
});

describe("resolveBrowserExecutable", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    vi.resetModules();
  });

  it("returns the first candidate that exists on this platform", async () => {
    existsSyncMock.mockImplementation((path: string) => path.includes("Google Chrome"));
    const { resolveBrowserExecutable } = await import("./browserExecutable");
    const result = resolveBrowserExecutable();
    if (process.platform === "darwin") {
      expect(result).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    } else {
      // No darwin-named candidate exists on this platform's list — falls through to null.
      expect(result).toBeNull();
    }
  });

  it("returns null when no candidate exists", async () => {
    existsSyncMock.mockImplementation(() => false);
    const { resolveBrowserExecutable } = await import("./browserExecutable");
    expect(resolveBrowserExecutable()).toBeNull();
  });
});

describe("resolvePlaywrightModulePath", () => {
  it("resolves playwright-core's package directory (real dependency, not mocked)", async () => {
    const { resolvePlaywrightModulePath } = await import("./browserExecutable");
    const result = resolvePlaywrightModulePath();
    expect(result).not.toBeNull();
    expect(result).toContain("playwright-core");
  });
});
