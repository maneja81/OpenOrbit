import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const resolveBrowserExecutableMock = vi.fn<() => string | null>(() => "/fake/chrome");
vi.mock("./browserExecutable", () => ({
  resolveBrowserExecutable: () => resolveBrowserExecutableMock(),
}));

vi.mock("../appDirs", () => ({
  getBrowserProfileDir: () => "/fake/profile-dir",
}));

const devLogMock = vi.fn();
vi.mock("../devLog", () => ({ devLog: (msg: string) => devLogMock(msg) }));

// A minimal fake Page/BrowserContext — only the members browserSession.ts actually calls.
function makeFakePage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isClosed: () => false,
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue("Fake Title"),
    url: vi.fn(() => "https://example.com/"),
    ariaSnapshot: vi.fn().mockResolvedValue('button "Reply" [ref=e1]'),
    locator: vi.fn((selector: string) => ({
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
      innerText: vi.fn().mockResolvedValue("body text " + selector),
    })),
    mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
    goBack: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFakeContext(page: ReturnType<typeof makeFakePage>) {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    pages: () => [page],
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      (listeners[event] ??= []).push(listener);
    },
    _emit: (event: string) => listeners[event]?.forEach((l) => l()),
  };
}

const launchPersistentContextMock = vi.fn();
vi.mock("playwright-core", () => ({
  chromium: {
    launchPersistentContext: (...args: unknown[]) => launchPersistentContextMock(...args),
  },
}));

describe("browserSession", () => {
  beforeEach(() => {
    vi.resetModules();
    resolveBrowserExecutableMock.mockReset().mockReturnValue("/fake/chrome");
    launchPersistentContextMock.mockReset();
    devLogMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws a clear error when no Chrome/Edge is installed", async () => {
    resolveBrowserExecutableMock.mockReturnValue(null);
    const { navigate } = await import("./browserSession");
    await expect(navigate("https://example.com")).rejects.toThrow(
      /No Chrome or Edge installation found/
    );
    expect(launchPersistentContextMock).not.toHaveBeenCalled();
  });

  it("maps a profile-lock launch failure to a clear tool error", async () => {
    launchPersistentContextMock.mockRejectedValue(new Error("Failed to create SingletonLock"));
    const { navigate } = await import("./browserSession");
    await expect(navigate("https://example.com")).rejects.toThrow(
      /already in use by another task/
    );
  });

  it("rethrows an unrecognized launch failure unchanged", async () => {
    launchPersistentContextMock.mockRejectedValue(new Error("totally different failure"));
    const { navigate } = await import("./browserSession");
    await expect(navigate("https://example.com")).rejects.toThrow("totally different failure");
  });

  it("navigate reuses the same launched context across calls", async () => {
    const page = makeFakePage();
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { navigate } = await import("./browserSession");

    const first = await navigate("https://example.com");
    expect(first).toEqual({ title: "Fake Title", url: "https://example.com/" });
    const second = await navigate("https://example.com/two");
    expect(second.title).toBe("Fake Title");
    expect(launchPersistentContextMock).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it("launches headless: false against the resolved executable and profile dir", async () => {
    const page = makeFakePage();
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { navigate } = await import("./browserSession");
    await navigate("https://example.com");
    expect(launchPersistentContextMock).toHaveBeenCalledWith("/fake/profile-dir", {
      headless: false,
      executablePath: "/fake/chrome",
    });
  });

  it("snapshot returns the page's ariaSnapshot text unchanged", async () => {
    const page = makeFakePage();
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { snapshot } = await import("./browserSession");
    await expect(snapshot()).resolves.toBe('button "Reply" [ref=e1]');
    expect(page.ariaSnapshot).toHaveBeenCalledWith({ mode: "ai" });
  });

  it("clickRef rejects an empty ref before touching the page", async () => {
    const page = makeFakePage();
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { clickRef } = await import("./browserSession");
    await expect(clickRef("")).rejects.toThrow(/call browser_snapshot first/);
  });

  it("clickRef resolves the ref via the aria-ref selector engine", async () => {
    const page = makeFakePage();
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { clickRef } = await import("./browserSession");
    const result = await clickRef("e14");
    expect(page.locator).toHaveBeenCalledWith("aria-ref=e14");
    expect(result).toBe("Clicked e14.");
  });

  it("typeRef fills and, when submit is true, presses Enter", async () => {
    const page = makeFakePage();
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { typeRef } = await import("./browserSession");
    const noSubmit = await typeRef("e2", "hello", false);
    expect(noSubmit).toBe("Typed into e2.");
    const withSubmit = await typeRef("e3", "world", true);
    expect(withSubmit).toBe("Typed into e3 and pressed Enter.");
  });

  it("scroll defaults to 800px and respects direction sign", async () => {
    const page = makeFakePage();
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { scroll } = await import("./browserSession");
    await scroll("down");
    expect(page.mouse.wheel).toHaveBeenCalledWith(0, 800);
    await scroll("up");
    expect(page.mouse.wheel).toHaveBeenCalledWith(0, -800);
    await scroll("down", 250);
    expect(page.mouse.wheel).toHaveBeenCalledWith(0, 250);
  });

  it("readPageText truncates page text past the length cap", async () => {
    const longText = "x".repeat(25_000);
    const page = makeFakePage({
      locator: vi.fn(() => ({ innerText: vi.fn().mockResolvedValue(longText) })),
    });
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { readPageText } = await import("./browserSession");
    const result = await readPageText();
    expect(result.length).toBeLessThan(longText.length);
    expect(result).toContain("[truncated");
  });

  it("readPageText returns short text unchanged", async () => {
    const page = makeFakePage({
      locator: vi.fn(() => ({ innerText: vi.fn().mockResolvedValue("short page") })),
    });
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { readPageText } = await import("./browserSession");
    await expect(readPageText()).resolves.toBe("short page");
  });

  it("goBack navigates and returns the new title/url", async () => {
    const page = makeFakePage();
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { goBack } = await import("./browserSession");
    await expect(goBack()).resolves.toEqual({ title: "Fake Title", url: "https://example.com/" });
    expect(page.goBack).toHaveBeenCalled();
  });

  it("closeBrowserSession is a no-op when nothing was launched", async () => {
    const { closeBrowserSession } = await import("./browserSession");
    await expect(closeBrowserSession()).resolves.toBeUndefined();
    expect(launchPersistentContextMock).not.toHaveBeenCalled();
  });

  it("closeBrowserSession closes the context and clears state so the next call relaunches", async () => {
    const page = makeFakePage();
    const ctx = makeFakeContext(page);
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { navigate, closeBrowserSession } = await import("./browserSession");
    await navigate("https://example.com");
    await closeBrowserSession();
    expect(ctx.close).toHaveBeenCalledTimes(1);

    await navigate("https://example.com");
    expect(launchPersistentContextMock).toHaveBeenCalledTimes(2);
  });

  it("closeBrowserSession swallows a close failure and logs it", async () => {
    const page = makeFakePage();
    const ctx = makeFakeContext(page);
    ctx.close = vi.fn().mockRejectedValue(new Error("already gone"));
    launchPersistentContextMock.mockResolvedValue(ctx);
    const { navigate, closeBrowserSession } = await import("./browserSession");
    await navigate("https://example.com");
    await expect(closeBrowserSession()).resolves.toBeUndefined();
    expect(devLogMock).toHaveBeenCalledWith(expect.stringContaining("already gone"));
  });
});
