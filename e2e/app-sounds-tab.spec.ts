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

test.describe("Settings — App Sounds tab", () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
    await openSettingsTab(page, "App Sounds");
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

  test("switches a sound variant", async () => {
    await pickCombobox(page, "Message sent variant", "Variant 2");
    const value = await pollUntil(() => readSetting("soundVariantSend") as number | undefined);
    expect(value).toBe(2);
  });

  test("preview button does not throw", async () => {
    // Audio.play() in a headless/CI Electron environment commonly rejects (autoplay policy, no
    // output device) — previewSound() swallows that (.catch(() => {})), so the only thing worth
    // asserting is that the click itself doesn't surface a renderer error.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await clickSelector(page, '[aria-label="Preview Message sent"]');
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
});
