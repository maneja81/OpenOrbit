import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import {
  launchSandboxedApp,
  launchApp,
  completeOnboarding,
  openSettingsTab,
  typeIntoLabeledRow,
  clickInLabeledRow,
  typeIntoField,
  blurActive,
  pickCombobox,
  openDb,
  pollUntil,
} from "./helpers";

// Only non-Test-button actions — settings:testChat/testVoice (the "Test" buttons beside the Chat
// provider and Voice rows) are explicitly out of scope here, deferred to Phase 4 alongside the
// live-provider chat flow. See 0-cowork/plans/active/e2e-full-coverage.md.

const provider = resolveE2EProvider();
// A non-chat provider to exercise the plain providers:save path — onboarding always selects
// E2E_PROVIDER as Chat, so any other AI_PROVIDERS entry works here as long as it isn't that one.
const OTHER_PROVIDER_LABEL = provider.id === "openai" ? "OpenRouter" : "OpenAI";

test.describe("Settings — Models tab", () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
    await openSettingsTab(page, "Models");
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  function readProviderRow(id: string): { api_url: string; keylen: number } | undefined {
    const db = openDb(userData);
    try {
      return db.prepare("SELECT api_url, length(api_key) AS keylen FROM providers WHERE id = ?").get(id) as
        | { api_url: string; keylen: number }
        | undefined;
    } finally {
      db.close();
    }
  }

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

  test("saves, then clears, a non-chat provider's API key and URL", async () => {
    await typeIntoLabeledRow(page, ".row-field", `${OTHER_PROVIDER_LABEL} API key`, "sk-e2e-test-key");
    await blurActive(page);

    const saved = await pollUntil(() => {
      const row = readProviderRow(OTHER_PROVIDER_LABEL === "OpenRouter" ? "openrouter" : "openai");
      return row && row.keylen > 0 ? row : undefined;
    });
    expect(saved?.keylen).toBeGreaterThan(0);

    await typeIntoLabeledRow(page, ".row-field", `${OTHER_PROVIDER_LABEL} API URL`, "https://example.com/v1");
    await blurActive(page);
    const withUrl = await pollUntil(() => {
      const row = readProviderRow(OTHER_PROVIDER_LABEL === "OpenRouter" ? "openrouter" : "openai");
      return row?.api_url === "https://example.com/v1" ? row : undefined;
    });
    expect(withUrl?.api_url).toBe("https://example.com/v1");

    await clickInLabeledRow(page, ".row-field", `${OTHER_PROVIDER_LABEL} API key`, "Remove");
    const cleared = await pollUntil(() => {
      const row = readProviderRow(OTHER_PROVIDER_LABEL === "OpenRouter" ? "openrouter" : "openai");
      return row && row.keylen === 0 ? row : undefined;
    });
    expect(cleared?.keylen).toBe(0);
  });

  test("switches the Chat provider slot and updates the Chat model", async () => {
    const targetLabel = OTHER_PROVIDER_LABEL;
    const targetId = targetLabel === "OpenRouter" ? "openrouter" : "openai";

    await pickCombobox(page, "Chat provider", targetLabel);

    // selectChatProvider writes via setSetting, bypassing settings:update, then self-broadcasts —
    // poll the DB rather than the UI so the assertion doesn't depend on catching that broadcast.
    const switched = await pollUntil(() => readSetting("chatProviderId") as string | undefined);
    expect(switched).toBe(targetId);

    await typeIntoField(page, 'input[aria-label="Chat model"]', "test-model-id");
    await blurActive(page);
    const model = await pollUntil(() => readSetting("orchestratorModel") as string | undefined);
    expect(model).toBe("test-model-id");
  });

  test("edits transcription, TTS model, and TTS voice fields", async () => {
    await typeIntoField(page, 'input[aria-label="Transcription model"]', "test-transcription-model");
    await blurActive(page);
    expect(await pollUntil(() => readSetting("voiceTranscriptionModel") as string | undefined)).toBe(
      "test-transcription-model"
    );

    await typeIntoField(page, 'input[aria-label="Speech (TTS) model"]', "test-tts-model");
    await blurActive(page);
    expect(await pollUntil(() => readSetting("voiceTtsModel") as string | undefined)).toBe("test-tts-model");

    const currentVoice = readSetting("voiceTtsVoice") as string;
    const otherVoice = currentVoice === "alloy" ? "echo" : "alloy";
    await pickCombobox(page, "Speech (TTS) voice", otherVoice);
    expect(await pollUntil(() => readSetting("voiceTtsVoice") as string | undefined)).toBe(otherVoice);
  });
});
