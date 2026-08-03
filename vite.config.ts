import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { buildDefines } from "./electron.vite.config";

export default defineConfig({
  plugins: [react()],
  // Same constant the Electron renderer build injects. `npm run dev:web` renders the same
  // components, so without it __APP_COMMIT__ is an undefined global there.
  define: buildDefines,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: Number(process.env.PORT) || 3100,
  },
});
