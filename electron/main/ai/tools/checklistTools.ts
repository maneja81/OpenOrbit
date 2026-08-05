/**
 * Lets an agent report its own plan for the current turn — what it's about to do, and its
 * live progress against that — so the renderer can show a checklist widget instead of the
 * user only seeing a final reply with no visibility into what happened in between.
 *
 * Every agent (orchestrator, every built-in specialist, every custom agent) gets its own
 * bound instance via createWriteChecklistTool(agentName, traceId), same shape as
 * createSaveUserInfoTool — bound so a write always lands under the right agent's own slice
 * of the trace (see db/checklistStore.ts's replaceChecklistForAgent), never another agent's.
 *
 * This is self-reported, not ground truth: it records what the model says its plan is, not
 * what it actually executed (that's what agent:stream-step's tool_called/tool_output events
 * are for). The two are meant to be read together, not conflated.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { replaceChecklistForAgent, type ChecklistItemRow } from "../../db/checklistStore";
import { devLog } from "../../devLog";

export const checklistItemStatus = z.enum(["pending", "in_progress", "completed", "cancelled"]);

export const writeChecklistParams = z.object({
  items: z
    .array(
      z.object({
        text: z.string().min(1).max(200).describe("One step, in plain language (e.g. 'Ask the user their budget')."),
        status: checklistItemStatus,
      })
    )
    .describe("The full checklist for this turn, in order — replaces whatever you last wrote, it does not append."),
});

export function writeChecklist(
  { items }: { items: { text: string; status: "pending" | "in_progress" | "completed" | "cancelled" }[] },
  agentName: string,
  traceId: string
): ChecklistItemRow[] {
  devLog(`[write_checklist] ${agentName} wrote ${items.length} item(s) for trace=${traceId}`);
  return replaceChecklistForAgent(traceId, agentName, items);
}

/** Builds a write_checklist tool instance bound to the calling agent's own name and the
 * current turn's traceId, so a write always lands under the right (trace, agent) slice —
 * see replaceChecklistForAgent's own comment for why that scoping matters. */
export function createWriteChecklistTool(agentName: string, traceId: string) {
  return tool({
    name: "write_checklist",
    description:
      "Report your plan for handling this request, and update it as you go. Call this before doing anything else — even a one-item checklist for a direct answer that needs no tools — then call it again whenever your plan changes (e.g. a branch resolves, a step starts, a step finishes) or before your final reply, so every item ends as 'completed' or 'cancelled' rather than left 'pending'. Always send the FULL current checklist — this replaces what you last wrote, it does not append to it.",
    parameters: writeChecklistParams,
    execute: async ({ items }) => {
      const rows = writeChecklist({ items }, agentName, traceId);
      return `Checklist updated: ${rows.length} item(s).`;
    },
  });
}
