import { getDb } from "../db";
import { setSetting } from "../db/settingsStore";
import { saveProvider } from "../db/providersStore";
import { findProvider } from "./providers";
import { validateSettingValue } from "../settingsSchema";
import { devLog } from "../devLog";

/**
 * Pointing the Chat slot at a provider, as one operation.
 *
 * Onboarding and Settings both do the same four things, and doing them separately is what makes a
 * provider switch break the app: the model ids have to move with the provider. Every system agent
 * is seeded carrying the orchestrator's model and no provider of its own, so switching to Claude
 * while leaving them on `gpt-4.1-mini` means four agents asking Anthropic for an OpenAI model.
 * That was observed against a real Ollama server — `404 model 'gpt-4.1-mini' not found`, for
 * agents the user never touched.
 *
 * Agents that carry their own `provider_id` are deliberately untouched: the user chose those,
 * and rewriting them would undo a deliberate decision to run one agent somewhere else.
 */

export interface ChatProviderSelection {
  /** A registry id from ./providers. */
  providerId: string;
  /** Omit to keep whatever URL is stored; the provider's own default fills a blank. */
  apiUrl?: string;
  /** Omit to leave the stored key alone — see saveProvider's three-state apiKey. */
  apiKey?: string;
  /** Omit to take the provider's default model. */
  model?: string;
}

export interface ChatProviderResult {
  providerId: string;
  model: string;
  /** How many inheriting agents were re-pointed at the new model, for the caller to report. */
  updatedAgents: number;
}

export function selectChatProvider(selection: ChatProviderSelection): ChatProviderResult {
  const provider = findProvider(selection.providerId);
  if (!provider) throw new Error(`Unknown provider "${selection.providerId}".`);

  const apiUrl = selection.apiUrl?.trim() ?? provider.baseUrl;
  // A hosted provider always has a default URL to fall back on; `local` does not, because only
  // the user knows where their server is.
  if (apiUrl === "") throw new Error(`${provider.label} needs an API URL.`);
  const urlCheck = validateSettingValue("chatApiUrl", apiUrl);
  if (!urlCheck.ok) throw new Error(`That API URL ${urlCheck.reason}.`);

  const model = selection.model?.trim() || provider.defaultChatModel;
  if (model === "") throw new Error(`${provider.label} needs a model id.`);
  const modelCheck = validateSettingValue("orchestratorModel", model);
  if (!modelCheck.ok) throw new Error(`That model id ${modelCheck.reason}.`);

  if (provider.keyRequired && selection.apiKey !== undefined && selection.apiKey.trim() === "") {
    throw new Error(`${provider.label} needs an API key.`);
  }

  saveProvider(provider.id, {
    apiUrl,
    apiKey: selection.apiKey === undefined ? undefined : selection.apiKey.trim(),
  });

  setSetting("appSettings.chatProviderId", provider.id);
  setSetting("appSettings.orchestratorModel", model);

  // Only rows with no provider of their own — those are the ones that follow the Chat slot and
  // would otherwise be left naming a model the new host has never heard of.
  const updated = getDb()
    .prepare("UPDATE agents SET model = ? WHERE provider_id = '' AND model <> ?")
    .run(model, model);
  const updatedAgents = updated.changes;

  devLog(
    `[providers] chat slot -> ${provider.id} (model "${model}"), ` +
      `${updatedAgents} inheriting agent(s) re-pointed`
  );

  return { providerId: provider.id, model, updatedAgents };
}
