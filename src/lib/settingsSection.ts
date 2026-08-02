import type { SettingsSection } from "@/components/organisms/SettingsPanel";

/** Where the gear lands when nothing specific was asked for. */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = "models";

/**
 * Which section a Settings panel transition should move to, or null to leave it where it is.
 *
 * `activeSection` is component state that outlives a close, so before this existed the panel
 * simply reopened wherever it was last left. That is fine after a manual visit, but the
 * About button deep-links here by requesting a section — so pressing [i] and then the gear
 * landed the user back on About, with no way to tell why.
 *
 * Opening with a requested section honours it (deep-links, and the tour, which walks two
 * consecutive requested sections without closing in between). Opening *without* one is the
 * gear, which is a generic entry point and so starts from the default. Anything else —
 * closing, or a re-render while open — returns null, so a manual sidebar click is never
 * clobbered.
 */
export function sectionOnTransition({
  opening,
  open,
  requested,
}: {
  opening: boolean;
  open: boolean;
  requested: SettingsSection | undefined;
}): SettingsSection | null {
  if (!open) return null;
  if (requested) return requested;
  return opening ? DEFAULT_SETTINGS_SECTION : null;
}
