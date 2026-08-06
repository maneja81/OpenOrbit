/**
 * KI-6/KI-1: a model can write its own write_checklist argument JSON as reply text instead
 * of actually calling the tool. Raw JSON must never reach the user (KI-6) — but replacing
 * every leak with one fixed "formatting glitch" apology is also wrong when there was really
 * nothing to relay: a plain "hi" still deserves a real greeting back, not an apology. This
 * repairs the reply instead of just hiding it — a tiny, tool-less agent turns the leaked
 * plan (plus what the user actually said, so the direct-answer case in particular comes out
 * right) into one short natural-language reply.
 *
 * Tool-less by construction (no `tools` passed to the repair Agent) — unlike retrying the
 * whole turn from scratch, this can never re-execute a side-effecting tool call
 * (create_agent, an HTTP write, a location toggle...) a second time, which a full re-run of
 * the same input would risk doing if the leaked turn had already completed one.
 *
 * Kept in its own module (rather than inline in ipc/agent.ts/tasks/scheduler.ts) so it's
 * directly unit-testable — see KI-7: ipc/agent.ts itself has no test file, so logic that
 * needs coverage has to live somewhere that can be tested in isolation.
 */

import { Agent, run, type Model } from "@openai/agents";
import { devLog } from "../devLog";
import { isLeakedChecklistReply } from "./tools/checklistTools";
import type { Agent as AgentType } from "@openai/agents";

const FALLBACK_MESSAGE = "Done — let me know if you'd like more detail.";

/** The tool names an agent could have narrated instead of calling. Read defensively — an
 * Agent's `tools` is public, but a guard whose only job is to sanitize output must never be
 * the thing that throws on an unexpected shape. */
export function toolNamesOf(agent: Pick<AgentType, "tools"> | undefined): string[] {
  try {
    return (agent?.tools ?? []).map((t) => (t as { name?: string }).name).filter((n): n is string => typeof n === "string");
  } catch {
    return [];
  }
}

export async function repairLeakedChecklistReply(
  userInput: string,
  leakedReply: string,
  model: string | Model,
  toolNames: readonly string[] = []
): Promise<string> {
  try {
    const rewriter = new Agent({
      name: "reply-repair",
      instructions:
        "You are shown a plan — either as JSON or as a bare description of a tool call — that was mistakenly sent as a reply instead of a real answer, along with what the user actually said. Write ONE short, natural-language reply to the user now — plain prose only, 1-2 sentences, no JSON, no code, no checklist formatting, and never any mention of tools, plans or checklists. If the plan is just about answering directly (e.g. a greeting or a simple question), answer it yourself in plain language using what the user said.",
      model,
    });
    const result = await run(rewriter, `User said: ${userInput}\n\nLeaked plan (context only, don't repeat it): ${leakedReply}`);
    const text = (result.finalOutput ?? "").trim();
    if (text.length > 0 && !isLeakedChecklistReply(text, toolNames)) return text;
  } catch (e) {
    devLog(`[replyGuard] repair attempt failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return FALLBACK_MESSAGE;
}

/**
 * The single call site ipc/agent.ts and tasks/scheduler.ts both use. Returns `rawOutput`
 * untouched when there's nothing to fix — the common case — so callers can await this
 * unconditionally instead of branching on isLeakedChecklistReply themselves.
 */
export async function guardLeakedChecklistReply(
  rawOutput: string,
  userInput: string,
  model: string | Model,
  logLabel: string,
  toolNames: readonly string[] = []
): Promise<string> {
  if (!isLeakedChecklistReply(rawOutput, toolNames)) return rawOutput;
  devLog(`[replyGuard] ${logLabel} suppressed a leaked write_checklist reply: "${rawOutput}"`);
  return repairLeakedChecklistReply(userInput, rawOutput, model, toolNames);
}
