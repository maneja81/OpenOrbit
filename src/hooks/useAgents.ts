import { useCallback, useEffect, useMemo, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";
import { AgentLayoutItem, computeAgentLayout } from "@/lib/agents";

export function useAgents() {
  const [rawAgents, setRawAgents] = useState<AgentDisplayRow[]>([]);
  /** Same shape and same formatter as useKnowledgeFiles, useConnectors, useMcpServers and
   * useHttpTools. This was the one data hook with no error state at all: every operation
   * rejected into nothing, so a failed create or delete produced no message and no rollback —
   * the user clicked Delete, the modal closed, and the agent was still there. */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    window.agentsAPI.agent
      .list()
      .then((rows) => {
        if (!cancelled) setRawAgents(rows);
      })
      // Without this the rejection was unhandled and rawAgents stayed [], so the orbit rendered
      // empty — visually identical to a genuinely fresh install. A backend failure looked like
      // normal first-run state.
      .catch((e: unknown) => {
        if (!cancelled) setError(formatHumanizedError(humanizeError(e)));
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
    setError(null);
    try {
      const rows = await window.agentsAPI.agent.list();
      setRawAgents(rows);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    }
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
      setError(null);
      try {
        await window.agentsAPI.agent.update(id, patch);
        // Refetch rather than splice the raw AgentRow update() returns in — toolNames/
        // connectorToolCount are derived server-side (listAgentsForDisplay) and aren't
        // part of that response, and a patch can change mcp_server_ids/connector_ids
        // (connectorToolCount's inputs), so a stale merge could show a wrong count.
        const rows = await window.agentsAPI.agent.list();
        setRawAgents(rows);
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      }
    },
    []
  );

  /** Resolves to the created row, or undefined when it failed — the caller uses that to decide
   * whether to report success. */
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
      setError(null);
      try {
        const created = await window.agentsAPI.agent.create(input);
        // Refetch for the same reason as updateAgent above — created is a raw AgentRow,
        // missing the derived toolNames/connectorToolCount fields.
        const rows = await window.agentsAPI.agent.list();
        setRawAgents(rows);
        return created;
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
        return undefined;
      }
    },
    []
  );

  /** Resolves true only when the row is actually gone. AgentsApp plays a "deleted" sound on
   * the result, and that must not fire on a failure. */
  const deleteAgent = useCallback(async (id: string): Promise<boolean> => {
    if (!hasAgentsAPI()) return false;
    setError(null);
    try {
      await window.agentsAPI.agent.delete(id);
      // Refetch rather than filtering locally, matching updateAgent and createAgent. The local
      // splice removed the row on the strength of the call not throwing; a refetch removes it on
      // the strength of the list actually saying so.
      const rows = await window.agentsAPI.agent.list();
      setRawAgents(rows);
      return true;
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
      return false;
    }
  }, []);

  const exportAgent = useCallback(async (id: string) => {
    if (!hasAgentsAPI()) return { canceled: true };
    setError(null);
    try {
      return await window.agentsAPI.agent.exportToFile([id]);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
      return { canceled: true };
    }
  }, []);

  const exportAllAgents = useCallback(async () => {
    if (!hasAgentsAPI()) return { canceled: true };
    setError(null);
    try {
      return await window.agentsAPI.agent.exportToFile();
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
      return { canceled: true };
    }
  }, []);

  const importAgents = useCallback(async () => {
    if (!hasAgentsAPI()) return [];
    setError(null);
    try {
      const created = await window.agentsAPI.agent.importFromFile();
      if (created.length > 0) setRawAgents(await window.agentsAPI.agent.list());
      return created;
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
      return [];
    }
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
    error,
    updateAgent,
    createAgent,
    refreshAgents,
    deleteAgent,
    exportAgent,
    exportAllAgents,
    importAgents,
  };
}
