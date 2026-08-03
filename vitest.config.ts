import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  // The renderer reads this as a build-time global (see buildDefines in
  // electron.vite.config.ts), so anything importing AboutTab throws ReferenceError without
  // it. A fixed literal rather than the real `resolveCommit()` on purpose: that shells out to
  // git per run, and a test asserting on whatever commit happens to be checked out is a test
  // that changes meaning between machines.
  define: {
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
    ],
  },
});
