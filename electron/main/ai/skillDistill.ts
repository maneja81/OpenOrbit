/**
 * One-off, non-agentic "distill" call — turns 1-3 raw SKILL.md files into a compact,
 * branding-free set of key points sized for merging into another agent's system prompt
 * (not a full standalone prompt). Uses a plain OpenAI-compatible client the same way
 * provider.ts does for /audio/* calls, rather than the full @openai/agents run() loop,
 * since this is a single completion with no tool-calling needed.
 */

import OpenAI from "openai";
import { getConfiguredChatUrl, getDecryptedChatApiKey } from "./provider";
import { readAppSetting } from "../appSettings";
import { SETTING_DEFAULTS } from "../settingsSchema";

// Reads the same setting agents.ts's buildOrchestrator() uses for the orchestrator's
// own model, via settingsStore directly rather than importing agents.ts (which would be
// circular: agents.ts -> tools/skillFinderTool.ts -> this file -> agents.ts). This keeps
// distillation on whatever model the user actually has configured instead of a separately
// hardcoded literal that can silently drift out of sync — which is exactly what happened
// when DEFAULT_MODEL switched formats and this file's old hardcoded copy didn't.
function getOrchestratorModel(): string {
  // The local FALLBACK_MODEL this used to declare was the fourth hardcoded copy of the same
  // string — and the comment above it already described that exact failure happening once
  // before. readAppSetting resolves the default from settingsSchema, so there is nothing left
  // here to drift. The `||` still stands because "" is a legal stored value meaning "unset".
  return readAppSetting("orchestratorModel") || SETTING_DEFAULTS.orchestratorModel;
}

export interface SkillDistillSource {
  owner: string;
  repo: string;
  rawMarkdown: string;
}

const SYSTEM_INSTRUCTIONS = `You distill raw "SKILL.md" files (community-authored agent-skill reference docs) into a compact, branding-free set of operationally useful key points for merging into another AI agent's system prompt.

Rules:
- Remove all author branding, marketing language, links, and "further learning"/"references"/"troubleshooting"/"installation" sections — keep only what's directly useful for answering questions in this domain.
- If multiple source documents are given, treat them as one combined pool: eliminate overlapping or duplicate points (keep whichever phrasing is clearer/more complete), and keep each source's genuinely unique contributions.
- Rewrite any script/CLI/tool-execution instructions (e.g. "run this Python script") as conversational domain knowledge instead — the agent receiving this has no shell or script-execution ability, only its own reasoning.
- Output plain text key points (short paragraphs or a tight bullet list), sized to be merged into one section of a larger prompt. No headers like "# Skill", no meta-commentary about what you did.`;

export async function distillSkillContents(sources: SkillDistillSource[], agentDomainQuery: string): Promise<string> {
  const client = new OpenAI({ apiKey: getDecryptedChatApiKey(), baseURL: getConfiguredChatUrl() });
  const sourcesBlock = sources
    .map((source, i) => `--- Source ${i + 1}: ${source.owner}/${source.repo} ---\n${source.rawMarkdown}`)
    .join("\n\n");

  const completion = await client.chat.completions.create({
    model: getOrchestratorModel(),
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTIONS },
      { role: "user", content: `The new agent's domain/purpose: "${agentDomainQuery}"\n\n${sourcesBlock}` },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}
