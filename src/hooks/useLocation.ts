import { useEffect } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";

// One-shot capture per enable/launch, not a polling loop — geolocation is meant to
// back an on-demand agent tool (get_current_location), not a live-updating widget.
// IP-based (see electron/main/ipc/location.ts) rather than navigator.geolocation — no OS
// permission prompt required, so this always resolves rather than silently failing in an
// unsigned/dev Electron build.
export function useLocation(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !hasAgentsAPI()) return;
    window.agentsAPI.location.refresh().catch((err) => {
      window.agentsAPI.dev.log("[location] refresh failed", err instanceof Error ? err.message : String(err));
    });
  }, [enabled]);
}
