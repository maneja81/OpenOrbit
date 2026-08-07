/**
 * Resolves a real, already-installed Chromium-based browser executable, and this app's own
 * `playwright-core` install location — shared by every caller that hands Playwright a browser
 * to drive rather than downloading/shipping one of its own.
 *
 * Extracted out of webSearchDaemon.ts (which resolved these privately for open-websearch's
 * browser fallback) so browserSession.ts can reuse the exact same platform-candidate list
 * without a second, driftable copy of it.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Absolute path to this app's own playwright-core install. Resolution failure is deliberately
 * not fatal — callers degrade to their own request-only/no-browser fallback rather than
 * throwing, same log-and-degrade precedent as connectMcpServersForAgent skipping a server that
 * won't start.
 */
export function resolvePlaywrightModulePath(): string | null {
  try {
    return path.dirname(require.resolve("playwright-core/package.json"));
  } catch {
    return null;
  }
}

/**
 * Candidate paths for an already-installed Chromium-based browser, per platform.
 *
 * Playwright's default `chromium.launch()` looks for its own bundled browser unless given an
 * explicit `executablePath`, and every retry dies with "Executable doesn't exist at
 * ~/Library/Caches/ms-playwright/…" without one. Pointing it at the user's existing browser is
 * what keeps this app from having to download or ship a ~150 MB Chromium of its own.
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

/** First installed browser found, or null when the user has none — callers omit the launch
 * option entirely in that case rather than failing every browser retry. */
export function resolveBrowserExecutable(): string | null {
  for (const candidate of BROWSER_CANDIDATES[process.platform] ?? []) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}
