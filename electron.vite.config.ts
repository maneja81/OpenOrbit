import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolveReleaseInfo } from "./scripts/releaseInfo";

// Resolved once per build, never at runtime, so the shipped app makes no release-check
// network call and needs no GitHub token. resolveReleaseInfo never rejects — an offline
// build falls back to 0.0.0 rather than failing (see scripts/releaseInfo.ts).
const release = await resolveReleaseInfo();

/** JSON.stringify is required, not cosmetic: release notes are arbitrary markdown carrying
 * quotes and newlines, which would produce broken JS if substituted raw. */
export const releaseDefines: Record<string, string> = {
  __APP_RELEASE_VERSION__: JSON.stringify(release.version),
  __APP_RELEASE_DATE__: JSON.stringify(release.releaseDate),
  __APP_RELEASE_NOTES__: JSON.stringify(release.releaseNotes),
  __APP_RELEASE_URL__: JSON.stringify(release.releaseUrl),
  __APP_COMMIT__: JSON.stringify(release.commit),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/main",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/main/index.ts"),
          // Separate entry, not imported by index.ts — spawned as its own child process
          // (see ipc/knowledgeBase.ts) so a crash in the legacy .xls parser it wraps
          // can't take down the main process, only that one subprocess.
          xlsWorker: resolve(__dirname, "electron/main/ai/xlsWorker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/preload",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/preload/index.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: ".",
    define: releaseDefines,
    build: {
      outDir: "dist-electron/renderer",
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    server: {
      port: Number(process.env.PORT) || 3100,
    },
  },
});
