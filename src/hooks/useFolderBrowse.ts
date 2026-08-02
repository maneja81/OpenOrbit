import { useCallback, useRef, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";

/** Folders first, then files, each A–Z. Raw readdir order is arbitrary, which makes a directory
 * of any size hard to scan. */
function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) =>
    a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1
  );
}

/** Browses one level of a granted folder at a time. Deliberately not recursive: fs:readDir goes
 * through the same allowlist guard as every other folder read, and a granted root can hold tens of
 * thousands of entries, so each level is fetched only when the user actually opens it.
 *
 * Loading happens in the open/back handlers rather than an effect. Navigating is a user action,
 * not a subscription to external state, and this project's React Compiler lint rules reject
 * setState called synchronously inside an effect body.
 *
 * `stack` is the trail from the granted root down to the folder on screen — it drives the
 * breadcrumb and makes `back()` a pop instead of a path-string calculation. */
export function useFolderBrowse() {
  const [stack, setStack] = useState<string[]>([]);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opening two folders in quick succession leaves two reads in flight; without this only the
  // last one started may apply its result, so a slow parent can't overwrite a fast child.
  const requestRef = useRef(0);

  const currentPath = stack.length > 0 ? stack[stack.length - 1] : null;

  const loadPath = useCallback(async (path: string, nextStack: string[]) => {
    setStack(nextStack);
    if (!hasAgentsAPI()) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await window.agentsAPI.fs.readDir(path);
      if (request !== requestRef.current) return;
      setEntries(sortEntries(result));
    } catch (e) {
      if (request !== requestRef.current) return;
      // A granted folder can be deleted, unmounted, or become unreadable after it was granted.
      setEntries([]);
      setError(formatHumanizedError(humanizeError(e)));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  const open = useCallback(
    (path: string) => {
      void loadPath(path, [...stack, path]);
    },
    [loadPath, stack]
  );

  const reset = useCallback(() => {
    // Invalidates any read still in flight, so a late result can't repopulate a closed browser.
    requestRef.current++;
    setStack([]);
    setEntries([]);
    setError(null);
    setLoading(false);
  }, []);

  const back = useCallback(() => {
    const nextStack = stack.slice(0, -1);
    const parent = nextStack[nextStack.length - 1];
    if (!parent) {
      reset();
      return;
    }
    void loadPath(parent, nextStack);
  }, [loadPath, reset, stack]);

  return { stack, currentPath, entries, loading, error, open, back, reset };
}
