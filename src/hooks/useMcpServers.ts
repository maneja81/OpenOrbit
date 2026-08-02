import { useCallback, useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";

export function useMcpServers() {
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    hasAgentsAPI() ? null : "Native MCP bridge unavailable (window.agentsAPI is missing)."
  );

  const refresh = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    const rows = await window.agentsAPI.mcp.list();
    setServers(rows);
  }, []);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    window.agentsAPI.mcp.list().then((rows) => {
      if (!cancelled) setServers(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const addServer = useCallback(
    async (input: { name: string; command: string; args?: string[]; env?: Record<string, string> }) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      setLoading(true);
      try {
        const created = await window.agentsAPI.mcp.create(input);
        setServers((prev) => [...prev, created]);
        return created;
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const updateServer = useCallback(
    async (
      id: string,
      patch: { name?: string; command?: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }
    ) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      try {
        const updated = await window.agentsAPI.mcp.update(id, patch);
        setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      }
    },
    []
  );

  const getEnv = useCallback(async (id: string): Promise<Record<string, string>> => {
    if (!hasAgentsAPI()) return {};
    try {
      return await window.agentsAPI.mcp.getEnv(id);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
      return {};
    }
  }, []);

  const removeServer = useCallback(async (id: string) => {
    if (!hasAgentsAPI()) return;
    setError(null);
    try {
      await window.agentsAPI.mcp.delete(id);
      await refresh();
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    }
  }, [refresh]);

  const testServer = useCallback(
    async (input: { name: string; command: string; args?: string[]; env?: Record<string, string> }) => {
      if (!hasAgentsAPI()) return null;
      try {
        return await window.agentsAPI.mcp.test(input);
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
        return null;
      }
    },
    []
  );

  const searchRegistry = useCallback(async (query: string) => {
    if (!hasAgentsAPI()) return [];
    try {
      return await window.agentsAPI.mcp.search(query);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
      return [];
    }
  }, []);

  return { servers, loading, error, addServer, updateServer, removeServer, getEnv, testServer, searchRegistry };
}
