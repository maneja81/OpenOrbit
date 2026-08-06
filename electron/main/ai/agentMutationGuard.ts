/**
 * KI-23: a model can write "the agent is now created" / "has been updated" as its reply text
 * without ever having actually called create_agent/update_agent in that same run —
 * configAgent.md already has an explicit rule against this ("never say the agent has been
 * created unless you've actually called create_agent... and it returned successfully") and
 * it was not enough: reproduced 3 times live against the real OpenAI API in one session,
 * including once where the very next message in the *same conversation* correctly reported
 * the agent didn't exist, directly contradicting the earlier claim.
 *
 * Unlike KI-6's write_checklist leak (a formatting mistake — the model meant to call the
 * tool and pasted its arguments instead), this is a claim about system state that is
 * either true or false and checkable against what the run actually did. So this guard
 * doesn't try to detect and repair *phrasing* — it checks the claim against the run's own
 * tool-call history and only intervenes when the claim is provably false, which is a much
 * narrower and safer trigger than pattern-matching prose ever could be.
 */

import { devLog } from "../devLog";

const MUTATION_TOOL_NAMES = ["create_agent", "update_agent"];

// Deliberately narrow, alternation-based rather than a broad "sounds like success" pattern —
// tuned to the exact phrasings observed plus the obvious variants, not to catch every way a
// model could ever phrase this. A missed claim here is no worse than not having this guard
// at all; a false positive would replace a truthful reply with a needless "let's try again",
// which is the direction to err away from for a guard this narrow in scope.
const MUTATION_CLAIM_PATTERN =
  /\b(is now (created|live)|has (now )?been created|is now updated|has (now )?been updated|is now renamed|has (now )?been renamed)\b/i;

const CORRECTION_MESSAGE =
  "I wasn't actually able to complete that — the change didn't go through. Let's try again: tell me what you'd like created or changed and I'll do it now.";

/** Duck-typed the same way runItemMeta.ts's extractRunItemMeta is: a tool-call RunItem's
 * real name lives at item.rawItem.name. Never throws — a guard must not be the thing that
 * breaks the run it's protecting. */
function toolNameOf(item: unknown): string | undefined {
  try {
    const name = (item as { rawItem?: { name?: unknown } })?.rawItem?.name;
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** True if any of the given tool names was actually called somewhere in this run's items,
 * regardless of whether that call ultimately succeeded — a genuinely failed create_agent
 * call throws and the model sees the failure directly, a different (much rarer, unobserved)
 * failure mode than the one this guards: claiming success with no call at all. */
function calledAnyOf(newItems: readonly unknown[], toolNames: readonly string[]): boolean {
  return newItems.some((item) => {
    const name = toolNameOf(item);
    return name !== undefined && toolNames.includes(name);
  });
}

export function claimsAgentMutation(text: string): boolean {
  return MUTATION_CLAIM_PATTERN.test(text);
}

/**
 * Guards a specialist's own reply (Cipher, in practice — it's the only one with
 * create_agent/update_agent) at the point ipc/agent.ts's runSubAgent and
 * tasks/scheduler.ts's runSubAgentHeadless already apply guardLeakedChecklistReply. Checks
 * the claim against *that specialist's own* newItems, since its nested run is where
 * create_agent/update_agent would actually appear.
 */
export function guardFalseAgentMutationClaim(rawOutput: string, newItems: readonly unknown[], logLabel: string): string {
  if (!claimsAgentMutation(rawOutput) || calledAnyOf(newItems, MUTATION_TOOL_NAMES)) return rawOutput;
  devLog(`[agentMutationGuard] ${logLabel} claimed an agent was created/updated with no matching tool call in this run — correcting`);
  return CORRECTION_MESSAGE;
}

/**
 * Guards the orchestrator's own top-level reply — defense in depth alongside the specialist-
 * level guard above, for the case where Orbit fabricates the claim without ever delegating
 * to cipher at all this turn. Weaker signal than the specialist-level guard (Orbit's own
 * newItems don't reach inside cipher's nested run, so this can't see whether cipher's own
 * call actually succeeded) — checking "was cipher called at all" is the best available
 * proxy at this layer; the specialist-level guard is what catches a false claim cipher
 * itself produced.
 */
export function guardFalseAgentMutationClaimAtTopLevel(rawOutput: string, newItems: readonly unknown[], logLabel: string): string {
  if (!claimsAgentMutation(rawOutput) || calledAnyOf(newItems, ["cipher"])) return rawOutput;
  devLog(`[agentMutationGuard] ${logLabel} claimed an agent was created/updated without ever calling cipher this turn — correcting`);
  return CORRECTION_MESSAGE;
}
