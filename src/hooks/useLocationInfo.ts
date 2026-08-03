import { useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";

interface LocationInfo {
  city?: string;
  country?: string;
}

// Calls location:refresh (not just location:get) — useLocation's own one-shot refresh
// (electron/main/ipc/location.ts) runs concurrently in a separate component and involves
// a network round-trip, so a plain location:get here would very often read the cache
// before that refresh finishes and return null forever (this hook never re-checks after
// mount). location:refresh returns the same cached value if already populated, or waits
// out its own fetch otherwise — either way this hook gets the real answer once, no race.
export function useLocationInfo(enabled: boolean): LocationInfo | null {
  const [info, setInfo] = useState<LocationInfo | null>(null);

  useEffect(() => {
    if (!enabled || !hasAgentsAPI()) return;
    let cancelled = false;
    window.agentsAPI.location.refresh().then((location) => {
      if (!cancelled && location) setInfo({ city: location.city, country: location.country });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Derive the disabled state instead of synchronously clearing state in the effect.
  // This also prevents one render of stale location data while the disabling effect runs.
  return enabled && hasAgentsAPI() ? info : null;
}
