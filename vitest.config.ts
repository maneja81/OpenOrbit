import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  // The renderer reads these as build-time globals (see releaseDefines in
  // electron.vite.config.ts), so anything importing AboutTab throws ReferenceError without
  // them. Fixed literals rather than the real `resolveReleaseInfo()` on purpose: that call
  // hits git/network per run, and a test asserting on whatever version happens to be
  // checked out is a test that changes meaning between machines. A non-"0.0.0" version is
  // chosen so the version row renders — AboutTab hides it on the offline-build fallback.
  define: {
    __APP_RELEASE_VERSION__: JSON.stringify("1.2.3"),
    __APP_RELEASE_DATE__: JSON.stringify("2026-08-01T00:00:00Z"),
    __APP_RELEASE_NOTES__: JSON.stringify("Test release notes."),
    __APP_RELEASE_URL__: JSON.stringify("https://example.com/releases/1.2.3"),
    __APP_COMMIT__: JSON.stringify("0000000"),
  },
  test: {
    environment: "jsdom",
    globals: false,
    // Vitest 4 defaults to excluding only node_modules and .git, which leaves two trees of
    // other people's tests in the run — they fail on unresolvable imports and make a green
    // gate indistinguishable from a broken one. Spread the defaults rather than replacing
    // them; passing `exclude` at all overrides the built-in list.
    exclude: [
      ...configDefaults.exclude,
      // Nested git worktrees: full checkouts of this repo, so their test files match the
      // include glob. They resolve `@` against the *root* src via the alias above, so a
      // worktree mid-feature fails on imports that only exist on its own branch.
      "**/.claude/worktrees/**",
      // Gitignored third-party reference material (see .gitignore) — Playwright specs and
      // Next.js sources for a demo app this project doesn't build or depend on.
      "0-cowork/reference/**",
      // Real Electron E2E specs (see e2e/playwright.config.ts) — vitest's default *.spec.ts
      // glob would otherwise pick these up and run them through jsdom via `test.describe()`,
      // which throws immediately since they're written against @playwright/test's runner.
      "e2e/**",
    ],
  },
});
