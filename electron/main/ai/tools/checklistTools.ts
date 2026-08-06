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
/** KI-6: gpt-4.1-mini sometimes writes the write_checklist call's own argument shape as its
 * *reply text* instead of actually invoking the tool — the model treats "report my plan" as
 * something to describe rather than call. Reuses writeChecklistParams itself (the exact
 * shape a real call would validate against) so this can only match a genuine leaked-JSON
 * reply, never misfire on ordinary prose that happens to mention "items" or "status". Used
 * as a last-resort guard at the point a run's finalOutput becomes the user-visible reply
 * (ipc/agent.ts, tasks/scheduler.ts) — prompting alone hasn't reliably prevented this (see
 * KI-1), and showing raw JSON to the user is worse than showing nothing useful at all. */
export function isLeakedChecklistJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  return writeChecklistParams.safeParse(parsed).success;
}

/** The other shape the same failure takes, and the one seen in production far more often
 * than the JSON one: instead of pasting the arguments, the model narrates the call as prose
 * — "write_checklist with plan "…" completed", or just "write_checklist completed" — and
 * that becomes the whole user-visible reply. Three consecutive turns shipped it, including
 * one where a correct researched answer was already in hand and thrown away for this.
 *
 * Takes the tool names actually available to the agent that produced the reply, because
 * nothing about this failure is specific to write_checklist — that is just the tool the
 * prompt demands most insistently, so it is where the behavior showed up first. Any tool
 * can be narrated instead of called. `write_checklist` stays in the set unconditionally so
 * a caller that cannot enumerate its tools still catches the known case.
 *
 * Matched as the whole reply — opens with a bare tool name, carries no sentence break, and
 * closes on a status word — rather than by length, which was the first attempt and wrongly
 * caught a genuine explanation of what a tool does (something the user can legitimately ask
 * for, and which a repair agent would answer worse than the model already did). A real
 * answer never both opens with a tool's name and ends on "completed". */
const NARRATION_STATUS_WORDS = "completed|complete|done|updated|called|executed|finished";

function escapeForRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isLeakedToolNarration(text: string, toolNames: readonly string[] = []): boolean {
  const names = [...new Set(["write_checklist", ...toolNames])].filter((n) => n.length > 0);
  const alternation = names.map(escapeForRegex).join("|");
  const pattern = new RegExp(`^\`?(${alternation})\`?\\b[^.!?]*\\b(${NARRATION_STATUS_WORDS})\\.?$`, "i");
  return pattern.test(text.trim());
}

/** Every shape of the leak — the single check a user-visible reply goes through. */
export function isLeakedChecklistReply(text: string, toolNames: readonly string[] = []): boolean {
  return isLeakedChecklistJson(text) || isLeakedToolNarration(text, toolNames);
}

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
