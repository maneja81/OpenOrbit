import { describe, expect, it } from "vitest";
import { CognitiveStateFlags, formatSessionStats, getCognitiveState } from "./orbStatus";

const IDLE: CognitiveStateFlags = {
  listening: false,
  transcribing: false,
  speaking: false,
  thinking: false,
  orchestratorResponding: false,
  hasActiveAgent: false,
};

describe("getCognitiveState", () => {
  it("reads 'orchestrator' at idle", () => {
    expect(getCognitiveState(IDLE)).toBe("orchestrator");
  });

  it("maps each flag to its word", () => {
    expect(getCognitiveState({ ...IDLE, listening: true })).toBe("listening");
    expect(getCognitiveState({ ...IDLE, transcribing: true })).toBe("processing");
    expect(getCognitiveState({ ...IDLE, speaking: true })).toBe("speaking");
    expect(getCognitiveState({ ...IDLE, thinking: true })).toBe("thinking");
  });

  it("distinguishes routing from composing by whether an agent has the turn", () => {
    expect(getCognitiveState({ ...IDLE, orchestratorResponding: true, hasActiveAgent: true })).toBe("routing");
    expect(getCognitiveState({ ...IDLE, orchestratorResponding: true, hasActiveAgent: false })).toBe("composing");
  });

  it("honors the priority order when several flags are true at once", () => {
    const all: CognitiveStateFlags = {
      listening: true,
      transcribing: true,
      speaking: true,
      thinking: true,
      orchestratorResponding: true,
      hasActiveAgent: true,
    };
    expect(getCognitiveState(all)).toBe("listening");
    expect(getCognitiveState({ ...all, listening: false })).toBe("processing");
    expect(getCognitiveState({ ...all, listening: false, transcribing: false })).toBe("speaking");
    expect(getCognitiveState({ ...all, listening: false, transcribing: false, speaking: true })).toBe("speaking");
  });

  it("puts speaking ahead of a still-generating response", () => {
    expect(getCognitiveState({ ...IDLE, speaking: true, orchestratorResponding: true })).toBe("speaking");
  });
});

describe("formatSessionStats", () => {
  it("returns an empty string for a session with nothing to report", () => {
    expect(formatSessionStats(0, 0)).toBe("");
  });

  it("omits the message count until the user has sent one", () => {
    expect(formatSessionStats(0, 5 * 60_000)).toBe("5m");
  });

  it("omits the uptime under a minute", () => {
    expect(formatSessionStats(2, 30_000)).toBe("2 messages");
  });

  it("singularizes a lone message", () => {
    expect(formatSessionStats(1, 30_000)).toBe("1 message");
  });

  it("joins both halves once both have something to say", () => {
    expect(formatSessionStats(3, 12 * 60_000)).toBe("3 messages · 12m");
  });

  it("rolls over into hours", () => {
    expect(formatSessionStats(4, 90 * 60_000)).toBe("4 messages · 1h 30m");
    expect(formatSessionStats(4, 120 * 60_000)).toBe("4 messages · 2h 0m");
  });
});
