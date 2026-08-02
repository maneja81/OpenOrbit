import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

type SpawnOptions = { env: Record<string, string>; stdio: unknown };
type MockChild = EventEmitter & { kill: () => void; killed: boolean; stderr: EventEmitter };

// Typed on the mock rather than its implementation so `.mock.calls[0][2].env` is typed
// without declaring parameters the fake child never reads.
const spawnMock = vi.fn<(command: string, args: string[], options: SpawnOptions) => MockChild>(() => {
  const child = new EventEmitter() as MockChild;
  child.kill = vi.fn();
  child.killed = false;
  // The daemon's stderr is piped and forwarded to devLog, so the fake child needs one.
  child.stderr = new EventEmitter();
  return child;
});
vi.mock("node:child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock,
}));

const createServerMock = vi.fn(() => {
  const server = new EventEmitter() as EventEmitter & {
    listen: (port: number, host: string, cb: () => void) => void;
    close: (cb?: () => void) => void;
    address: () => { port: number };
    unref: () => void;
  };
  server.unref = vi.fn();
  server.address = () => ({ port: 12345 });
  server.listen = (_port: number, _host: string, cb: () => void) => cb();
  server.close = (cb?: () => void) => cb?.();
  return server;
});
vi.mock("node:net", () => ({
  default: { createServer: createServerMock },
  createServer: createServerMock,
}));

// Specifier-aware so a test can make playwright-core resolution fail on its own while
// open-websearch still resolves — that asymmetry is the whole point of the graceful
// degradation path in resolvePlaywrightModulePath.
const resolveMock = vi.hoisted(() =>
  vi.fn((specifier: string) =>
    specifier.startsWith("playwright-core")
      ? "/fake/playwright-core/package.json"
      : "/fake/open-websearch/package.json"
  )
);
vi.mock("node:module", () => ({
  default: { createRequire: () => ({ resolve: resolveMock }) },
  createRequire: () => ({ resolve: resolveMock }),
}));

// Keeps this suite hermetic: devLog reaches for electron's `app` for the userData path,
// which this test has no need to stand up.
const devLogMock = vi.hoisted(() => vi.fn());
vi.mock("../devLog", () => ({ devLog: devLogMock }));

// Browser discovery is a filesystem probe, so the suite decides which browsers "exist".
const existsSyncMock = vi.hoisted(() => vi.fn<(path: string) => boolean>(() => false));
vi.mock("node:fs", () => ({
  default: { existsSync: existsSyncMock },
  existsSync: existsSyncMock,
}));

const fetchMock = vi.fn();

describe("callDaemon", () => {
  beforeEach(async () => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects with a timeout error when the daemon request hangs", async () => {
    // Health check succeeds immediately; the /fetch-web-style call itself hangs.
    fetchMock.mockImplementation((url: string, opts?: { signal?: AbortSignal }) => {
      if (url.endsWith("/health")) return Promise.resolve({ ok: true });
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const { startExplorerDaemon, callDaemon } = await import("./webSearchDaemon");
    await startExplorerDaemon();

    await expect(callDaemon("/fetch-web", { url: "https://example.com" }, 20)).rejects.toThrow(/timed out/);
  });

  it("resolves normally when the daemon responds before the timeout", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/health")) return Promise.resolve({ ok: true });
      return Promise.resolve({ json: async () => ({ status: "ok", data: { hello: "world" } }) });
    });

    const { startExplorerDaemon, callDaemon } = await import("./webSearchDaemon");
    await startExplorerDaemon();

    await expect(callDaemon("/fetch-web", { url: "https://example.com" }, 5000)).resolves.toEqual({
      hello: "world",
    });
  });
});

describe("startExplorerDaemon browser fallback config", () => {
  const DEFAULT_RESOLVE = (specifier: string) =>
    specifier.startsWith("playwright-core")
      ? "/fake/playwright-core/package.json"
      : "/fake/open-websearch/package.json";

  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockClear();
    devLogMock.mockClear();
    resolveMock.mockReset().mockImplementation(DEFAULT_RESOLVE);
    existsSyncMock.mockReset().mockReturnValue(false);
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function spawnedEnv(): Record<string, string> {
    return spawnMock.mock.calls[0][2].env;
  }

  it("hands open-websearch the browser-fallback config, pointing at our playwright-core", async () => {
    const { startExplorerDaemon } = await import("./webSearchDaemon");
    await startExplorerDaemon();

    const env = spawnedEnv();
    expect(env.SEARCH_MODE).toBe("auto");
    expect(env.PLAYWRIGHT_PACKAGE).toBe("playwright-core");
    // Unattended daemon — a visible browser window would be an unexplained popup.
    expect(env.PLAYWRIGHT_HEADLESS).toBe("true");
    expect(env.PLAYWRIGHT_MODULE_PATH).toBe("/fake/playwright-core");
  });

  it("omits PLAYWRIGHT_MODULE_PATH when playwright-core cannot be resolved, leaving the rest intact", async () => {
    // The package is optional in practice: without it open-websearch logs that the client is
    // unavailable and stays request-only, which is the pre-existing behaviour. Passing an
    // empty path instead would look configured and fail later, deeper, and less clearly.
    resolveMock.mockImplementation((specifier: string) => {
      if (specifier.startsWith("playwright-core")) throw new Error("Cannot find module");
      return "/fake/open-websearch/package.json";
    });

    const { startExplorerDaemon } = await import("./webSearchDaemon");
    await startExplorerDaemon();

    const env = spawnedEnv();
    expect(env).not.toHaveProperty("PLAYWRIGHT_MODULE_PATH");
    expect(env.SEARCH_MODE).toBe("auto");
    expect(env.MODE).toBe("http");
    expect(env.DEFAULT_SEARCH_ENGINE).toBe("duckduckgo");
  });

  it("forwards the daemon's stderr to devLog so a silent Playwright failure is visible", async () => {
    const { startExplorerDaemon } = await import("./webSearchDaemon");
    await startExplorerDaemon();

    const child = spawnMock.mock.results[0].value as MockChild;
    child.stderr.emit("data", Buffer.from("Playwright client is unavailable\n"));

    expect(devLogMock).toHaveBeenCalledWith("[open-websearch] Playwright client is unavailable");
  });

  // Regression guard for the bug this was written against: without an explicit executable path,
  // open-websearch's chromium.launch() falls through to Playwright's own bundled browser, which
  // this app never downloads — so every browser retry died with "Executable doesn't exist at
  // ~/Library/Caches/ms-playwright/…" while the client itself resolved fine and looked healthy.
  const CHROME_MAC = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const EDGE_MAC = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";

  async function envWithPlatform(platform: string): Promise<Record<string, string>> {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    try {
      const { startExplorerDaemon } = await import("./webSearchDaemon");
      await startExplorerDaemon();
      return spawnedEnv();
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  }

  it("points the daemon at an installed Chrome rather than a browser we never downloaded", async () => {
    existsSyncMock.mockImplementation((p: string) => p === CHROME_MAC);

    expect((await envWithPlatform("darwin")).PLAYWRIGHT_EXECUTABLE_PATH).toBe(CHROME_MAC);
  });

  it("falls through to Edge when Chrome is not installed", async () => {
    existsSyncMock.mockImplementation((p: string) => p === EDGE_MAC);

    expect((await envWithPlatform("darwin")).PLAYWRIGHT_EXECUTABLE_PATH).toBe(EDGE_MAC);
  });

  it("resolves a Windows install too, so the fallback is not macOS-only", async () => {
    const winChrome = `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`;
    existsSyncMock.mockImplementation((p: string) => p === winChrome);

    expect((await envWithPlatform("win32")).PLAYWRIGHT_EXECUTABLE_PATH).toBe(winChrome);
  });

  it("omits the executable path entirely when no browser is installed", async () => {
    existsSyncMock.mockReturnValue(false);

    const env = await envWithPlatform("darwin");
    expect(env).not.toHaveProperty("PLAYWRIGHT_EXECUTABLE_PATH");
    // Everything else still configured — the daemon just stays on its request-only path.
    expect(env.SEARCH_MODE).toBe("auto");
  });

  it("tags every line of a multi-line stderr chunk, not just the first", async () => {
    // The daemon prints its whole config block in one chunk. Logging the chunk as a single
    // devLog call left lines 2..n in debug.log without the timestamp/[main] prefix that every
    // other line carries — observed in a real run before this was split.
    const { startExplorerDaemon } = await import("./webSearchDaemon");
    await startExplorerDaemon();

    const child = spawnMock.mock.results[0].value as MockChild;
    child.stderr.emit("data", Buffer.from("🔍 Default engine: duckduckgo\n🧭 Playwright headless: true\n"));

    expect(devLogMock).toHaveBeenCalledTimes(2);
    expect(devLogMock).toHaveBeenNthCalledWith(1, "[open-websearch] 🔍 Default engine: duckduckgo");
    expect(devLogMock).toHaveBeenNthCalledWith(2, "[open-websearch] 🧭 Playwright headless: true");
  });

  it("keeps the error headline but drops the object dump that follows it", async () => {
    // devLog is a synchronous appendFileSync per call. One failed Bing request emits ~180 lines
    // of inspected AxiosError; measured over ten searches, 1830 of 1864 stderr lines were that
    // noise. Continuation lines are always indented, so the headline survives and the dump does not.
    const { startExplorerDaemon } = await import("./webSearchDaemon");
    await startExplorerDaemon();

    const child = spawnMock.mock.results[0].value as MockChild;
    child.stderr.emit(
      "data",
      Buffer.from(
        [
          "Request-based Bing search failed, falling back to Playwright mode: AxiosError: 301",
          "    at settle (/x/node_modules/axios/lib/core/settle.js:19:12)",
          "  headers: Object [AxiosHeaders] {",
          "    protocol: 'https:',",
          "  },",
          "}",
          "🧭 Playwright client resolved from PLAYWRIGHT_MODULE_PATH (/x)",
        ].join("\n")
      )
    );

    expect(devLogMock.mock.calls.map((c) => c[0])).toEqual([
      "[open-websearch] Request-based Bing search failed, falling back to Playwright mode: AxiosError: 301",
      "[open-websearch] 🧭 Playwright client resolved from PLAYWRIGHT_MODULE_PATH (/x)",
    ]);
  });

  it("does not log an empty line for a bare newline flush", async () => {
    const { startExplorerDaemon } = await import("./webSearchDaemon");
    await startExplorerDaemon();

    const child = spawnMock.mock.results[0].value as MockChild;
    child.stderr.emit("data", Buffer.from("\n"));

    expect(devLogMock).not.toHaveBeenCalled();
  });
});
