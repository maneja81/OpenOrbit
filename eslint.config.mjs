import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
  // Every generated directory in .gitignore, not just `dist` — electron-vite writes all three
  // bundles (main, preload, renderer) to dist-electron, and vitest writes coverage/. Without
  // them, `npm run lint` is clean on a fresh checkout and fails the moment anyone runs
  // `npm run build`, reporting missing-rule errors and unused-disable warnings from bundled
  // third-party code. A lint stage whose answer depends on whether a build has run is worse
  // than no lint stage.
  globalIgnores(["dist", "dist-electron", "coverage", "node_modules", "build"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  }
);
