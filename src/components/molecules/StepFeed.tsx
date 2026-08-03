import { StepEvent } from "@/lib/agents";
import { buildActivityRows, formatStepDuration } from "@/lib/activityFeed";

interface StepFeedProps {
  steps: StepEvent[];
}

/**
 * Live step progress feed — shown below the last message while a run is active.
 * Renders nothing when steps is empty (hides itself cleanly once the run completes).
 */
export default function StepFeed({ steps }: StepFeedProps) {
  if (steps.length === 0) return null;
  // Rows are built from the whole run, then windowed to the last 4 — windowing first would
  // strand a tool_output whose matching call had already scrolled out of the window.
  const visible = buildActivityRows(steps).slice(-4);
  return (
    <div id="agent-activity-feed" className="step-feed" aria-live="polite" aria-label="Agent progress">
      {visible.map((row, i) => {
        const duration = row.durationMs === undefined ? "" : formatStepDuration(row.durationMs);
        return (
          <div key={i} className={`step-feed-item step-feed-item--${row.type}`}>
            <span className="step-feed-dot" />
            {row.agentName && <span className="step-feed-agent">{row.agentName}</span>}
            <span className="step-feed-label">{row.label}</span>
            {duration && <span className="step-feed-duration">{duration}</span>}
          </div>
        );
      })}
    </div>
  );
}
