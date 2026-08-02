import { useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";

const EMPTY_WEEK: DailyTokenUsage[] = [];

export function useWeeklyActivity() {
  const [days, setDays] = useState<DailyTokenUsage[]>(EMPTY_WEEK);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;

    const fetchDaily = () => {
      window.agentsAPI.tokenUsage.daily().then((data) => {
        if (!cancelled) setDays(data);
      });
    };

    fetchDaily();
    const unsubscribe = window.agentsAPI.tokenUsage.onUpdate(fetchDaily);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return days;
}
