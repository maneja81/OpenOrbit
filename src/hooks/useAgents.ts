import { useCallback, useEffect, useMemo, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { AgentLayoutItem, computeAgentLayout } from "@/lib/agents";

export function useAgents() {
  const [rawAgents, setRawAgents] = useState<AgentDisplayRow[]>([]);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    window.agentsAPI.agent.list().then((rows) => {
      if (!cancelled) setRawAgents(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetches the full agent list — needed because rows can be created outside this
  // hook's own createAgent() (e.g. Cipher's create_agent tool, called from a chat run),
  // which this hook's local state has no other way of learning about.
  const refreshAgents = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    const rows = await window.agentsAPI.agent.list();
    setRawAgents(rows);
  }, []);

  const updateAgent = useCallback(
    async (
      id: string,
      patch: {
        name?: string;
        tagline?: string;
        description?: string;
        model?: string;
        providerId?: string;
        prompt?: string;
        enabled?: boolean;
        mcpServerIds?: string[];
        connectorIds?: string[];
        httpToolCollectionIds?: string[];
      }
    ) => {
      if (!hasAgentsAPI()) return;
      await window.agentsAPI.agent.update(id, patch);
      // Refetch rather than splice the raw AgentRow update() returns in — toolNames/
      // connectorToolCount are derived server-side (listAgentsForDisplay) and aren't
      // part of that response, and a patch can change mcp_server_ids/connector_ids
      // (connectorToolCount's inputs), so a stale merge could show a wrong count.
      const rows = await window.agentsAPI.agent.list();
      setRawAgents(rows);
    },
    []
  );

  const createAgent = useCallback(
    async (input: {
      name: string;
      icon?: string;
      tagline?: string;
      description?: string;
      model?: string;
        providerId?: string;
      prompt?: string;
    }) => {
      if (!hasAgentsAPI()) return;
      const created = await window.agentsAPI.agent.create(input);
      // Refetch for the same reason as updateAgent above — created is a raw AgentRow,
      // missing the derived toolNames/connectorToolCount fields.
      const rows = await window.agentsAPI.agent.list();
      setRawAgents(rows);
      return created;
    },
    []
  );

  const deleteAgent = useCallback(async (id: string) => {
    if (!hasAgentsAPI()) return;
    await window.agentsAPI.agent.delete(id);
    setRawAgents((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const exportAgent = useCallback(async (id: string) => {
    if (!hasAgentsAPI()) return { canceled: true };
    return window.agentsAPI.agent.exportToFile([id]);
  }, []);

  const exportAllAgents = useCallback(async () => {
    if (!hasAgentsAPI()) return { canceled: true };
    return window.agentsAPI.agent.exportToFile();
  }, []);

  const importAgents = useCallback(async () => {
    if (!hasAgentsAPI()) return [];
    const created = await window.agentsAPI.agent.importFromFile();
    if (created.length > 0) setRawAgents(await window.agentsAPI.agent.list());
    return created;
  }, []);

  // The orbit UI only ever shows delegate-able agents — a disabled agent can't be
  // handed off to (buildOrchestrator excludes it), so it shouldn't appear in orbit either.
  // Memoized so this array's identity is stable across renders when rawAgents hasn't
  // changed — useOrbitScene's effect depends on it, and a fresh array every render
  // would re-trigger that effect (and its setState calls) on every render, forever.
  const agents: AgentLayoutItem[] = useMemo(
    () => computeAgentLayout(rawAgents.filter((a) => a.enabled)),
    [rawAgents]
  );

  return {
    agents,
    rawAgents,
    updateAgent,
    createAgent,
    refreshAgents,
    deleteAgent,
    exportAgent,
    exportAllAgents,
    importAgents,
  };
}
