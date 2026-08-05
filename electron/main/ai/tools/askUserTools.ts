/**
 * Lets an agent ask the user one real, structured question and get an actual answer back —
 * not just a plan (that's write_checklist) or a yes/no gate (that's needsApproval). Built
 * because prompt instructions alone ("ask one question at a time") don't reliably hold
 * against a cost-tier model — see configAgent.md's history. A tool call that genuinely
 * pauses the run makes "one question per turn" true by construction: the model cannot make
 * a second ask_user call before the first one resolves.
 *
 * Every agent (orchestrator, every built-in specialist, every custom agent) gets its own
 * bound instance via createAskUserTool(agentName, requestAnswer), same shape as
 * createWriteChecklistTool/createSaveUserInfoTool. `requestAnswer` is supplied by the
 * caller (ipc/agent.ts for an interactive turn, tasks/scheduler.ts for a headless run) —
 * only the caller has the IPC/renderer round-trip (or, headlessly, no one to ask at all)
 * this needs.
 *
 * Deliberately NOT built on the SDK's `needsApproval`/interruption mechanism: that channel
 * only carries a boolean back to the tool (see runLoop.ts's ApprovableRunResult), with no
 * way to return the user's actual answer text. A tool's own `execute()` is just an async
 * function already running inside the request's own closure, so it can directly await a
 * promise the caller resolves — simpler than the approval flow, not a copy of it.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { appendUserInfoFact } from "../userInfoStore";
import { devLog } from "../../devLog";

/** What a timed-out, required, no-placeholder question resolves to — a fixed, stable value
 * every prompt can be told to expect and react to, rather than each call site inventing its
 * own wording. */
export const NO_ANSWER_TIMEOUT_SENTINEL = "[no answer — timed out]";

export const askUserFieldSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    placeholder: z.string().optional().describe("The real default answer to use if this is optional and skipped, or times out."),
    required: z.boolean().describe("If true, the question cannot be skipped."),
  }),
  z.object({
    type: z.literal("single_select"),
    options: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .min(1)
      .describe("The choices to show, in order. The UI always adds its own free-text \"something else\" option too — don't include one yourself."),
    placeholder: z
      .string()
      .optional()
      .describe("The value (not label) of the option to use as the real default if this is optional and skipped, or times out."),
    required: z.boolean().describe("If true, the question cannot be skipped."),
  }),
]);

export const askUserParams = z.object({
  question: z.string().min(1).max(300).describe("The single question to ask, in plain language."),
  field: askUserFieldSchema,
  rememberAsUserInfo: z
    .boolean()
    .optional()
    .describe("Set true only when this answer is a durable fact worth every agent knowing going forward (matches the existing save_user_info bar) — saves it automatically, no separate call needed."),
});

export type AskUserField = z.infer<typeof askUserFieldSchema>;
export type AskUserParams = z.infer<typeof askUserParams>;

/** Supplied by the caller — the only thing that differs between an interactive run
 * (real IPC round-trip to the renderer) and a headless one (no one to ask, resolve
 * immediately). `agentName` rides along purely for the UI card's display (see
 * ToolApprovalCard's own `agentName` field for precedent) — it plays no part in the
 * mechanism itself. Returns the answer text. */
export type RequestAnswerFn = (agentName: string, question: string, field: AskUserField) => Promise<string>;

export async function askUser(
  { question, field, rememberAsUserInfo }: AskUserParams,
  agentName: string,
  requestAnswer: RequestAnswerFn
): Promise<string> {
  devLog(`[ask_user] ${agentName} asked: ${question}`);
  const answer = await requestAnswer(agentName, question, field);
  if (rememberAsUserInfo && answer !== NO_ANSWER_TIMEOUT_SENTINEL) {
    appendUserInfoFact({ question, answer, askedBy: agentName });
  }
  return answer;
}

/** Builds an ask_user tool instance bound to the calling agent's own name and the current
 * run's requestAnswer implementation, so provenance (which agent asked) and the actual
 * pause/round-trip mechanism are both correct regardless of who calls it — Orbit directly,
 * or a specialist mid-nested-run (already proven possible: a specialist's own
 * needsApproval-gated tool call already correctly pauses the top-level run today). */
export function createAskUserTool(agentName: string, requestAnswer: RequestAnswerFn) {
  return tool({
    name: "ask_user",
    description:
      "Ask the user a single question and wait for their real answer — this is a tool call, never text you write in your reply. Never bundle more than one question into a single call; if you need several answers, call this again after each one resolves. Use field.type \"single_select\" with a short list of real options when the answer is naturally a pick-one choice (the UI adds its own free-text escape hatch automatically); use \"text\" for anything open-ended. Set field.required=false with a sensible field.placeholder whenever skipping is reasonable — the placeholder becomes the literal answer if skipped or timed out. Set rememberAsUserInfo=true only for facts worth every agent knowing later (the same bar as save_user_info).",
    parameters: askUserParams,
    execute: async (params) => askUser(params, agentName, requestAnswer),
  });
}
