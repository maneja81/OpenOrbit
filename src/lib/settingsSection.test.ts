import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS_SECTION, sectionOnTransition } from "./settingsSection";

/**
 * SettingsPanel's `activeSection` outlives a close, so the panel used to reopen wherever it
 * was last left. The About button deep-links by requesting a section, which meant pressing
 * [i] and then the gear landed back on About with nothing explaining why.
 */
describe("sectionOnTransition", () => {
  it("honours a requested section when opening — the About deep-link", () => {
    expect(sectionOnTransition({ opening: true, open: true, requested: "about" })).toBe("about");
  });

  /** The regression this fixes: the gear asks for nothing, so it must not inherit the last
   * visit's section. */
  it("starts from the default when opening with nothing requested — the gear", () => {
    expect(sectionOnTransition({ opening: true, open: true, requested: undefined })).toBe(DEFAULT_SETTINGS_SECTION);
  });

  /** The tour walks two consecutive requested sections without closing in between, so a
   * changed request while already open still has to move the panel. */
  it("follows a changed request while already open", () => {
    expect(sectionOnTransition({ opening: false, open: true, requested: "connectors" })).toBe("connectors");
  });

  /** A manual sidebar click leaves `requested` untouched, so nothing must override it —
   * returning the default here would snap the user back to AI Models mid-navigation. */
  it("leaves manual navigation alone while open", () => {
    expect(sectionOnTransition({ opening: false, open: true, requested: undefined })).toBeNull();
  });

  it("changes nothing while closed", () => {
    expect(sectionOnTransition({ opening: false, open: false, requested: undefined })).toBeNull();
    expect(sectionOnTransition({ opening: false, open: false, requested: "about" })).toBeNull();
  });

  it("defaults to a section that exists", () => {
    expect(DEFAULT_SETTINGS_SECTION).toBe("models");
  });
});
