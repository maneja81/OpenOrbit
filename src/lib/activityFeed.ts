import type { StepEvent } from "@/lib/agents";
import { humanizeToolName } from "@/lib/humanizeToolName";

/** One rendered line of the activity feed. Both display surfaces — the live StepFeed and
 * the per-message "Thinking" panel — render these, so a row reads the same in either. */
export interface ActivityRow {
  type: string;
  label: string;
  agentName?: string;
  durationMs?: number;
}

/** Only these two carry a real tool name. Handoffs arrive as `transfer_to_X` function
 * calls, so relabelling them from `toolName` would turn "Handing off…" into
 * "Transfer To Atlas" and duplicate the "Delegating to X" row AgentsApp already
 * synthesises from agent:stream-agent. */
const TOOL_STEP_TYPES = new Set(["tool_called", "tool_output"]);

/** Step types worth showing in a "Thinking" disclosure (post-hoc or live) — the substantive
 * record of what the run actually did: hand-offs and tool calls. Generic run bookkeeping
 * (message_received/interpreting/responding/responded) stays out, since it carries no
 * information about the work itself and is only meant to drive the live status word/orb
 * animation, not appear as its own row. */
export const THINKING_STEP_TYPES = new Set(["handoff_requested", "handoff_occurred", "tool_called", "tool_output"]);

/** Sub-second work reads better in ms than as "0.3s". Returns "" for values that can't be
 * a real elapsed time, so callers can omit the element entirely rather than print garbage. */
export function formatStepDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Whole-second reading for the "Thinking" toggle's summary line ("Thought for 12s") — that
 * label is about how long the turn took overall, where formatStepDuration's ms/decimal
 * precision (built for a single tool call) would read as noise. Floors at 1s so a
 * sub-second reply doesn't claim to have taken no time at all. */
export function formatThoughtSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

/**
 * Turns raw step events into display rows, 1:1 and in order — StepFeed keys its dot colours
 * off `type` and glows its last entry, so rows are never collapsed or reordered here.
 *
 * A tool_output row gets a duration by pairing back to the nearest earlier tool_called with
 * the same callId; pairing on callId rather than tool name is what keeps two concurrent
 * calls to the same tool from stealing each other's timing.
 */
export function buildActivityRows(steps: StepEvent[]): ActivityRow[] {
  return steps.map((step, index) => {
    const row: ActivityRow = { type: step.type, label: step.label };
    if (TOOL_STEP_TYPES.has(step.type) && step.toolName) {
      row.label = humanizeToolName(step.toolName);
    }
    if (step.agentName) row.agentName = step.agentName;

    if (step.type === "tool_output" && step.callId && step.at !== undefined) {
      for (let i = index - 1; i >= 0; i--) {
        const candidate = steps[i];
        if (candidate.type !== "tool_called" || candidate.callId !== step.callId) continue;
        if (candidate.at !== undefined && step.at >= candidate.at) {
          row.durationMs = step.at - candidate.at;
        }
        break;
      }
    }
    return row;
  });
}
