import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolveCommit } from "./scripts/releaseInfo";

// The packaged app has no .git dir of its own, so the building machine's commit can only
// ever be captured here, at build time — resolveCommit() returns "" without a .git dir
// (see scripts/releaseInfo.ts) rather than throwing, so an archive-only build still works.
export const buildDefines: Record<string, string> = {
  __APP_COMMIT__: JSON.stringify(resolveCommit()),
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
    define: buildDefines,
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
