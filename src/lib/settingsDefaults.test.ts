import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import { SETTING_DEFAULTS } from "../../electron/main/settingsSchema";

/**
 * The renderer and the main process each hold their own copy of the settings defaults, because
 * `electron/` and `src/` are separate TypeScript projects and main has no path into the
 * renderer's tree. Two copies of the same facts drift, and this pair already had:
 * `voiceInputEnabled` and `typeAnywhereEnabled` were `true` in DEFAULT_SETTINGS and `false` at
 * every main-side read. Migrations never seed those rows, so on a fresh install the Settings
 * toggle showed "on" while the orchestrator's own view was "off" — and the orchestrator was
 * right about what main would actually do.
 *
 * This test is the thing that stops it recurring. It lives on the renderer side because that is
 * where both are reachable: `settingsSchema.ts` is deliberately dependency-free, so importing it
 * from here pulls in no Electron surface.
 */
describe("settings defaults, renderer vs main", () => {
  it("agree on every key and value", () => {
    expect(SETTING_DEFAULTS).toEqual(DEFAULT_SETTINGS);
  });

  it("cover exactly the same keys", () => {
    // Spelled out separately from the deep-equal above: a missing key and a wrong value fail
    // very differently, and a key that main has never heard of is silently unwritable rather
    // than merely wrong.
    expect(Object.keys(SETTING_DEFAULTS).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it("still has the two that used to disagree", () => {
    // The specific regression, named, so a future edit that reintroduces it fails with an
    // obvious message rather than a diff of forty keys.
    expect(SETTING_DEFAULTS.voiceInputEnabled).toBe(DEFAULT_SETTINGS.voiceInputEnabled);
    expect(SETTING_DEFAULTS.typeAnywhereEnabled).toBe(DEFAULT_SETTINGS.typeAnywhereEnabled);
    expect(SETTING_DEFAULTS.voiceInputEnabled).toBe(true);
    expect(SETTING_DEFAULTS.typeAnywhereEnabled).toBe(true);
  });

  it("keeps the security defaults off on both sides", () => {
    // These are the ones where being wrong is not merely inconsistent.
    expect(SETTING_DEFAULTS.locationEnabled).toBe(false);
    expect(SETTING_DEFAULTS.remoteImagesAutoLoad).toBe(false);
    expect(SETTING_DEFAULTS.httpToolApprovalPost).toBe(true);
    expect(SETTING_DEFAULTS.httpToolApprovalPutPatch).toBe(true);
    expect(SETTING_DEFAULTS.httpToolApprovalDelete).toBe(true);
  });
});
