/**
 * ConfigAgent's find_skill tool — searches GitHub (unauthenticated, see
 * electron/main/github/skillSearch.ts for why code search isn't used) for up to 3
 * real SKILL.md files matching a domain query, saves each raw file verbatim under
 * getSkillsDir() for later inspection/editing, distills them into one deduplicated,
 * branding-free set of key points, and returns that (plus source attribution) so
 * Cipher can merge it into the new agent's prompt draft rather than dumping raw
 * README content into it.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { findTopSkillMatches } from "../../github/skillSearch";
import { distillSkillContents } from "../skillDistill";
import { getSkillsDir } from "../../appDirs";
import { devLog } from "../../devLog";

// GitHub owner/repo names are themselves restricted to this shape, but that's an
// upstream assumption this codebase never asserted — validate explicitly before using
// either value to build a filesystem path, matching the allowlist-over-trust
// convention ipc/filesystem.ts uses for other untrusted-path handling.
const SAFE_GITHUB_NAME = /^[a-zA-Z0-9._-]+$/;

export async function saveRawSkill(owner: string, repo: string, rawMarkdown: string): Promise<string> {
  if (!SAFE_GITHUB_NAME.test(owner) || !SAFE_GITHUB_NAME.test(repo)) {
    throw new Error(`Refusing to save skill from unexpected repo identifier "${owner}/${repo}".`);
  }
  const dir = path.join(getSkillsDir(), `${owner}-${repo}`);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  await writeFile(filePath, rawMarkdown, "utf8");
  return filePath;
}

// Raw files are already saved to disk by this point regardless of what happens here —
// if distillation fails (missing/invalid API key, network error, bad provider
// response), fall back to a truncated concatenation of the raw sources rather than
// throwing and losing the useful work already done finding and downloading them.
const RAW_FALLBACK_CHARS_PER_SOURCE = 2000;

export async function distillOrFallback(
  matches: { owner: string; repo: string; rawMarkdown: string }[],
  query: string
): Promise<string> {
  try {
    return await distillSkillContents(matches, query);
  } catch (e) {
    devLog(`[find_skill] distillation failed, falling back to raw content: ${e instanceof Error ? e.message : String(e)}`);
    return matches
      .map((match) => {
        const truncated = match.rawMarkdown.slice(0, RAW_FALLBACK_CHARS_PER_SOURCE);
        const suffix = match.rawMarkdown.length > RAW_FALLBACK_CHARS_PER_SOURCE ? "\n[...truncated]" : "";
        return `[Automatic summarization was unavailable — raw content from ${match.owner}/${match.repo}]\n${truncated}${suffix}`;
      })
      .join("\n\n");
  }
}

export const findSkillTool = tool({
  name: "find_skill",
  description:
    "Search GitHub for up to 3 real, purpose-built skill files (SKILL.md) matching a short domain query (e.g. 'budget management', 'vedic astrology'), and get back a merged, deduplicated set of key domain-knowledge points to fold into the new agent's prompt draft. Default to calling this before drafting any agent with a named domain, hobby, profession, or specialized knowledge area — even one you already know about from training, since a real purpose-built reference beats drafting from memory alone. Only skip it for a genuinely generic agent with no real subject-matter domain.",
  parameters: z.object({
    // Capped short — GitHub's repo search matches this as an exact phrase, so a long
    // compound query joining several concepts (e.g. "astrology personal horoscopes
    // birth charts") reliably matches nothing even when relevant repos exist. Forces
    // a genuinely short 2-4 word domain phrase, one concept, not several joined together.
    query: z
      .string()
      .min(1)
      .max(40)
      .describe(
        "A short domain/purpose query, ONE concept only, e.g. 'personal budget tracking' or 'vedic astrology' — not several concepts joined together."
      ),
  }),
  execute: async ({ query }) => {
    devLog(`[find_skill] called with query="${query}"`);
    const matches = await findTopSkillMatches(query);
    if (matches.length === 0) {
      devLog("[find_skill] no matching skill found");
      return "No matching skill found on GitHub for this query. Proceed drafting the prompt from your own knowledge.";
    }

    await Promise.all(matches.map((match) => saveRawSkill(match.owner, match.repo, match.rawMarkdown)));

    const keyPoints = await distillOrFallback(
      matches.map((match) => ({ owner: match.owner, repo: match.repo, rawMarkdown: match.rawMarkdown })),
      query
    );

    devLog(`[find_skill] found ${matches.length} match(es): ${matches.map((m) => `${m.owner}/${m.repo}`).join(", ")}`);

    return {
      keyPoints,
      sources: matches.map((match) => ({ repo: `${match.owner}/${match.repo}`, url: match.htmlUrl })),
    };
  },
});
