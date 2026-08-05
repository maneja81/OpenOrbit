import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import { launchSandboxedApp, launchApp, completeOnboarding, typeIntoField, openDb, pollUntil } from "./helpers";

// Reproduces the exact user-reported failure: a trivial "hi" hitting the KI-6 leaked-JSON
// guard and getting back a real greeting instead of raw JSON or a generic apology (KI-6's
// repair path, ai/replyGuard.ts). Whether "hi" itself triggers the leak isn't something this
// test controls (that's KI-1's accepted model-behavior variance) — this only asserts what's
// actually guaranteed: never raw JSON, and never empty, whatever gpt-4.1-mini does.

const provider = resolveE2EProvider();

test.describe("reply guard (KI-6/KI-1)", () => {
  test.setTimeout(120_000);

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

  test("a plain greeting never shows raw write_checklist JSON, whatever the model does", async () => {
    await typeIntoField(page, "#inp", "hi");
    await page.keyboard.press("Enter");

    const assistantRow = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const row = db
          .prepare("SELECT text FROM messages WHERE role = 'assistant' ORDER BY id DESC LIMIT 1")
          .get() as { text: string } | undefined;
        return row ? row : undefined;
      } finally {
        db.close();
      }
    }, 90_000);

    expect(assistantRow, "no assistant reply landed in the sandbox DB").toBeDefined();
    const text = assistantRow!.text.trim();
    expect(text.length).toBeGreaterThan(0);
    // The actual regression: this must never be (or start with) the raw write_checklist
    // argument shape, whether the model leaked it or not.
    expect(text.startsWith("{")).toBe(false);
    expect(text).not.toContain('"items":[');
  });
});
