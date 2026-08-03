/**
 * Seeds the cross-agent user-fact store (../ai/userInfoStore) from onboarding answers, so
 * the context questions asked once at first launch reach every agent's prompt from turn
 * one instead of waiting for an agent to re-ask them via save_user_info. Also backs
 * Settings → General → About you, where those same answers stay editable afterwards.
 */

import { ipcMain } from "electron";
import { UserInfoFact, readUserInfoFacts, removeUserInfoFact, upsertUserInfoFact } from "../ai/userInfoStore";
import { devLog } from "../devLog";

interface SeedFact {
  question: string;
  answer: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidFact(fact: SeedFact | undefined): boolean {
  return isNonEmptyString(fact?.question) && isNonEmptyString(fact?.answer);
}

export function registerUserInfoHandlers(): void {
  // Renderer-supplied payload is never trusted at face value — each entry is shape-checked
  // before it reaches the store, and anything malformed is dropped rather than throwing
  // (a bad fact must not be able to fail onboarding).
  ipcMain.handle("userInfo:seedFacts", (_event, facts: SeedFact[]): void => {
    if (!Array.isArray(facts)) return;
    for (const fact of facts) {
      if (!isValidFact(fact)) continue;
      devLog(`[userInfo] seeding fact: ${fact.question}`);
      // Upsert rather than append: a Danger Zone reset clears onboardingDone but leaves
      // this file on disk, so a second onboarding pass would otherwise duplicate every
      // answer, and both copies get injected into every agent's prompt.
      upsertUserInfoFact({ question: fact.question, answer: fact.answer, askedBy: "onboarding" });
    }
  });

  ipcMain.handle("userInfo:list", (): UserInfoFact[] => readUserInfoFacts());

  // Settings → General → About you. A blank answer clears the fact instead of storing an
  // empty one, which would otherwise reach every prompt as a question with no answer.
  ipcMain.handle("userInfo:setFact", (_event, question: unknown, answer: unknown): void => {
    if (!isNonEmptyString(question)) return;
    if (typeof answer !== "string") return;
    if (answer.trim().length === 0) {
      devLog(`[userInfo] clearing fact: ${question}`);
      removeUserInfoFact(question);
      return;
    }
    devLog(`[userInfo] updating fact: ${question}`);
    upsertUserInfoFact({ question, answer: answer.trim(), askedBy: "settings" });
  });
}
