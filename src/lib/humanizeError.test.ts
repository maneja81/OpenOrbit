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

describe("errors that arrived over IPC", () => {
  // Electron wraps every rejected ipcRenderer.invoke as
  // `Error invoking remote method '<channel>': <ErrorName>: <message>`. Nearly every error this
  // function sees comes that way, so the wrapper decided most categorisations before this.
  it("categorises a wrapped Access denied, which it previously could not", () => {
    // The one with real consequences: ipc/filesystem.ts throws this, so it *always* arrives
    // wrapped, and the startsWith check never matched. Users got "Something went wrong" instead
    // of the only message that tells them what to do.
    const h = humanizeError(
      new Error(`Error invoking remote method 'fs:readFile': Error: Access denied: "/etc" is outside all allowed folders`)
    );
    expect(h.title).toBe("Access denied");
    expect(h.nextSteps[0]).toMatch(/Settings > Folders/);
  });

  it("keeps a named error class, which is worth showing", () => {
    const h = humanizeError(new Error("Error invoking remote method 'settings:reset': SqliteError: database is locked"));
    expect(h.message).toBe("SqliteError: database is locked");
    expect(h.message).not.toMatch(/invoking remote method/);
  });

  it("drops the bare Error: prefix, which says nothing", () => {
    expect(humanizeError(new Error("Error invoking remote method 'x:y': Error: boom")).message).toBe("boom");
  });

  it("still categorises a wrapped validation failure", () => {
    const h = humanizeError(new Error("Error invoking remote method 'mcp:update': Error: mcp:update requires a non-empty server id"));
    expect(h.title).toBe("Something's missing");
    expect(h.message).toBe("mcp:update requires a non-empty server id");
  });

  it("leaves an unwrapped message alone", () => {
    expect(humanizeError(new Error("plain failure")).message).toBe("plain failure");
  });

  it("handles a channel name containing a colon", () => {
    // Every channel in this app is namespaced with one, so a lazy regex would under-match.
    expect(humanizeError(new Error("Error invoking remote method 'agent:runStream': Error: nope")).message).toBe("nope");
  });
});

describe("formatHumanizedError punctuation", () => {
  it("does not run the message into the next step", () => {
    // "database is locked Try again, and let us know…" — thrown messages rarely end in a period.
    const formatted = formatHumanizedError(
      humanizeError(new Error("Error invoking remote method 'settings:reset': SqliteError: database is locked"))
    );
    expect(formatted).toBe("Something went wrong: SqliteError: database is locked. Try again, and let us know if it keeps happening.");
  });

  it("does not double up punctuation the message already has", () => {
    const formatted = formatHumanizedError({ title: "T", message: "Already ends properly.", nextSteps: ["Next."] });
    expect(formatted).toBe("T: Already ends properly. Next.");
  });

  it("omits the separator when there are no next steps", () => {
    expect(formatHumanizedError({ title: "T", message: "m", nextSteps: [] })).toBe("T: m");
  });
});
