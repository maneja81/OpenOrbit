import { describe, expect, it } from "vitest";
import { USER_CONTEXT_FIELDS, USER_CONTEXT_FIELD_BY_KEY } from "./userContext";

describe("USER_CONTEXT_FIELDS", () => {
  it("pins the stored question wording", () => {
    // factQuestion is the identity a fact is stored and matched under, not display copy.
    // Editing one orphans the answer every existing user already has saved under the old
    // wording — it would stay in their prompt forever while Settings showed an empty field.
    // Changing this test is the deliberate signal that a migration is needed.
    expect(USER_CONTEXT_FIELDS.map((field) => field.factQuestion)).toEqual([
      "What is your profession?",
      "How do you prefer responses?",
      "How technical are you?",
      "When stuck, what helps you most?",
    ]);
  });

  // U13 — main drops a seeded fact silently when either side is blank (isValidFact in
  // ipc/userInfo.ts:21-23) rather than throwing, deliberately, so a bad fact can't fail
  // onboarding. That makes a non-empty factQuestion the thing standing between a real answer
  // and a silent disappearance: the renderer already filters blank *answers* before sending
  // (AgentsApp's onboarding handler), so a blank *question* here would be the only way a
  // genuine answer could vanish with no error and no catch to report it.
  it("never ships a blank factQuestion, which main would silently drop", () => {
    for (const field of USER_CONTEXT_FIELDS) {
      expect(field.factQuestion.trim().length, `field "${field.key}"`).toBeGreaterThan(0);
    }
  });

  it("gives every field a unique key and a label", () => {
    const keys = USER_CONTEXT_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const field of USER_CONTEXT_FIELDS) {
      expect(field.label.trim().length, `field "${field.key}"`).toBeGreaterThan(0);
    }
  });

  it("gives every field either preset options or a placeholder, never neither", () => {
    // A field with no options renders as free text in both onboarding and Settings, where a
    // bare input with no placeholder gives the user nothing to go on.
    for (const field of USER_CONTEXT_FIELDS) {
      const hasOptions = (field.options?.length ?? 0) > 0;
      const hasPlaceholder = (field.placeholder ?? "").trim().length > 0;
      expect(hasOptions || hasPlaceholder, `field "${field.key}"`).toBe(true);
    }
  });

  it("never offers a blank preset option", () => {
    // Settings adds its own "Not set" entry to clear an answer; a blank inside options
    // would render as a second, unlabelled way to do the same thing.
    for (const field of USER_CONTEXT_FIELDS) {
      for (const option of field.options ?? []) {
        expect(option.trim().length, `field "${field.key}"`).toBeGreaterThan(0);
      }
    }
  });

  it("indexes every field by key", () => {
    for (const field of USER_CONTEXT_FIELDS) {
      expect(USER_CONTEXT_FIELD_BY_KEY[field.key]).toBe(field);
    }
  });
});
