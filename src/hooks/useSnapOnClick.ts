import { MouseEvent } from "react";
import { animate, useMotionValue } from "framer-motion";

const SNAP_MAX = 10;
const SNAP_STRENGTH = 0.18;

/** Subtle click-triggered "snap toward pointer, then settle back" motion for orbit nodes. */
export function useSnapOnClick() {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  function onClick(e: MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = Math.max(-SNAP_MAX, Math.min(SNAP_MAX, (e.clientX - cx) * SNAP_STRENGTH));
    const dy = Math.max(-SNAP_MAX, Math.min(SNAP_MAX, (e.clientY - cy) * SNAP_STRENGTH));

    animate(x, dx, { type: "spring", stiffness: 650, damping: 14 }).then(() =>
      animate(x, 0, { type: "spring", stiffness: 260, damping: 20 })
    );
    animate(y, dy, { type: "spring", stiffness: 650, damping: 14 }).then(() =>
      animate(y, 0, { type: "spring", stiffness: 260, damping: 20 })
    );
  }

  return { x, y, onClick };
}
