import { useCallback, useEffect, useRef, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";

export function useAppLauncher() {
  const [apps, setApps] = useState<LaunchableApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    hasAgentsAPI() ? null : "Native app bridge unavailable (window.agentsAPI is missing)."
  );
  // Guards against a fast double-refresh (e.g. a double-click) applying a stale response
  // that resolves after a newer one, matching the cancellation pattern already used for
  // the mount-time list() effect below.
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    const seq = ++refreshSeq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await window.agentsAPI.apps.refresh();
      if (seq === refreshSeq.current) setApps(list);
    } catch (e) {
      if (seq === refreshSeq.current) setError(formatHumanizedError(humanizeError(e)));
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    window.agentsAPI.apps.list().then((list) => {
      if (!cancelled) setApps(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const launch = useCallback(async (appId: string) => {
    if (!hasAgentsAPI()) return;
    setError(null);
    try {
      await window.agentsAPI.apps.launch(appId);
    } catch (e) {
      setError(formatHumanizedError(humanizeError(e)));
    }
  }, []);

  return { apps, loading, error, refresh, launch };
}
