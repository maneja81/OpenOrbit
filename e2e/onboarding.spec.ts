import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import { launchSandboxedApp, launchApp, completeOnboarding, openDb, pollUntil } from "./helpers";

// Drives the real Electron app through onboarding, selecting whichever provider E2E_PROVIDER
// resolves to (see providerConfig.ts), and asserts the credential landed in the sandbox DB.
// See .claude/skills/run-openorbit/driver.mjs for the manual-REPL version of the same
// sandbox/click/DB-read conventions this spec reuses (now shared with the rest of e2e/ via
// helpers.ts).

// Resolved at module load, not inside a test/hook: a bad or unconfigured E2E_PROVIDER should
// fail the whole suite immediately, not surface as a confusing mid-test failure.
const provider = resolveE2EProvider();

test.describe(`onboarding — ${provider.label}`, () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test(`completes onboarding selecting ${provider.label} and persists the provider`, async () => {
    await completeOnboarding(page, provider);

    // handleOnboardingComplete fires providers.selectChat fire-and-forget (not awaited by the UI),
    // so the DB write can land after the click resolves. Poll rather than assert immediately.
    const row = await pollUntil(() => {
      const db = openDb(userData);
      try {
        return db
          .prepare("SELECT id, api_url, length(api_key) AS keylen FROM providers WHERE id = ?")
          .get(provider.id) as { id: string; api_url: string; keylen: number } | undefined;
      } finally {
        db.close();
      }
    });

    expect(row, `${provider.id} provider row never appeared in the sandbox DB`).toBeDefined();
    expect(row!.keylen).toBeGreaterThan(0);
    expect(row!.api_url).not.toBe("");

    const settingsDb = openDb(userData);
    const chatProviderRow = settingsDb
      .prepare("SELECT setting_value FROM settings WHERE setting_name = ?")
      .get("appSettings.chatProviderId") as { setting_value: string } | undefined;
    settingsDb.close();

    expect(chatProviderRow?.setting_value).toBe(JSON.stringify(provider.id));
  });
});
