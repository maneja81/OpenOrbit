import { useCallback, useEffect, useState } from "react";
import { AgentsSettings, SettingsView, mergeWithDefaults } from "@/lib/settings";
import { hasAgentsAPI } from "@/lib/agentsApi";

// Mirrors into userData/debug.log (via the main process) in addition to the browser
// console, so a single file has the full main+renderer story of a run in call order —
// see electron/main/devLog.ts.
function devLog(...args: unknown[]): void {
  console.log(...args);
  if (hasAgentsAPI()) window.agentsAPI.dev.log(...args);
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsView>(mergeWithDefaults({}));
  const [loaded, setLoaded] = useState(() => !hasAgentsAPI());

  const fetchSettings = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    try {
      const raw = await window.agentsAPI.settings.get();
      // No redaction needed any more — settings:get returns chatApiKeySet/voiceApiKeySet
      // booleans rather than the keys themselves.
      devLog("[settings] refreshed from main", raw);
      setSettings(mergeWithDefaults(raw));
    } catch (e) {
      // settings:get can reject (e.g. OS-backed secret decryption failing) — the whole
      // app renders nothing until loaded=true, so we must still flip that even on
      // failure rather than leaving the app blank forever. Fall back to defaults.
      devLog("[settings] failed to load, falling back to defaults", e instanceof Error ? e.message : String(e));
      setSettings(mergeWithDefaults({}));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Start the initial synchronization outside the effect's synchronous execution.
    // fetchSettings itself owns the success/failure state transitions.
    const task = window.setTimeout(() => void fetchSettings(), 0);
    return () => window.clearTimeout(task);
  }, [fetchSettings]);

  // A sub-agent's update_setting tool call (e.g. Cipher renaming the orchestrator) writes
  // straight to the DB, bypassing settings:update entirely — without this subscription the
  // UI has no way to learn a setting changed mid agent-run and silently goes stale even
  // though the agent reports success. See broadcastSettingsUpdate in electron/main/ipc/agent.ts.
  useEffect(() => {
    if (!hasAgentsAPI()) return;
    return window.agentsAPI.settings.onUpdate(() => {
      devLog("[settings] received settings:update push, refetching");
      fetchSettings();
    });
  }, [fetchSettings]);

  const updateSettings = useCallback((patch: Partial<AgentsSettings>) => {
    if (!hasAgentsAPI()) {
      setSettings((prev) => ({ ...prev, ...patch }));
      return;
    }
    let previous: SettingsView | undefined;
    setSettings((prev) => {
      previous = prev;
      return { ...prev, ...patch };
    });
    window.agentsAPI.settings.update(patch).then(
      (authoritative) => {
        // settings:update returns the authoritative post-write state (e.g. it silently
        // drops locked keys like orchestratorEnabled) — reconcile with that rather than
        // trusting the optimistic patch forever, so a locked/rejected field doesn't sit
        // showing a value that was never actually persisted until the next unrelated refetch.
        setSettings(mergeWithDefaults(authoritative));
      },
      (e) => {
        // Optimistic update already applied above — if the main-process write actually
        // failed, revert rather than leaving the UI showing a value that was never
        // persisted (e.g. onboardingDone silently not saved, so onboarding re-appears
        // on next launch out of sync with what the screen just showed).
        devLog("[settings] update failed, reverting", e instanceof Error ? e.message : String(e));
        if (previous) setSettings(previous);
      }
    );
  }, []);

  const resetSettings = useCallback(async () => {
    if (hasAgentsAPI()) await window.agentsAPI.settings.reset();
    setSettings(mergeWithDefaults({}));
  }, []);

  return { settings, updateSettings, resetSettings, loaded };
}
