import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import {
  launchSandboxedApp,
  launchApp,
  completeOnboarding,
  clickSelector,
  clickByText,
  selectComboboxOption,
  typeIntoNth,
  openDb,
  pollUntil,
} from "./helpers";

// discoverLinks is a real fetch — POSTed to the local open-websearch daemon (started at app
// launch, electron/main/index.ts) which does the actual outbound HTTP fetch + link extraction of
// the URL given. example.com is used deliberately: a static IANA page with no outbound links, no
// JS rendering and no cookie gate, so the daemon's fast request-only path handles it and the
// discovered-links assertions are stable (both link sections empty). See
// 0-cowork/plans/active/e2e-full-coverage.md Phase 3.

const provider = resolveE2EProvider();
const SEED_URL = "https://example.com";

test.describe("Knowledge base — Add from URL", () => {
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

  test("discovers links for a real URL and adds the seed page as a knowledge file", async () => {
    await clickSelector(page, '[aria-label="Add to knowledge base"]');
    await selectComboboxOption(page, "URL");
    await page.waitForSelector('[role="dialog"][aria-label="Add from URL"]', { timeout: 10_000 });

    await typeIntoNth(page, ".au-field", "input", 0, SEED_URL);
    await clickByText(page, "Fetch page", ".km-body");

    // The daemon fetch is a real network round trip — give it real time, and tolerate the
    // daemon's own startup health-check window right after a fresh onboarding.
    await page.waitForSelector(".au-section", { timeout: 30_000 });

    const errorText = await page.evaluate(() => document.querySelector(".widget-error")?.textContent ?? "");
    expect(errorText, "discoverLinks reported an error for a known-good URL").toBe("");

    // Seed URL's own checkbox is pre-checked by default — confirm with that selection.
    await clickByText(page, "Add 1 selected", ".km-body");

    // handleConfirm is fire-and-forget (see AddUrlModal.tsx) — poll the DB rather than the click.
    // addUrl() re-fetches through the daemon a second time (it doesn't reuse discoverLinks'
    // result), so this is a second real network round trip on top of the one above. The daemon
    // normalizes the seed URL (trailing slash added), so match with LIKE rather than exact equal.
    const row = await pollUntil(() => {
      const db = openDb(userData);
      try {
        return db.prepare("SELECT id, title, source_url FROM knowledge_files WHERE source_url LIKE ?").get(`${SEED_URL}%`) as
          | { id: string; title: string; source_url: string }
          | undefined;
      } finally {
        db.close();
      }
    }, 30_000);
    expect(row, "discovered URL was never added as a knowledge file").toBeDefined();
    expect(row!.title).toBe("Example Domain");
  });
});
