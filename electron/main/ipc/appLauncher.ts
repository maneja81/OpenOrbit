import { ipcMain, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface LaunchableApp {
  id: string;
  name: string;
  path: string;
}

const MACOS_APP_DIRS = ["/Applications", `${process.env.HOME}/Applications`];

let discoveredAppsCache: LaunchableApp[] | null = null;

async function discoverMacApps(): Promise<LaunchableApp[]> {
  const apps: LaunchableApp[] = [];
  for (const dir of MACOS_APP_DIRS) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".app")) continue;
      const name = entry.replace(/\.app$/, "");
      const fullPath = path.join(dir, entry);
      apps.push({ id: fullPath, name, path: fullPath });
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverApps(): Promise<LaunchableApp[]> {
  if (discoveredAppsCache) return discoveredAppsCache;
  if (process.platform === "darwin") {
    discoveredAppsCache = await discoverMacApps();
  } else {
    // Windows/Linux discovery not yet implemented — return empty allowlist rather than
    // guessing at an unsafe launch mechanism.
    discoveredAppsCache = [];
  }
  return discoveredAppsCache;
}

export function registerAppLauncherHandlers() {
  ipcMain.handle("apps:list", async (): Promise<LaunchableApp[]> => {
    return discoverApps();
  });

  ipcMain.handle("apps:refresh", async (): Promise<LaunchableApp[]> => {
    discoveredAppsCache = null;
    return discoverApps();
  });

  ipcMain.handle("apps:launch", async (_event, appId: string): Promise<void> => {
    const apps = await discoverApps();
    const target = apps.find((a) => a.id === appId);
    if (!target) {
      throw new Error(`Launch denied: "${appId}" is not in the discovered app allowlist`);
    }
    const result = await shell.openPath(target.path);
    if (result) {
      throw new Error(`Failed to launch "${target.name}": ${result}`);
    }
  });
}
