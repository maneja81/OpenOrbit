import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import {
  launchSandboxedApp,
  launchApp,
  completeOnboarding,
  openSettingsTab,
  typeIntoField,
  blurActive,
  clickSelector,
  openDb,
  pollUntil,
} from "./helpers";

const provider = resolveE2EProvider();

test.describe("Settings — General tab", () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
    await openSettingsTab(page, "General");
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

  test("commits the name field on blur", async () => {
    await typeIntoField(page, 'input[aria-label="What should I call you?"]', "Renamed Tester");
    await blurActive(page);

    const value = await pollUntil(() => readSetting("userName") as string | undefined);
    expect(value).toBe("Renamed Tester");
  });

  test("toggles voice input and sound effects", async () => {
    await clickSelector(page, '[aria-label="Toggle voice input"]');
    const voiceInput = await pollUntil(() => readSetting("voiceInputEnabled") as boolean | undefined);
    expect(voiceInput).toBe(false);

    await clickSelector(page, '[aria-label="Toggle sound effects"]');
    const soundFx = await pollUntil(() => readSetting("soundFxEnabled") as boolean | undefined);
    expect(soundFx).toBe(false);
  });

  test("rejects an out-of-range agent run timeout and keeps the stored value", async () => {
    const before = readSetting("agentRunTimeoutSeconds");

    await typeIntoField(page, 'input[aria-label="Agent run timeout (seconds)"]', "0");
    await blurActive(page);

    // NumberField validates client-side before ever calling onCommit — an out-of-bounds value
    // never reaches settings:update, so the stored value must be unchanged.
    await page.waitForTimeout(300);
    expect(readSetting("agentRunTimeoutSeconds")).toBe(before);
  });

  test("accepts an in-range agent run timeout", async () => {
    await typeIntoField(page, 'input[aria-label="Agent run timeout (seconds)"]', "45");
    await blurActive(page);

    const value = await pollUntil(() => readSetting("agentRunTimeoutSeconds") as number | undefined);
    expect(value).toBe(45);
  });
});
