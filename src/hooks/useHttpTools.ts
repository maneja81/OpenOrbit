import { useCallback, useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";

/** Collections and their endpoints are loaded together and kept in one hook — the Settings
 * UI always renders them nested, and an endpoint is meaningless without the base URL and
 * shared headers of its parent. Mirrors useMcpServers/useConnectors otherwise. */
export function useHttpTools() {
  const [collections, setCollections] = useState<HttpToolCollectionRow[]>([]);
  const [tools, setTools] = useState<HttpToolRow[]>([]);
  const [error, setError] = useState<string | null>(
    hasAgentsAPI() ? null : "Native HTTP tools bridge unavailable (window.agentsAPI is missing)."
  );

  const refresh = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    const [nextCollections, nextTools] = await Promise.all([
      window.agentsAPI.httpTools.listCollections(),
      window.agentsAPI.httpTools.listTools(),
    ]);
    setCollections(nextCollections);
    setTools(nextTools);
  }, []);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    Promise.all([
      window.agentsAPI.httpTools.listCollections(),
      window.agentsAPI.httpTools.listTools(),
    ]).then(([nextCollections, nextTools]) => {
      if (cancelled) return;
      setCollections(nextCollections);
      setTools(nextTools);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Every mutation refreshes both lists rather than patching local state: deleting a
   * collection cascades to its endpoints in the DB, so a local splice would leave orphaned
   * rows on screen. */
  const run = useCallback(
    async <T>(action: () => Promise<T>): Promise<T | undefined> => {
      if (!hasAgentsAPI()) return undefined;
      setError(null);
      try {
        const result = await action();
        await refresh();
        return result;
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
        return undefined;
      }
    },
    [refresh]
  );

  // Parameter types are named globals (src/vite-env.d.ts) rather than
  // `Parameters<typeof window.agentsAPI…>` — the latter puts `window` in the callback's
  // type position, which the React Compiler treats as unpreservable memoization and
  // rejects via react-hooks/preserve-manual-memoization.
  const addCollection = useCallback(
    (input: HttpToolCollectionInput) => run(() => window.agentsAPI.httpTools.createCollection(input)),
    [run]
  );

  const updateCollection = useCallback(
    (id: string, patch: HttpToolCollectionPatch) =>
      run(() => window.agentsAPI.httpTools.updateCollection(id, patch)),
    [run]
  );

  const removeCollection = useCallback(
    (id: string) => run(() => window.agentsAPI.httpTools.deleteCollection(id)),
    [run]
  );

  const addTool = useCallback(
    (input: HttpToolInput) => run(() => window.agentsAPI.httpTools.createTool(input)),
    [run]
  );

  const updateTool = useCallback(
    (id: string, patch: HttpToolPatch) => run(() => window.agentsAPI.httpTools.updateTool(id, patch)),
    [run]
  );

  const removeTool = useCallback((id: string) => run(() => window.agentsAPI.httpTools.deleteTool(id)), [run]);

  const getCollectionHeaders = useCallback(async (id: string): Promise<Record<string, string>> => {
    if (!hasAgentsAPI()) return {};
    setError(null);
    try {
      return await window.agentsAPI.httpTools.getCollectionHeaders(id);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
      return {};
    }
  }, []);

  const getToolHeaders = useCallback(async (id: string): Promise<Record<string, string>> => {
    if (!hasAgentsAPI()) return {};
    setError(null);
    try {
      return await window.agentsAPI.httpTools.getToolHeaders(id);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
      return {};
    }
  }, []);

  // Deliberately does NOT refresh — testing persists nothing, so there is nothing to reload.
  const testTool = useCallback(
    async (input: HttpToolTestInput): Promise<HttpToolTestResult | null> => {
      if (!hasAgentsAPI()) return null;
      setError(null);
      try {
        return await window.agentsAPI.httpTools.testTool(input);
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
        return null;
      }
    },
    []
  );

  const toolsForCollection = useCallback(
    (collectionId: string) => tools.filter((tool) => tool.collection_id === collectionId),
    [tools]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    collections,
    tools,
    toolsForCollection,
    error,
    addCollection,
    updateCollection,
    removeCollection,
    addTool,
    updateTool,
    removeTool,
    getCollectionHeaders,
    getToolHeaders,
    testTool,
    clearError,
  };
}
