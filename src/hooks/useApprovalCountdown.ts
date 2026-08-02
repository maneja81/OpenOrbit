import { useSyncExternalStore } from "react";

/**
 * Milliseconds left until an approval's deadline, refreshed as the clock advances.
 *
 * Written as an external-store subscription rather than useState + useEffect on purpose. The
 * wall clock *is* an external system, and `react-hooks/set-state-in-effect` rejects the
 * setState-inside-an-effect shape that the obvious version needs to re-read on mount and on a
 * changed deadline. useSyncExternalStore gets both for free and re-reads on every render too,
 * so a new approval never briefly shows the previous one's time.
 *
 * The snapshot is quantised to whole seconds. getSnapshot must return a stable value between
 * ticks — a raw Date.now() changes on every call and React treats that as an infinite update
 * loop. Quantising also means the returned figure can sit up to 999ms above the true remaining
 * time, which is invisible once formatRemaining rounds up.
 *
 * Returns null when there is no deadline, so a caller renders nothing rather than a zeroed clock.
 */

/** 250ms, not 1000ms: the snapshot only changes on a second boundary, so polling faster just
 * shortens the lag between the boundary passing and the display catching up. */
function subscribe(onStoreChange: () => void): () => void {
  const id = setInterval(onStoreChange, 250);
  return () => clearInterval(id);
}

function getNowSecond(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}

export function useApprovalCountdown(expiresAt: number | null): number | null {
  const now = useSyncExternalStore(subscribe, getNowSecond, getNowSecond);
  return expiresAt === null ? null : expiresAt - now;
}
