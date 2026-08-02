import { ipcMain, BrowserWindow } from "electron";
import os from "node:os";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readAppSetting } from "../appSettings";

const execFileAsync = promisify(execFile);

export interface SystemStats {
  cpuPct: number;
  ramPct: number;
  ramUsedGB: number;
  ramTotalGB: number;
  diskPct: number;
  diskUsedGB: number;
  diskTotalGB: number;
}

const DEFAULT_POLL_INTERVAL_MS = 3000;

function cpuTimes() {
  return os.cpus().reduce(
    (acc, cpu) => {
      acc.idle += cpu.times.idle;
      acc.total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
      return acc;
    },
    { idle: 0, total: 0 }
  );
}

let lastCpu = cpuTimes();

function readCpuPct(): number {
  const current = cpuTimes();
  const idleDelta = current.idle - lastCpu.idle;
  const totalDelta = current.total - lastCpu.total;
  lastCpu = current;
  if (totalDelta <= 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 100);
}

function readRam() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    ramPct: Math.round((used / total) * 100),
    ramUsedGB: Math.round((used / 1024 ** 3) * 10) / 10,
    ramTotalGB: Math.round((total / 1024 ** 3) * 10) / 10,
  };
}

/** Parses `vm_stat` output into a used-memory figure that matches what macOS's own
 * Activity Monitor / memory-pressure gauge would show — free + inactive + speculative
 * pages are all reclaimable on demand, unlike os.freemem() (readRam above), which only
 * counts strictly-free pages and misleadingly reports near-100% "used" under completely
 * normal load. Verified live on a real dev machine: os.freemem()-based gave 99% used;
 * this calculation gave ~79%, matching the intuitive "under some pressure, not maxed out"
 * reading Activity Monitor would show for the same machine at the same moment. */
export function parseMacMemoryFromVmStat(vmStatOutput: string, totalBytes: number): {
  ramPct: number;
  ramUsedGB: number;
  ramTotalGB: number;
} | null {
  const pageSizeMatch = vmStatOutput.match(/page size of (\d+) bytes/);
  if (!pageSizeMatch) return null;
  const pageSize = parseInt(pageSizeMatch[1], 10);

  const pageCount = (label: string): number => {
    const m = vmStatOutput.match(new RegExp(`${label}:\\s+(\\d+)\\.`));
    return m ? parseInt(m[1], 10) : 0;
  };

  const availablePages = pageCount("Pages free") + pageCount("Pages inactive") + pageCount("Pages speculative");
  const availableBytes = availablePages * pageSize;
  const used = Math.max(0, totalBytes - availableBytes);

  return {
    ramPct: Math.round((used / totalBytes) * 100),
    ramUsedGB: Math.round((used / 1024 ** 3) * 10) / 10,
    ramTotalGB: Math.round((totalBytes / 1024 ** 3) * 10) / 10,
  };
}

async function readMacRam(): Promise<ReturnType<typeof readRam> | null> {
  try {
    const { stdout } = await execFileAsync("vm_stat");
    return parseMacMemoryFromVmStat(stdout, os.totalmem());
  } catch {
    return null;
  }
}

async function readDisk() {
  const stats = await fs.statfs(os.homedir());
  const total = stats.blocks * stats.bsize;
  const free = stats.bavail * stats.bsize;
  const used = total - free;
  return {
    diskPct: Math.round((used / total) * 100),
    diskUsedGB: Math.round((used / 1024 ** 3) * 10) / 10,
    diskTotalGB: Math.round((total / 1024 ** 3) * 10) / 10,
  };
}

async function collectStats(): Promise<SystemStats> {
  const ram = (process.platform === "darwin" ? await readMacRam() : null) ?? readRam();
  const disk = await readDisk();
  return {
    cpuPct: readCpuPct(),
    ...ram,
    ...disk,
  };
}

export function registerSystemStatsHandlers() {
  ipcMain.handle("system:stats", () => collectStats());
}

let broadcastInterval: NodeJS.Timeout | null = null;

// Guards against duplicate intervals stacking (and sending duplicate system:stats-update
// events to every window) if this is ever called more than once in the app's lifetime.
export function startSystemStatsBroadcast() {
  if (broadcastInterval) return;
  const intervalMs = readAppSetting("systemStatsPollIntervalMs", DEFAULT_POLL_INTERVAL_MS);
  broadcastInterval = setInterval(async () => {
    const stats = await collectStats();
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("system:stats-update", stats);
    }
  }, intervalMs);
}

/**
 * Re-reads the interval and rebuilds the timer, so a change in Settings applies immediately.
 *
 * This setting used to be the one place in the app that told the user to restart — the interval
 * was read once at startup, so a new value sat inert until they did. Making it live is a better
 * answer than documenting the wait, and it removes the only "Applies after restarting the app"
 * hint in Settings. `agentRunTimeoutSeconds` and `chatHistoryMessageLimit` are already re-read
 * per run for the same reason; this brings the third numeric tunable in line with them.
 */
export function restartSystemStatsBroadcast() {
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
    broadcastInterval = null;
  }
  startSystemStatsBroadcast();
}
