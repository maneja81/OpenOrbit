/**
 * One-off, non-agentic completion that turns a rough description of a custom agent into a
 * short name and a 3-4 word tagline — same shape as skillDistill.ts's distillSkillContents:
 * a plain OpenAI-compatible client, no tool-calling, and (unlike agent:runStream) nothing
 * persisted to chat_history — this is a Settings-panel form helper, not a chat turn, and
 * must not leak into the conversation the orchestrator sees on its next run.
 */

import OpenAI from "openai";
import { getConfiguredChatUrl, getDecryptedChatApiKey } from "./provider";
import { getOrchestratorModel } from "./skillDistill";

export interface AgentIdentitySuggestion {
  name: string;
  tagline: string;
}

// Same shape as httpTools.ts's REQUEST_TIMEOUT_MS: this is a Settings-panel form helper, not a
// chat turn with its own approval/deadline machinery — without a bound, a slow/hung provider
// leaves the "Suggesting…" button spinning indefinitely with no cancel affordance.
const REQUEST_TIMEOUT_MS = 20_000;

const SYSTEM_INSTRUCTIONS = `You name AI sub-agents for a desktop app that runs a team of specialist agents locally.

Given a short, possibly rough description of what one agent should do, suggest:
- name: a short, memorable name (one word, or two at most) — not a sentence, not "Agent" or "Assistant", not the literal word describing its job (e.g. don't name a research agent "Researcher").
- tagline: 3 to 4 words describing its role, title case, no trailing punctuation.

Respond with nothing but a single JSON object and no markdown fences or commentary: {"name": "...", "tagline": "..."}`;

/** Thrown when the completion didn't come back as usable JSON — callers show this as a
 * plain "couldn't generate a suggestion" message rather than surfacing raw model output. */
export class AgentIdentitySuggestError extends Error {}

export async function suggestAgentIdentity(context: string): Promise<AgentIdentitySuggestion> {
  const client = new OpenAI({ apiKey: getDecryptedChatApiKey(), baseURL: getConfiguredChatUrl() });
  const completion = await client.chat.completions.create(
    {
      model: getOrchestratorModel(),
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTIONS },
        { role: "user", content: context },
      ],
    },
    { timeout: REQUEST_TIMEOUT_MS }
  );
  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  // Strip a ```json fence if the model added one despite being told not to — cheaper than a
  // second round trip over a purely cosmetic instruction-following miss.
  const jsonText = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new AgentIdentitySuggestError("Model did not return valid JSON");
  }
  const { name, tagline } = (parsed ?? {}) as { name?: unknown; tagline?: unknown };
  if (typeof name !== "string" || !name.trim() || typeof tagline !== "string" || !tagline.trim()) {
    throw new AgentIdentitySuggestError("Model did not return a usable name/tagline");
  }
  return { name: name.trim(), tagline: tagline.trim() };
}
