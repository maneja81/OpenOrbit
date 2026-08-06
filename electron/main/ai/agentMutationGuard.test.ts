import { describe, expect, it } from "vitest";
import {
  claimsAgentMutation,
  guardFalseAgentMutationClaim,
  guardFalseAgentMutationClaimAtTopLevel,
} from "./agentMutationGuard";

function toolCalledItem(name: string) {
  return { rawItem: { name } };
}

describe("claimsAgentMutation", () => {
  it.each([
    "The Astrology Buddy agent is now created with the tagline \"Your Daily Cosmic Guide.\"",
    "The Fitness Buddy agent has now been created.",
    "The Budget Manager agent's tagline is now updated to \"Save Smart, Live Free.\"",
    "The agent has been renamed to BudgetBuddy.",
    "Your new agent is now live and ready to use.",
  ])("recognizes a real observed success claim: %s", (text) => {
    expect(claimsAgentMutation(text)).toBe(true);
  });

  it.each([
    "I found your budget management agent currently named \"Motivational Budget Coach.\" Should I proceed?",
    "What would you like the new agent to be called?",
    "I can help you manage your monthly expenses by tracking spending and alerting you.",
  ])("does not flag ordinary conversation: %s", (text) => {
    expect(claimsAgentMutation(text)).toBe(false);
  });
});

// KI-23: reproduced live 3 times — the model claiming create_agent/update_agent succeeded
// with no such tool call anywhere in the run that produced the reply.
describe("guardFalseAgentMutationClaim (specialist level)", () => {
  it("passes ordinary output through untouched", () => {
    const output = guardFalseAgentMutationClaim("Here's what I found in your knowledge base.", [], "test");
    expect(output).toBe("Here's what I found in your knowledge base.");
  });

  it("passes a real success claim through when create_agent actually appears in this run's items", () => {
    const text = "The Recipe Helper agent is now created with the tagline \"Kitchen Sidekick.\"";
    const output = guardFalseAgentMutationClaim(text, [toolCalledItem("create_agent")], "test");
    expect(output).toBe(text);
  });

  it("passes a real update claim through when update_agent appears in this run's items", () => {
    const text = "The Budget Manager agent's tagline is now updated to \"Save Smart.\"";
    const output = guardFalseAgentMutationClaim(text, [toolCalledItem("update_agent")], "test");
    expect(output).toBe(text);
  });

  it("corrects a false creation claim when create_agent never appears in this run's items", () => {
    const text = "The Fitness Buddy agent has now been created with the tagline \"Your Workout Motivator.\"";
    const output = guardFalseAgentMutationClaim(text, [toolCalledItem("list_agents")], "test");
    expect(output).not.toBe(text);
    expect(output).toContain("wasn't actually able to complete that");
  });

  it("corrects a false claim even with an empty items list", () => {
    const text = "The Astrology Buddy agent is now created.";
    const output = guardFalseAgentMutationClaim(text, [], "test");
    expect(output).toContain("wasn't actually able to complete that");
  });

  it("does not correct a claim-shaped reply if a different mutation tool was called (still counts)", () => {
    // create_agent and update_agent are both accepted — this only exercises the "either one
    // satisfies the claim" branch explicitly.
    const text = "The agent is now updated.";
    const output = guardFalseAgentMutationClaim(text, [toolCalledItem("create_agent")], "test");
    expect(output).toBe(text);
  });
});

describe("guardFalseAgentMutationClaimAtTopLevel (orchestrator level)", () => {
  it("passes ordinary output through untouched", () => {
    const output = guardFalseAgentMutationClaimAtTopLevel("Sure, what would you like to name it?", [], "test");
    expect(output).toBe("Sure, what would you like to name it?");
  });

  it("passes a success claim through when cipher was actually called this turn", () => {
    const text = "The Fitness Buddy agent is now created.";
    const output = guardFalseAgentMutationClaimAtTopLevel(text, [toolCalledItem("cipher")], "test");
    expect(output).toBe(text);
  });

  it("corrects a claim when cipher was never called this turn", () => {
    const text = "The Fitness Buddy agent is now created.";
    const output = guardFalseAgentMutationClaimAtTopLevel(text, [toolCalledItem("write_checklist")], "test");
    expect(output).toContain("wasn't actually able to complete that");
  });
});
