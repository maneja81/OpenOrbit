import { describe, expect, it } from "vitest";
import { formatHumanizedError, humanizeError } from "./humanizeError";

describe("humanizeError", () => {
  it("categorizes access-denied errors", () => {
    const result = humanizeError(new Error("Access denied: /etc/passwd is outside allowed roots"));
    expect(result.title).toBe("Access denied");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it("categorizes validation errors", () => {
    const result = humanizeError(new Error("agent:run requires non-empty text input"));
    expect(result.title).toBe("Something's missing");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it("categorizes bridge-unavailable errors", () => {
    const result = humanizeError(
      new Error("Native filesystem bridge unavailable (window.agentsAPI is missing).")
    );
    expect(result.title).toBe("App isn't fully loaded");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it("falls back to a generic category for an unrecognized Error", () => {
    const result = humanizeError(new Error("ECONNRESET"));
    expect(result.title).toBe("Something went wrong");
    expect(result.message).toContain("ECONNRESET");
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it("falls back to a generic category for a non-Error thrown value", () => {
    const result = humanizeError("plain string failure");
    expect(result.title).toBe("Something went wrong");
    expect(result.message).toContain("plain string failure");
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it("never throws for undefined input", () => {
    expect(() => humanizeError(undefined)).not.toThrow();
    const result = humanizeError(undefined);
    expect(result.title).toBe("Something went wrong");
  });
});

describe("formatHumanizedError", () => {
  it("joins title, message, and next steps into one readable string", () => {
    const formatted = formatHumanizedError({
      title: "Access denied",
      message: "That location isn't in an allowed folder.",
      nextSteps: ["Add the folder in Settings > Folders, then try again."],
    });
    expect(formatted).toBe(
      "Access denied: That location isn't in an allowed folder. Add the folder in Settings > Folders, then try again."
    );
  });

  it("omits the trailing space when nextSteps is empty", () => {
    const formatted = formatHumanizedError({
      title: "Something went wrong",
      message: "Unexpected error.",
      nextSteps: [],
    });
    expect(formatted).toBe("Something went wrong: Unexpected error.");
  });
});
