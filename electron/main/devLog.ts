/**
 * Single-file debug log for diagnosing cross-process bugs (agent runs, tool calls,
 * settings writes) without needing the user to copy-paste terminal/DevTools output —
 * both main and renderer logs land in the same file, in call order, so the whole
 * story of a run is readable end to end.
 *
 * Cleared on every app start (not appended across runs) so a session's log never
 * mixes with a previous one.
 */

import { app } from "electron";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";

let logPath: string | null = null;

export function initDevLog(): void {
  logPath = path.join(app.getPath("userData"), "debug.log");
  writeFileSync(logPath, `=== debug log started ${new Date().toISOString()} ===\n`);
}

export function getDevLogPath(): string {
  return logPath ?? path.join(app.getPath("userData"), "debug.log");
}

function stringifyArg(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Writes to debug.log (main process) and echoes to the terminal — call this instead of
 * console.log for anything you might need to trace later. Never throws: logging must
 * never break the feature it's observing. */
export function devLog(...args: unknown[]): void {
  const line = args.map(stringifyArg).join(" ");
  console.log(line);
  try {
    appendFileSync(getDevLogPath(), `[${new Date().toISOString()}] [main] ${line}\n`);
  } catch {
    // Logging must never crash the app.
  }
}

/** Same as devLog but tagged as coming from the renderer, used by the devLog:write IPC
 * handler so a single file interleaves both processes' logs in call order. */
export function devLogFromRenderer(...args: unknown[]): void {
  const line = args.map(stringifyArg).join(" ");
  console.log(`[renderer] ${line}`);
  try {
    appendFileSync(getDevLogPath(), `[${new Date().toISOString()}] [renderer] ${line}\n`);
  } catch {
    // Logging must never crash the app.
  }
}
