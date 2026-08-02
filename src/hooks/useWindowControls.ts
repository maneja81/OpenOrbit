import { useCallback, useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";

export function useWindowControls() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    const unsubFs = window.agentsAPI.window.onFullscreenChange(setIsFullscreen);
    return () => {
      unsubFs();
    };
  }, []);

  const minimize = useCallback(() => {
    if (hasAgentsAPI()) window.agentsAPI.window.minimize();
  }, []);

  const close = useCallback(() => {
    if (hasAgentsAPI()) window.agentsAPI.window.close();
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (hasAgentsAPI()) window.agentsAPI.window.toggleFullscreen();
  }, []);

  return { isFullscreen, minimize, close, toggleFullscreen };
}
