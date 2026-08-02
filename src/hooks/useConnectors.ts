import { useCallback, useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";

export function useConnectors() {
  const [connectors, setConnectors] = useState<ConnectorCatalogEntry[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    hasAgentsAPI() ? null : "Native connectors bridge unavailable (window.agentsAPI is missing)."
  );

  const refresh = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    const rows = await window.agentsAPI.connectors.list();
    setConnectors(rows);
  }, []);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    window.agentsAPI.connectors.list().then((rows) => {
      if (!cancelled) setConnectors(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A chat-tool connector mutation (connect_connector/disconnect_connector/
  // attach_connector_to_agent/detach_connector_from_agent) writes straight to the DB from
  // the main process — this hook's local state has no other way to learn a connector
  // changed mid agent-run, so resync when the main process pushes connectors:update.
  // Same pattern as useSettings.ts's settings:update subscription.
  useEffect(() => {
    if (!hasAgentsAPI()) return;
    return window.agentsAPI.connectors.onUpdate(() => {
      refresh();
    });
  }, [refresh]);

  const connect = useCallback(async (id: string) => {
    if (!hasAgentsAPI()) return;
    setError(null);
    setConnectingId(id);
    try {
      const rows = await window.agentsAPI.connectors.connect(id);
      setConnectors(rows);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    } finally {
      setConnectingId(null);
    }
  }, []);

  const disconnect = useCallback(async (id: string) => {
    if (!hasAgentsAPI()) return;
    setError(null);
    try {
      const rows = await window.agentsAPI.connectors.disconnect(id);
      setConnectors(rows);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    }
  }, []);

  const test = useCallback(async (id: string) => {
    if (!hasAgentsAPI()) return null;
    try {
      return await window.agentsAPI.connectors.test(id);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
      return null;
    }
  }, []);

  const getSettings = useCallback(async (id: string): Promise<Record<string, string>> => {
    if (!hasAgentsAPI()) return {};
    try {
      return await window.agentsAPI.connectors.getSettings(id);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
      return {};
    }
  }, []);

  const saveSettings = useCallback(async (id: string, settings: Record<string, string>) => {
    if (!hasAgentsAPI()) return;
    setError(null);
    try {
      const rows = await window.agentsAPI.connectors.saveSettings(id, settings);
      setConnectors(rows);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    }
  }, []);

  return { connectors, connectingId, error, refresh, connect, disconnect, test, getSettings, saveSettings };
}
