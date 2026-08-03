/**
 * Runs `open-websearch` (github.com/aas-ee/open-websearch) as a local HTTP daemon so
 * Explorer's tools can call it over loopback. No API keys — it scrapes public search
 * engines directly. Bound to a dynamically chosen free port to avoid clashing with
 * anything else already using the package's default port (3210/3000).
 */

import { ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { devLog } from "../devLog";

const require = createRequire(import.meta.url);

const OPEN_WEBSEARCH_BIN = path.join(
  path.dirname(require.resolve("open-websearch/package.json")),
  "build",
  "index.js"
);

/**
 * Absolute path to our own playwright-core install, handed to open-websearch as
 * PLAYWRIGHT_MODULE_PATH so its browser fallbacks resolve a client from this app's
 * node_modules rather than searching its own (the package deliberately ships without a
 * Playwright dependency of its own).
 *
 * Resolution failure is deliberately not fatal: open-websearch logs "Playwright client is
 * unavailable, falling back to HTTP-only behavior" and stays on the request-only path,
 * which is exactly the behaviour before this was wired up. Same log-and-degrade precedent
 * as connectMcpServersForAgent skipping a server that won't start.
 */
function resolvePlaywrightModulePath(): string | null {
  try {
    return path.dirname(require.resolve("playwright-core/package.json"));
  } catch {
    return null;
  }
}

const PLAYWRIGHT_MODULE_PATH = resolvePlaywrightModulePath();

/**
 * Candidate paths for an already-installed Chromium-based browser, per platform.
 *
 * open-websearch has an equivalent list internally, but its default `chromium.launch()` passes
 * `executablePath: config.playwrightExecutablePath` with no fallback to it, and the function is
 * not exported — so without PLAYWRIGHT_EXECUTABLE_PATH, Playwright looks for its own bundled
 * browser and every browser retry dies with "Executable doesn't exist at
 * ~/Library/Caches/ms-playwright/…". Pointing it at the user's existing browser is what keeps
 * this app from having to download or ship a ~150 MB Chromium of its own.
 */
const BROWSER_CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  win32: [
    `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/microsoft-edge"],
};

/** First installed browser found, or null when the user has none — in which case the env var is
 * omitted and the daemon stays on its request-only path rather than failing every browser retry. */
function resolveBrowserExecutable(): string | null {
  for (const candidate of BROWSER_CANDIDATES[process.platform] ?? []) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

const BROWSER_EXECUTABLE = resolveBrowserExecutable();

const HEALTH_CHECK_INTERVAL_MS = 300;
const HEALTH_CHECK_TIMEOUT_MS = 15_000;
const STOP_GRACE_PERIOD_MS = 3_000;
const DAEMON_FETCH_TIMEOUT_MS = 30_000;

let daemonProcess: ChildProcess | null = null;
let daemonPort: number | null = null;
let daemonReady: Promise<void> | null = null;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not determine a free port")));
      }
    });
  });
}

async function waitForHealthy(port: number): Promise<void> {
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // Daemon not listening yet — keep polling until the timeout.
    }
    await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
  }
  throw new Error(`open-websearch daemon did not become healthy within ${HEALTH_CHECK_TIMEOUT_MS}ms`);
}

/** Starts the daemon if not already running. Safe to call once at app startup. */
export function startExplorerDaemon(): Promise<void> {
  if (daemonReady) return daemonReady;

  daemonReady = (async () => {
    const port = await getFreePort();
    const child = spawn(process.execPath, [OPEN_WEBSEARCH_BIN, "serve", "--port", String(port)], {
      env: {
        ...process.env,
        // process.execPath is the Electron binary itself, not plain Node — without this,
        // Electron treats the script path as another app to launch instead of running it.
        ELECTRON_RUN_AS_NODE: "1",
        MODE: "http",
        ENABLE_CORS: "false",
        // Stays DuckDuckGo even though the browser fallback below now makes Bing usable at all.
        // Measured over 5 identical dev queries: DuckDuckGo averaged 900ms with 25/25 results in
        // the query's own language; Bing averaged 1313ms and returned 10/25, the rest being
        // Chinese-language pages for English queries. Bing remains reachable per-request via the
        // daemon's `engines` parameter — it is available now, just not the default.
        DEFAULT_SEARCH_ENGINE: "duckduckgo",
        // Request first, browser only as a fallback. This is already open-websearch's
        // default, set explicitly so the contract is visible here and can't drift on a
        // minor upgrade. Note it only affects Bing; /fetch-web gains a browser retry for
        // cookie-gated and JS-rendered pages regardless of the engine above.
        SEARCH_MODE: "auto",
        PLAYWRIGHT_PACKAGE: "playwright-core",
        // This daemon starts unattended at app launch — a visible browser window would be
        // an unexplained popup, so pin headless rather than relying on the upstream default.
        PLAYWRIGHT_HEADLESS: "true",
        // Omitted entirely when playwright-core can't be resolved, so open-websearch falls
        // through to its own lookup and then to request-only, rather than being handed an
        // empty path it would treat as configured.
        ...(PLAYWRIGHT_MODULE_PATH ? { PLAYWRIGHT_MODULE_PATH } : {}),
        // Same omit-when-absent reasoning: no installed browser means no browser retries, not
        // a launch that fails on every call.
        ...(BROWSER_EXECUTABLE ? { PLAYWRIGHT_EXECUTABLE_PATH: BROWSER_EXECUTABLE } : {}),
      },
      // stderr is piped rather than ignored: open-websearch reports which Playwright client
      // it resolved — and, more importantly, its "Playwright client is unavailable, falling
      // back to HTTP-only behavior" warning — on stderr. Discarding it meant a browser
      // fallback that quietly stopped resolving looked identical to one that was working.
      stdio: ["ignore", "ignore", "pipe"],
    });
    // A ChildProcess that fails to spawn (ENOENT, EACCES, EAGAIN under process pressure)
    // emits 'error', and Node throws an uncaught exception for an 'error' event with no
    // listener. Without this, an unspawnable daemon crashed the main process instead of
    // degrading to the "log and carry on" behavior the surrounding comments describe —
    // waitForHealthy below still times out and surfaces normally.
    child.on("error", (e) => devLog(`[open-websearch] failed to spawn: ${e.message}`));
    child.stderr?.on("data", (chunk: Buffer) => {
      // One chunk routinely carries many lines, and devLog writes synchronously — so every line
      // kept here is an appendFileSync on the main process thread. A single failed Bing request
      // emits ~180 lines of inspected AxiosError (sockets, headers, symbols); measured over ten
      // searches, 1830 of 1864 lines were that noise.
      //
      // The daemon's own messages all start at column 0 and continuation lines of an object or
      // stack dump are always indented, so dropping indented lines keeps every real message —
      // including the error headline that introduces such a dump — and discards the rest.
      for (const line of chunk.toString().split("\n")) {
        if (!line || /^\s/.test(line)) continue;
        const trimmed = line.trim();
        // The lone closing brace of a dropped object dump carries nothing on its own.
        if (trimmed && trimmed !== "}") devLog(`[open-websearch] ${trimmed}`);
      }
    });
    daemonProcess = child;
    daemonPort = port;
    try {
      await waitForHealthy(port);
    } catch (e) {
      // A health-check timeout previously left daemonProcess/daemonPort/daemonReady all set,
      // so `if (daemonReady) return daemonReady` on the next call returned this same
      // rejection forever — no retry possible for the rest of the session, and the child kept
      // running, orphaned. Kill it and null out every field so the next call starts fresh.
      child.kill("SIGKILL");
      daemonProcess = null;
      daemonPort = null;
      daemonReady = null;
      throw e;
    }
  })();

  return daemonReady;
}

/** Kills the daemon process. Called on app quit. */
export function stopExplorerDaemon(): void {
  if (!daemonProcess) return;
  const child = daemonProcess;
  daemonProcess = null;
  daemonPort = null;
  daemonReady = null;
  child.kill("SIGTERM");
  setTimeout(() => {
    // child.killed is set to true as soon as a signal is successfully *sent*, not when the
    // process actually exits — checking it here meant this branch could never run, since
    // SIGTERM above already set it. exitCode/signalCode are both null only while the process
    // is still alive, so this is the check that actually reflects whether SIGTERM worked.
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, STOP_GRACE_PERIOD_MS);
}

/** Returns the daemon's port once it's confirmed healthy. Throws if the daemon failed to start. */
export async function getExplorerDaemonPort(): Promise<number> {
  if (!daemonReady) throw new Error("Explorer's web-search daemon was never started");
  await daemonReady;
  if (daemonPort === null) throw new Error("Explorer's web-search daemon is not running");
  return daemonPort;
}

interface DaemonEnvelope<T> {
  status: "ok" | "error";
  data: T | null;
  error: { code: string; message: string } | null;
  hint: string | null;
}

/** Shared by every daemon-backed feature (Explorer's web-search tools, the knowledge
 * base's "Add from URL" flow) — one place that knows how to call the open-websearch
 * daemon and unwrap its response envelope. */
export async function callDaemon<T>(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs: number = DAEMON_FETCH_TIMEOUT_MS
): Promise<T> {
  const port = await getExplorerDaemonPort();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Request to ${endpoint} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const envelope = (await res.json()) as DaemonEnvelope<T>;
  if (envelope.status === "error" || envelope.data === null) {
    throw new Error(envelope.error?.message ?? `Request to ${endpoint} failed with no error detail`);
  }
  return envelope.data;
}
