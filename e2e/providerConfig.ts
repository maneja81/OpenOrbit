import { AI_PROVIDERS } from "../electron/main/ai/providers";

// "local" is deliberately excluded: its registry entry has a blank baseUrl/defaultChatModel
// (electron/main/ai/providers.ts) because only a real Ollama install knows those — this harness
// doesn't provision one, so treating it as selectable would fail unpredictably mid-run instead
// of at config-resolution time.
const SUPPORTED = ["openai", "openrouter"] as const;
type SupportedProviderId = (typeof SUPPORTED)[number];

const API_KEY_ENV_VAR: Record<SupportedProviderId, string> = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export interface E2EProviderConfig {
  id: SupportedProviderId;
  label: string;
  apiKey: string;
}

function isSupported(id: string): id is SupportedProviderId {
  return (SUPPORTED as readonly string[]).includes(id);
}

/**
 * Resolves which AI_PROVIDERS entry E2E specs should drive onboarding against, from the
 * E2E_PROVIDER env var (set in .env.test). Fails loudly on a bad or unconfigured choice rather
 * than skipping quietly, so a broken .env.test reads as a broken suite, not a suite with fewer
 * tests than expected.
 */
export function resolveE2EProvider(): E2EProviderConfig {
  const requested = (process.env.E2E_PROVIDER || "openai").trim();
  if (!isSupported(requested)) {
    throw new Error(
      `E2E_PROVIDER="${requested}" is not supported. Use one of: ${SUPPORTED.join(", ")}. ` +
        `"local" is excluded — it needs a running Ollama server this harness doesn't provision.`
    );
  }

  const provider = AI_PROVIDERS.find((p) => p.id === requested);
  if (!provider) {
    throw new Error(`"${requested}" is not in AI_PROVIDERS — e2e/providerConfig.ts and the registry have drifted.`);
  }

  const apiKeyEnvVar = API_KEY_ENV_VAR[requested];
  const apiKey = process.env[apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`E2E_PROVIDER="${requested}" needs ${apiKeyEnvVar} set in .env.test.`);
  }

  return { id: requested, label: provider.label, apiKey };
}
