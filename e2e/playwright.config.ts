import { defineConfig } from "@playwright/test";

// E2E specs drive one real Electron instance each against an isolated --user-data-dir (see
// onboarding.spec.ts). They are not browser-context tests, so most of Playwright's `use` surface
// (viewport, browserName, etc.) does not apply here — only the test-runner pieces are used.
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  // One real Electron app per test, launched/closed serially. Parallel workers would each need
  // their own build + userData + no shared singleton state — not worth it for a small suite.
  workers: 1,
  reporter: "list",
});
