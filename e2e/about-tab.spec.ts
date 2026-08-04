import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import { launchSandboxedApp, launchApp, completeOnboarding, openSettingsTab } from "./helpers";

// The update check (window.agentsAPI.appInfo.latestRelease()) runs automatically on mount, no
// button to click — a real unauthenticated call to api.github.com/repos/<repo>/releases/latest
// (scripts/releaseInfo.ts). It never throws: offline, timeout, rate-limited, or genuinely no
// releases published all collapse to the same "0.0.0" fallback, so this spec can't assume a
// release exists — only that the tab renders without an error, and conditionally checks the
// release row's shape when one is present. See 0-cowork/plans/active/e2e-full-coverage.md Phase 3.

const provider = resolveE2EProvider();

test.describe("Settings — About tab", () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test("loads without an error and shows build identity", async () => {
    await openSettingsTab(page, "About");

    // "Version" (this build) always renders once appInfo.get() resolves — a stable signal the
    // panel loaded, independent of whether the live release check itself found anything.
    await page.waitForFunction(
      () => document.querySelector(".about-value")?.textContent && document.querySelector(".about-value")?.textContent !== "…",
      { timeout: 15_000 }
    );

    const errorText = await page.evaluate(() => document.querySelector(".settings-error")?.textContent ?? "");
    expect(errorText, "About tab reported an error").toBe("");
  });

  test("shows a well-formed version when the live release check finds one", async () => {
    const releaseVersion = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".row")];
      const row = rows.find((r) => r.querySelector(".row-label")?.textContent?.startsWith("Latest release"));
      return row?.querySelector(".about-value")?.textContent?.trim() ?? null;
    });

    if (releaseVersion === null) {
      test.info().annotations.push({
        type: "note",
        description: "no 'Latest release' row rendered — GitHub API returned no release (rate-limited, offline, or none published)",
      });
      return;
    }
    // Loose shape check only — the actual version string is live data this test doesn't control.
    expect(releaseVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
