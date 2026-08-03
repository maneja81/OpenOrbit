import { ReactNode, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface TooltipProps {
  label: string;
  lines: string[];
  children: ReactNode;
  className?: string;
}

/** Hover-only glass-panel popover, positioned relative to its trigger (the trigger's
 * own nearest positioned ancestor decides the anchor — see .agent-node/#orchestrator,
 * both `position: absolute`). Reuses WidgetCard's glass tokens rather than introducing
 * new ones. Non-interactive content only (no focus handling needed). */
export default function Tooltip({ label, lines, children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className={`tooltip-trigger${className ? ` ${className}` : ""}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      <AnimatePresence>
        {visible && lines.length > 0 && (
          <motion.div
            className="tooltip-panel"
            role="tooltip"
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <div className="tooltip-panel-title">{label}</div>
            <ul className="tooltip-panel-list">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
