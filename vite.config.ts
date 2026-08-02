import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { releaseDefines } from "./electron.vite.config";

export default defineConfig({
  plugins: [react()],
  // Same constants the Electron renderer build injects. `npm run dev:web` renders the same
  // components, so without these every __APP_*__ reference is an undefined global there.
  define: releaseDefines,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: Number(process.env.PORT) || 3100,
  },
});
