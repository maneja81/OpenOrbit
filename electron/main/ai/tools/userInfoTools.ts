/**
 * Cross-agent memory of facts learned about the user. Every agent (orchestrator, Cipher,
 * Atlas, Explorer, and every custom agent) gets its own bound instance via
 * createSaveUserInfoTool(askedBy) — bound so a fact's provenance (which agent learned it)
 * is recorded correctly regardless of who called it, rather than always attributing it to
 * whichever agent was hardcoded first. Every agent also *reads* the accumulated result via
 * buildOrchestrator()'s prompt-render-time injection (see userInfoStore.ts).
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { appendUserInfoFact } from "../userInfoStore";
import { devLog } from "../../devLog";

// Capped in length, not just the store's fact *count* (userInfoStore.ts's MAX_FACTS)
// — otherwise a single long answer could still inflate the block appended to every
// agent's prompt on every turn. Exported so the cap itself is directly testable
// without reaching into @openai/agents' internal FunctionTool representation.
export const saveUserInfoParams = z.object({
  question: z.string().min(1).max(200).describe("The question that was asked, in plain language."),
  answer: z.string().min(1).max(500).describe("The user's answer."),
});

export async function saveUserInfo(
  { question, answer }: { question: string; answer: string },
  askedBy: string
): Promise<string> {
  devLog(`[save_user_info] called by ${askedBy} with question="${question}"`);
  appendUserInfoFact({ question, answer, askedBy });
  return "Saved.";
}

/** Builds a save_user_info tool instance bound to the calling agent's own name/id, so
 * facts saved by Atlas, the astrologer custom agent, etc. record accurate provenance
 * instead of every fact looking like it came from Cipher. */
export function createSaveUserInfoTool(askedBy: string) {
  return tool({
    name: "save_user_info",
    description:
      "Save one meaningful fact learned about the user during this conversation (e.g. a preference, a recurring detail they'd otherwise have to repeat, or something asked for while setting something up) so every agent — not just this one — can know it going forward. Call once per distinct new fact, not for things already known or already saved.",
    parameters: saveUserInfoParams,
    execute: (args) => saveUserInfo(args, askedBy),
  });
}
