/**
 * Lets an agent ask the user one real, structured question and get an actual answer back —
 * not just a plan (that's write_checklist) or a yes/no gate (that's needsApproval). Built
 * because prompt instructions alone ("ask one question at a time") don't reliably hold
 * against a cost-tier model — see configAgent.md's history.
 *
 * This was originally assumed to make "one question at a time" true by construction, on the
 * reasoning that a tool call blocking the run leaves no room for a second one. That was
 * wrong — a model emits several tool calls in one turn and the SDK runs them concurrently —
 * so the guarantee is enforced by the caller's serial queue instead (ai/serialQueue.ts),
 * which orders questions and approval prompts together.
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

/** What the UI's own Cancel action resolves to (see AskUserCard) — distinct from a real,
 * user-composed answer by construction, so it can never be confused with literal input text.
 * Unlike Skip (only available when the field is optional, and submits `placeholder` as a
 * real value the agent asked for), Cancel is always available: it means "the user doesn't
 * want to answer this at all," not "here's the default." KI-2: before this existed, a
 * required question with no way out meant a user's unrelated follow-up message — typed into
 * the only live input left, the question card's own — was silently accepted as the literal
 * answer, derailing whichever specialist asked into acting on garbage data. */
export const ASK_USER_CANCELLED_SENTINEL = "[user cancelled — did not answer]";

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
      .describe(
        "The default answer if this is optional and skipped, or times out. Give one of options[].value — an " +
          "option's label works too and is matched back to its value, and anything matching neither is dropped."
      ),
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

/**
 * Reconciles a single_select's `placeholder` with the options it actually offered.
 *
 * KI-4's invariant — Skip must never submit a value the agent didn't list — used to be a
 * schema `.refine()`, which rejected the whole call. In practice the model sends the option's
 * *label* where its value belongs ("Beginner" against `beginner`), and the SDK reports that
 * back as a bare "InvalidToolInputError: Invalid JSON input for tool" with none of zod's
 * message in it. The model can't see what it got wrong: it retried the identical placeholder,
 * failed again, gave up on the tool and typed the question as plain text instead — losing an
 * entire agent-creation flow to a capitalization difference.
 *
 * So the invariant is enforced here instead, where a near-miss can be repaired rather than
 * being fatal: match the value, else match a label back to its value, else drop the
 * placeholder entirely. Dropping lands on a state the app already handles — a placeholder-less
 * optional question, which the model can and does send on its own (Skip submits empty, a
 * timeout gives NO_ANSWER_TIMEOUT_SENTINEL) — whereas honouring an unlisted placeholder is
 * the exact thing KI-4 forbids.
 */
export function normalizeAskUserField(field: AskUserField): AskUserField {
  if (field.type !== "single_select" || field.placeholder === undefined) return field;
  const wanted = field.placeholder.trim().toLowerCase();
  const byValue = field.options.find((o) => o.value.trim().toLowerCase() === wanted);
  const byLabel = field.options.find((o) => o.label.trim().toLowerCase() === wanted);
  const matched = byValue ?? byLabel;
  if (matched) return { ...field, placeholder: matched.value };
  return { type: field.type, options: field.options, required: field.required };
}

export async function askUser(
  { question, field, rememberAsUserInfo }: AskUserParams,
  agentName: string,
  requestAnswer: RequestAnswerFn
): Promise<string> {
  devLog(`[ask_user] ${agentName} asked: ${question}`);
  // Normalized before the round-trip, not after: the renderer renders this exact field, and
  // ipc/agent.ts derives its own timeout fallback from field.placeholder — both have to see
  // the reconciled value, not the model's near-miss.
  const answer = await requestAnswer(agentName, question, normalizeAskUserField(field));
  if (rememberAsUserInfo && answer !== NO_ANSWER_TIMEOUT_SENTINEL && answer !== ASK_USER_CANCELLED_SENTINEL) {
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
      "Ask the user a single question and wait for their real answer — this is a tool call, never text you write in your reply. Never bundle more than one question into a single call; if you need several answers, call this again after each one resolves. Use field.type \"single_select\" with a short list of real options when the answer is naturally a pick-one choice (the UI adds its own free-text escape hatch automatically); use \"text\" for anything open-ended. Set field.required=false with a sensible field.placeholder whenever skipping is reasonable — the placeholder becomes the literal answer if skipped or timed out. Set rememberAsUserInfo=true only for facts worth every agent knowing later (the same bar as save_user_info). The answer can come back as \"[no answer — timed out]\" or \"[user cancelled — did not answer]\" — neither is real data: don't treat either as the user's actual answer. Report that you couldn't get it and continue without guessing, or ask again differently if that's more useful than dropping it.",
    parameters: askUserParams,
    execute: async (params) => askUser(params, agentName, requestAnswer),
  });
}
