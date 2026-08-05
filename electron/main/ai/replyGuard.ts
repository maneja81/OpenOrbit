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
import { isLeakedChecklistJson } from "./tools/checklistTools";

const FALLBACK_MESSAGE = "Done — let me know if you'd like more detail.";

export async function repairLeakedChecklistReply(userInput: string, leakedJson: string, model: string | Model): Promise<string> {
  try {
    const rewriter = new Agent({
      name: "reply-repair",
      instructions:
        "You are shown a JSON plan that was mistakenly sent as a reply instead of a real answer, along with what the user actually said. Write ONE short, natural-language reply to the user now — plain prose only, 1-2 sentences, no JSON, no code, no checklist formatting. If the plan is just about answering directly (e.g. a greeting or a simple question), answer it yourself in plain language using what the user said.",
      model,
    });
    const result = await run(rewriter, `User said: ${userInput}\n\nLeaked plan (context only, don't repeat it): ${leakedJson}`);
    const text = (result.finalOutput ?? "").trim();
    if (text.length > 0 && !isLeakedChecklistJson(text)) return text;
  } catch (e) {
    devLog(`[replyGuard] repair attempt failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return FALLBACK_MESSAGE;
}

/**
 * The single call site ipc/agent.ts and tasks/scheduler.ts both use. Returns `rawOutput`
 * untouched when there's nothing to fix — the common case — so callers can await this
 * unconditionally instead of branching on isLeakedChecklistJson themselves.
 */
export async function guardLeakedChecklistJson(
  rawOutput: string,
  userInput: string,
  model: string | Model,
  logLabel: string
): Promise<string> {
  if (!isLeakedChecklistJson(rawOutput)) return rawOutput;
  devLog(`[replyGuard] ${logLabel} suppressed a leaked write_checklist JSON reply: "${rawOutput}"`);
  return repairLeakedChecklistReply(userInput, rawOutput, model);
}
