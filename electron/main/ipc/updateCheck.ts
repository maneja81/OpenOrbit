/**
 * Whether a newer release has been published, checked live once per launch — the build-time
 * check this replaced could only ever compare a build against itself (see
 * scripts/releaseInfo.ts). No auto-download or install: the project isn't code-signed yet, so
 * electron-updater's silent-install path (Squirrel.Mac in particular) can't run on macOS,
 * and shipping it Windows/Linux-only would give a different experience per platform. This
 * only tells the user a release exists; About links out to it.
 */

import { ipcMain } from "electron";
import { resolveReleaseInfo, type ReleaseInfo } from "../../../scripts/releaseInfo";

export function registerUpdateCheckHandlers() {
  ipcMain.handle("app:latestRelease", async (): Promise<ReleaseInfo> => {
    // resolveReleaseInfo() never throws (see scripts/releaseInfo.ts) — an offline or rate
    // limited launch resolves to the "0.0.0" sentinel rather than rejecting the handler.
    const { version, releaseDate, releaseNotes, releaseUrl } = await resolveReleaseInfo();
    return { version, releaseDate, releaseNotes, releaseUrl };
  });
}
