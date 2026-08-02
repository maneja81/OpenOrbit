import { useCallback, useContext, useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";
import { KnowledgeFilesContext } from "@/lib/knowledgeFilesContext";

export function useKnowledgeFiles() {
  const [files, setFiles] = useState<KnowledgebaseFileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    hasAgentsAPI() ? null : "Native filesystem bridge unavailable (window.agentsAPI is missing)."
  );

  const refresh = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    const list = await window.agentsAPI.knowledgebase.list();
    setFiles(list);
  }, []);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    window.agentsAPI.knowledgebase.list().then((list) => {
      if (!cancelled) setFiles(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const addFiles = useCallback(
    async (filePaths: string[]) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      setLoading(true);
      const failures: string[] = [];
      for (const filePath of filePaths) {
        try {
          await window.agentsAPI.knowledgebase.add(filePath);
        } catch (e) {
          failures.push(`${filePath}: ${formatHumanizedError(humanizeError(e))}`);
        }
      }
      await refresh();
      setLoading(false);
      if (failures.length > 0) setError(failures.join("\n"));
    },
    [refresh]
  );

  const pickAndAdd = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    setError(null);
    setLoading(true);
    try {
      const { failed } = await window.agentsAPI.knowledgebase.pickAndAdd();
      await refresh();
      if (failed.length > 0) {
        setError(failed.map((f) => `${f.path}: ${f.error}`).join("\n"));
      }
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  /** Grants a folder and pulls it into the list. No separate remove is needed — a folder is an
   * ordinary row here, so removeFile() covers it, and the main process turns that into a revoke
   * rather than a delete. refresh() is what materialises the row: the list handler reconciles
   * against the granted roots, so nothing has to dual-write. */
  const addFolder = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    setError(null);
    setLoading(true);
    try {
      const picked = await window.agentsAPI.fs.pickFolder();
      // Null means the user dismissed the native picker — not an error, and nothing changed.
      if (picked) await refresh();
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const addUrls = useCallback(
    async (urls: string[]) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      setLoading(true);
      try {
        const { failed } = await window.agentsAPI.knowledgebase.addUrls(urls);
        await refresh();
        if (failed.length > 0) {
          setError(failed.map((f) => `${f.url}: ${f.error}`).join("\n"));
        }
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      } finally {
        setLoading(false);
      }
    },
    [refresh]
  );

  const removeFile = useCallback(
    async (id: number) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      try {
        await window.agentsAPI.knowledgebase.remove(id);
        await refresh();
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      }
    },
    [refresh]
  );

  const updateCategory = useCallback(
    async (id: number, category: string) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      try {
        await window.agentsAPI.knowledgebase.updateCategory(id, category);
        await refresh();
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      }
    },
    [refresh]
  );

  const syncOne = useCallback(
    async (id: number) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      try {
        const { missing } = await window.agentsAPI.knowledgebase.sync(id);
        await refresh();
        if (missing.length > 0) {
          setError(`Could not re-sync: ${missing.map((m) => `${m.name} (${m.error})`).join(", ")}`);
        }
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      }
    },
    [refresh]
  );

  const openFile = useCallback(async (filePath: string) => {
    if (!hasAgentsAPI()) return;
    setError(null);
    try {
      await window.agentsAPI.fs.openPath(filePath);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    }
  }, []);

  return {
    files,
    loading,
    error,
    addFiles,
    addFolder,
    addUrls,
    pickAndAdd,
    removeFile,
    updateCategory,
    syncOne,
    openFile,
    refresh,
  };
}

/** Reads the single shared instance provided by AgentsApp — use this (not
 * useKnowledgeFiles directly) in any component/hook that needs to stay in sync with
 * files added or removed elsewhere in the app (widget, modal, app-wide drop). */
export function useSharedKnowledgeFiles() {
  const ctx = useContext(KnowledgeFilesContext);
  if (!ctx) throw new Error("useSharedKnowledgeFiles must be used within a KnowledgeFilesContext.Provider");
  return ctx;
}
