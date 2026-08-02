/**
 * Cross-agent memory of facts learned about the user during agent creation (Cipher's
 * save_user_info tool, see tools/userInfoTools.ts). Read by buildOrchestrator() and
 * folded into every agent's rendered instructions (orchestrator, Cipher, Atlas,
 * Explorer, and every custom agent) so the app's knowledge of the user compounds over
 * time instead of resetting per agent.
 *
 * Stored as a single flat JSON file under getUserInfoDir() rather than reviving the
 * dead `memory` DB table (electron/main/ipc/memory.ts) — that table's generic
 * kind/content shape wasn't a clearly better fit than a purpose-built fact list, and
 * would have needed the same amount of new plumbing either way.
 *
 * Facts accumulate for the lifetime of the app and get injected into every agent's
 * prompt on every turn, so the stored list is capped (MAX_FACTS) rather than growing
 * unbounded — otherwise this would eventually blow every agent's context budget.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getUserInfoDir } from "../appDirs";

const MAX_FACTS = 50;

export interface UserInfoFact {
  question: string;
  answer: string;
  askedBy: string;
  createdAt: string;
}

function factsFilePath(): string {
  return path.join(getUserInfoDir(), "facts.json");
}

export function readUserInfoFacts(): UserInfoFact[] {
  try {
    const raw = readFileSync(factsFilePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as UserInfoFact[]) : [];
  } catch {
    return [];
  }
}

/** Appends one fact, then keeps only the most recent MAX_FACTS — an unbounded store
 * would otherwise grow forever while being re-injected into every agent's prompt on
 * every turn.
 *
 * Deliberately built from *synchronous* fs calls: the agents runtime can dispatch
 * multiple same-turn tool calls via Promise.all, but since this function never
 * `await`s between its read and its write, each call's read-modify-write always runs
 * to completion before another can interleave — so back-to-back save_user_info calls
 * in one turn can't clobber each other. Switching this to async fs calls would
 * reintroduce that lost-update race; keep it synchronous. */
export function appendUserInfoFact(fact: Omit<UserInfoFact, "createdAt">): UserInfoFact {
  const entry: UserInfoFact = { ...fact, createdAt: new Date().toISOString() };
  const next = [...readUserInfoFacts(), entry].slice(-MAX_FACTS);
  mkdirSync(getUserInfoDir(), { recursive: true });
  writeFileSync(factsFilePath(), JSON.stringify(next, null, 2), "utf8");
  return entry;
}

/** Replaces every fact sharing this question with a single new entry, appending when none
 * exists. Settings → About you re-answers the same fixed questions repeatedly, and a
 * Danger Zone reset clears the DB but deliberately leaves this file on disk (see
 * settings:reset), so a second onboarding pass would otherwise stack a duplicate answer —
 * both of which get injected into every agent's prompt on every turn.
 *
 * Filters rather than replaces in place so any duplicates already written by an earlier
 * append-only version collapse to one. Synchronous for the same read-modify-write reason
 * documented on appendUserInfoFact — do not make this async. */
export function upsertUserInfoFact(fact: Omit<UserInfoFact, "createdAt">): UserInfoFact {
  const entry: UserInfoFact = { ...fact, createdAt: new Date().toISOString() };
  const kept = readUserInfoFacts().filter((existing) => existing.question !== fact.question);
  mkdirSync(getUserInfoDir(), { recursive: true });
  writeFileSync(factsFilePath(), JSON.stringify([...kept, entry].slice(-MAX_FACTS), null, 2), "utf8");
  return entry;
}

/** Drops every fact for a question — how Settings → About you clears an answer, since an
 * empty fact would still be injected into every prompt as a question with no answer. */
export function removeUserInfoFact(question: string): void {
  const facts = readUserInfoFacts();
  const kept = facts.filter((existing) => existing.question !== question);
  if (kept.length === facts.length) return;
  mkdirSync(getUserInfoDir(), { recursive: true });
  writeFileSync(factsFilePath(), JSON.stringify(kept, null, 2), "utf8");
}

/** Renders the fact list into a short block for prompt injection, or "" when empty so
 * agents built before any facts exist are unaffected. */
export function formatUserInfoForPrompt(facts: UserInfoFact[]): string {
  if (facts.length === 0) return "";
  const lines = facts.map((fact) => `- ${fact.question} → ${fact.answer}`).join("\n");
  return `\n\n## What we know about the user so far:\n${lines}`;
}
