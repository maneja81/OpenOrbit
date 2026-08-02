import { useCallback, useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { inferProviderId } from "@/lib/providers";

/** One provider's stored configuration, as the renderer is allowed to see it — never the key. */
export interface ConfiguredProvider {
  id: string;
  apiUrl: string;
  keySet: boolean;
}

export interface ChatSlotView {
  /** Always a real provider id, even on an install that predates the registry. */
  providerId: string;
  apiUrl: string;
  keySet: boolean;
}

/**
 * The provider rows behind Settings → AI Models.
 *
 * This exists because the Chat slot's URL and key stopped living in the settings table. After
 * onboarding writes a provider, `chatApiUrl` is empty and `chatApiKeySet` is false — so a
 * Settings screen still bound to those renders a blank URL and claims no key is saved, while the
 * app is running perfectly well on credentials it cannot see. That is a real bug this hook fixes,
 * not a refactor.
 */
export function useProviders(open: boolean) {
  const [configured, setConfigured] = useState<ConfiguredProvider[]>([]);

  const refresh = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    try {
      const snapshot = await window.agentsAPI.providers.list();
      setConfigured(snapshot.configured);
    } catch {
      // Non-fatal: the panel still renders, the fields just show what the legacy settings hold.
      setConfigured([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Deferred out of the effect's synchronous execution for the same reason useSettings does it:
    // react-hooks/set-state-in-effect rejects a setState that lands during the effect body, and
    // the fetch owns its own state transitions anyway.
    const task = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(task);
  }, [open, refresh]);

  /**
   * What the Chat accordion should display, from whichever source actually holds it.
   *
   * `chatProviderId` is `""` until the slot has been moved to the registry, and on that install
   * the legacy pair is still the truth. Rather than showing an empty dropdown, the provider is
   * inferred from the legacy URL using the same rule the migration used to seed these rows.
   */
  const chatSlot = useCallback(
    (chatProviderId: string, legacyUrl: string, legacyKeySet: boolean): ChatSlotView => {
      if (chatProviderId === "") {
        return { providerId: inferProviderId(legacyUrl), apiUrl: legacyUrl, keySet: legacyKeySet };
      }
      const row = configured.find((provider) => provider.id === chatProviderId);
      return { providerId: chatProviderId, apiUrl: row?.apiUrl ?? "", keySet: row?.keySet ?? false };
    },
    [configured]
  );

  /** Applies a change and refreshes, so the fields reflect what was actually stored rather than
   * what was typed — the same reconcile-against-the-write pattern useSettings uses. */
  const selectChat = useCallback(
    async (selection: { providerId: string; apiUrl?: string; apiKey?: string; model?: string }) => {
      if (!hasAgentsAPI()) return;
      const result = await window.agentsAPI.providers.selectChat(selection);
      await refresh();
      return result;
    },
    [refresh]
  );

  return { configured, refresh, chatSlot, selectChat };
}
