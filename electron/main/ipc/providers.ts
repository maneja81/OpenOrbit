import { ipcMain } from "electron";
import { listVisibleProviders, type VisibleProvider } from "../db/providersStore";
import { selectChatProvider, type ChatProviderResult } from "../ai/selectProvider";
import { AI_PROVIDERS, type AiProvider } from "../ai/providers";
import { devLog } from "../devLog";

/**
 * The renderer's view of providers.
 *
 * Two things deliberately never cross this boundary: an API key value, and anything that would
 * let the renderer write credentials one field at a time. `providers:list` returns
 * `{id, apiUrl, keySet}` — the same shape, and the same reasoning, as `settings:get` swapping the
 * keys for `chatApiKeySet`/`voiceApiKeySet`.
 *
 * Selecting a provider is one call rather than several because it has to be: saving the
 * credentials, pointing the Chat slot and re-aligning the agents that follow it are a single
 * change, and a half-applied one leaves the app in exactly the broken state the operation exists
 * to prevent (see ai/selectProvider.ts).
 */

export interface ProvidersSnapshot {
  /** The static registry, so the renderer does not need its own copy over IPC — it has one, but
   * this keeps a mismatch visible rather than silent if they ever diverge. */
  catalog: AiProvider[];
  configured: VisibleProvider[];
}

export function registerProviderHandlers() {
  ipcMain.handle("providers:list", (): ProvidersSnapshot => {
    return { catalog: AI_PROVIDERS, configured: listVisibleProviders() };
  });

  ipcMain.handle(
    "providers:selectChat",
    (
      _event,
      selection: { providerId: string; apiUrl?: string; apiKey?: string; model?: string }
    ): ChatProviderResult => {
      if (typeof selection !== "object" || selection === null) {
        throw new Error("providers:selectChat requires a selection object");
      }
      // Never the key, and never the URL: devLog writes to userData/debug.log, the file users
      // attach to bug reports, and some OpenAI-compatible hosts carry the credential in the
      // URL's query string.
      devLog(`[providers:selectChat] ${selection.providerId} (model "${selection.model ?? "default"}")`);
      // Thrown errors cross IPC as a rejected promise; the renderer surfaces the message, which
      // is why selectChatProvider's messages are written for a person to read.
      return selectChatProvider(selection);
    }
  );
}
