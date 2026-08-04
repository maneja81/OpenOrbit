import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import {
  launchSandboxedApp,
  launchApp,
  completeOnboarding,
  openSettingsTab,
  clickSelector,
  pickCombobox,
  openDb,
  pollUntil,
} from "./helpers";

const provider = resolveE2EProvider();

test.describe("Settings — Privacy & Safety tab", () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
    await openSettingsTab(page, "Privacy & Safety");
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  function readSetting(key: string): unknown {
    const db = openDb(userData);
    try {
      const row = db.prepare("SELECT setting_value FROM settings WHERE setting_name = ?").get(`appSettings.${key}`) as
        | { setting_value: string }
        | undefined;
      return row ? JSON.parse(row.setting_value) : undefined;
    } finally {
      db.close();
    }
  }

  test("toggles the three approval methods", async () => {
    await clickSelector(page, '[aria-label="Ask before POST requests"]');
    expect(await pollUntil(() => readSetting("httpToolApprovalPost") as boolean | undefined)).toBe(false);

    await clickSelector(page, '[aria-label="Ask before PUT / PATCH requests"]');
    expect(await pollUntil(() => readSetting("httpToolApprovalPutPatch") as boolean | undefined)).toBe(false);

    await clickSelector(page, '[aria-label="Ask before DELETE requests"]');
    expect(await pollUntil(() => readSetting("httpToolApprovalDelete") as boolean | undefined)).toBe(false);
  });

  test("switches the approval display method", async () => {
    await pickCombobox(page, "How to ask for approval", "Card in the chat");
    const value = await pollUntil(() => readSetting("toolApprovalDisplay") as string | undefined);
    expect(value).toBe("inline");
  });

  test("toggles location access and remote image loading", async () => {
    await clickSelector(page, '[aria-label="Toggle location access"]');
    expect(await pollUntil(() => readSetting("locationEnabled") as boolean | undefined)).toBe(true);

    await clickSelector(page, '[aria-label="Toggle automatic remote image loading"]');
    expect(await pollUntil(() => readSetting("remoteImagesAutoLoad") as boolean | undefined)).toBe(true);
  });
});
