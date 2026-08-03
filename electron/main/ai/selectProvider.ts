import { getDb } from "../db";
import { setSetting } from "../db/settingsStore";
import { listVisibleProviders, saveProvider } from "../db/providersStore";
import { findProvider, inferProviderId } from "./providers";
import { readAppSetting } from "../appSettings";
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
  /** Omit to keep the URL already stored for this provider; the provider's own default fills a
   * blank. */
  apiUrl?: string;
  /** Omit to leave the stored key alone — see saveProvider's three-state apiKey. */
  apiKey?: string;
  /** Omit to keep the current model when this provider is already the Chat slot, or to take the
   * provider's default when switching to a different one. */
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

  // Which provider the Chat slot is on *before* this call. An install that predates the registry
  // has no id stored, so it is inferred from the legacy URL — the same rule useProviders.chatSlot
  // uses to decide what to show selected, so the UI and this function agree about what counts as
  // a switch.
  const currentProviderId = readAppSetting("chatProviderId") || inferProviderId(readAppSetting("chatApiUrl"));
  const switchingProvider = currentProviderId !== provider.id;
  const storedUrl = listVisibleProviders().find((row) => row.id === provider.id)?.apiUrl ?? "";

  // An *omitted* field keeps what is already stored; an *explicitly blank* one resets to the
  // provider's default. Those are different intents and collapsing them breaks one of them.
  //
  // Omitted used to fall through to the registry default unconditionally, which made every partial
  // write destructive: the Settings panel saves the key on its own, so rotating a key reset a
  // custom model *and* a custom API URL — on a setup pointed at a private gateway that silently
  // re-aimed the slot at api.openai.com and sent the user's key there.
  //
  // Fixing that with `||` overshot in the other direction: emptying the URL or model field then
  // resolved to the stored value and was silently discarded, while TextField — which only resyncs
  // when the stored value changes — left the box looking empty. The field said one thing and the
  // database held another, with no error. Hence `=== undefined` rather than falsiness.
  const apiUrl =
    selection.apiUrl === undefined ? storedUrl || provider.baseUrl : selection.apiUrl.trim() || provider.baseUrl;
  // A hosted provider always has a default URL to fall back on; `local` does not, because only
  // the user knows where their server is.
  if (apiUrl === "") throw new Error(`${provider.label} needs an API URL.`);
  const urlCheck = validateSettingValue("chatApiUrl", apiUrl);
  if (!urlCheck.ok) throw new Error(`That API URL ${urlCheck.reason}.`);

  // Switching provider still moves the model — that is the whole point of this function, and a
  // model id from the old host is exactly what breaks against the new one. Staying put keeps it.
  const model =
    selection.model === undefined
      ? switchingProvider
        ? provider.defaultChatModel
        : readAppSetting("orchestratorModel")
      : selection.model.trim() || provider.defaultChatModel;
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
