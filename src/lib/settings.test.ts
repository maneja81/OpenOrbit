import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SOUND_FX_VARIANT_COUNT, mergeWithDefaults } from "./settings";

describe("mergeWithDefaults", () => {
  it("returns the defaults plus the key flags when given an empty object", () => {
    // The two *Set booleans are not settings — they stand in for the API keys, which
    // settings:get no longer returns. They are deliberately absent from DEFAULT_SETTINGS so it
    // keeps mirroring the persisted shape exactly (settingsDefaults.test.ts depends on that).
    expect(mergeWithDefaults({})).toEqual({
      ...DEFAULT_SETTINGS,
      chatApiKeySet: false,
      voiceApiKeySet: false,
    });
  });

  it("assumes no key is set until main says otherwise", () => {
    // Getting this backwards would show "a key is saved" on a fresh install.
    expect(mergeWithDefaults({}).chatApiKeySet).toBe(false);
    expect(mergeWithDefaults({}).voiceApiKeySet).toBe(false);
  });

  it("takes the key flags from the blob when present", () => {
    const merged = mergeWithDefaults({ chatApiKeySet: true, voiceApiKeySet: false });
    expect(merged.chatApiKeySet).toBe(true);
    expect(merged.voiceApiKeySet).toBe(false);
  });

  it("leaves the key values empty, since main never sends them", () => {
    expect(mergeWithDefaults({ chatApiKeySet: true }).chatApiKey).toBe("");
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

  it("drops unknown keys instead of carrying them through", () => {
    // This asserted the opposite until X4. Unknown keys cannot be written any more, but a
    // database from before the settings schema can still hold them, and carrying them into app
    // state only spreads the mess.
    const merged = mergeWithDefaults({ someFutureField: "x" } as Record<string, unknown>);
    expect("someFutureField" in merged).toBe(false);
  });

  describe("a stored value that doesn't match its default's type", () => {
    it("falls back rather than letting a stored null win", () => {
      // The case this exists for. A spread let null through, and `<input value={null}>` flips
      // React to an uncontrolled input — noisy in the console, and the field stops tracking state.
      expect(mergeWithDefaults({ chatApiUrl: null }).chatApiUrl).toBe("");
      expect(mergeWithDefaults({ agentName: null }).agentName).toBe("Orbit");
      expect(mergeWithDefaults({ voiceInputEnabled: null }).voiceInputEnabled).toBe(true);
    });

    it("falls back on a wrong primitive type", () => {
      expect(mergeWithDefaults({ agentName: 42 }).agentName).toBe("Orbit");
      expect(mergeWithDefaults({ locationEnabled: "true" }).locationEnabled).toBe(false);
      expect(mergeWithDefaults({ agentRunTimeoutSeconds: "60" }).agentRunTimeoutSeconds).toBe(60);
    });

    it("falls back when an id list isn't an array of strings", () => {
      // A null list reached components that iterate it.
      expect(mergeWithDefaults({ orchestratorMcpServerIds: null }).orchestratorMcpServerIds).toEqual([]);
      expect(mergeWithDefaults({ orchestratorConnectorIds: "gmail" }).orchestratorConnectorIds).toEqual([]);
      expect(mergeWithDefaults({ orchestratorMcpServerIds: ["ok", 3] }).orchestratorMcpServerIds).toEqual([]);
    });

    it("still accepts a well-formed id list", () => {
      expect(mergeWithDefaults({ orchestratorConnectorIds: ["gmail"] }).orchestratorConnectorIds).toEqual(["gmail"]);
      expect(mergeWithDefaults({ orchestratorMcpServerIds: [] }).orchestratorMcpServerIds).toEqual([]);
    });

    it("keeps falsy values, which are not the same as wrong", () => {
      expect(mergeWithDefaults({ agentName: "" }).agentName).toBe("");
      expect(mergeWithDefaults({ voiceInputEnabled: false }).voiceInputEnabled).toBe(false);
      expect(mergeWithDefaults({ bgMusicVolume: 0 }).bgMusicVolume).toBe(0);
    });
  });

  describe("sound variants", () => {
    it("clamps to the range the picker actually offers", () => {
      // Out of range, sfxPreviewSrc requests a file that isn't there — the preview silently does
      // nothing — and the Combobox shows a value absent from its own option list.
      expect(mergeWithDefaults({ soundVariantSend: 99 }).soundVariantSend).toBe(SOUND_FX_VARIANT_COUNT);
      expect(mergeWithDefaults({ soundVariantReceive: 0 }).soundVariantReceive).toBe(1);
      expect(mergeWithDefaults({ soundVariantStartup: -3 }).soundVariantStartup).toBe(1);
      expect(mergeWithDefaults({ soundVariantConsult: 99 }).soundVariantConsult).toBe(SOUND_FX_VARIANT_COUNT);
    });

    it("rounds a fractional variant to a real file", () => {
      expect(mergeWithDefaults({ soundVariantHandoff: 2.7 }).soundVariantHandoff).toBe(3);
    });

    it("leaves an in-range variant alone", () => {
      expect(mergeWithDefaults({ soundVariantComplete: 4 }).soundVariantComplete).toBe(4);
    });

    it("falls back to 1 when the stored value isn't a number at all", () => {
      expect(mergeWithDefaults({ soundVariantSend: "3" }).soundVariantSend).toBe(1);
      expect(mergeWithDefaults({ soundVariantSend: null }).soundVariantSend).toBe(1);
    });
  });
});
