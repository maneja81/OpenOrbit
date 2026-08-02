import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeWithDefaults } from "./settings";

describe("mergeWithDefaults", () => {
  it("returns the defaults untouched when given an empty object", () => {
    expect(mergeWithDefaults({})).toEqual(DEFAULT_SETTINGS);
  });

  it("overrides only the provided keys, keeping the rest at their defaults", () => {
    const merged = mergeWithDefaults({ userName: "Ada", voiceInputEnabled: false });
    expect(merged.userName).toBe("Ada");
    expect(merged.voiceInputEnabled).toBe(false);
    expect(merged.agentName).toBe(DEFAULT_SETTINGS.agentName);
    expect(merged.orchestratorModel).toBe(DEFAULT_SETTINGS.orchestratorModel);
  });

  it("defaults locationEnabled to false", () => {
    expect(mergeWithDefaults({}).locationEnabled).toBe(false);
  });

  it("allows locationEnabled to be overridden", () => {
    expect(mergeWithDefaults({ locationEnabled: true }).locationEnabled).toBe(true);
  });

  // The default is the security control, not a preference — an existing install that has
  // never heard of this key must land on "ask", so a stored settings blob without it cannot
  // be read as consent.
  it("defaults remoteImagesAutoLoad to false", () => {
    expect(mergeWithDefaults({}).remoteImagesAutoLoad).toBe(false);
    expect(mergeWithDefaults({ locationEnabled: true }).remoteImagesAutoLoad).toBe(false);
  });

  it("allows remoteImagesAutoLoad to be overridden", () => {
    expect(mergeWithDefaults({ remoteImagesAutoLoad: true }).remoteImagesAutoLoad).toBe(true);
  });

  it("defaults bgMusicEnabled to false", () => {
    expect(mergeWithDefaults({}).bgMusicEnabled).toBe(false);
  });

  it("allows bgMusicEnabled to be overridden", () => {
    expect(mergeWithDefaults({ bgMusicEnabled: true }).bgMusicEnabled).toBe(true);
  });

  it("defaults the newly-configurable tunables", () => {
    const merged = mergeWithDefaults({});
    expect(merged.voiceTtsVoice).toBe("alloy");
    expect(merged.agentRunTimeoutSeconds).toBe(60);
    expect(merged.chatHistoryMessageLimit).toBe(20);
    expect(merged.bgMusicVolume).toBe(0.1);
    expect(merged.systemStatsPollIntervalMs).toBe(3000);
  });

  it("allows the newly-configurable tunables to be overridden", () => {
    const merged = mergeWithDefaults({
      voiceTtsVoice: "nova",
      agentRunTimeoutSeconds: 120,
      chatHistoryMessageLimit: 40,
      bgMusicVolume: 0.3,
      systemStatsPollIntervalMs: 5000,
    });
    expect(merged.voiceTtsVoice).toBe("nova");
    expect(merged.agentRunTimeoutSeconds).toBe(120);
    expect(merged.chatHistoryMessageLimit).toBe(40);
    expect(merged.bgMusicVolume).toBe(0.3);
    expect(merged.systemStatsPollIntervalMs).toBe(5000);
  });

  it("does not mutate DEFAULT_SETTINGS", () => {
    mergeWithDefaults({ userName: "Ada" });
    expect(DEFAULT_SETTINGS.userName).toBe("");
  });

  it("carries through unknown extra keys from the raw blob", () => {
    const merged = mergeWithDefaults({ someFutureField: "x" } as Record<string, unknown>);
    expect((merged as unknown as Record<string, unknown>).someFutureField).toBe("x");
  });
});
