import { useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";

export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    window.agentsAPI.system.getStats().then((initial) => {
      if (!cancelled) setStats(initial);
    });
    const unsubscribe = window.agentsAPI.system.onStatsUpdate((update) => {
      if (!cancelled) setStats(update);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return stats;
}
