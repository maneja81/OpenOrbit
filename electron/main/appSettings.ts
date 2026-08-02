import { getSetting } from "./db/settingsStore";
import { SETTING_DEFAULTS, validateSettingValue, type SettingKey, type SettingValue } from "./settingsSchema";
import { devLog } from "./devLog";

/** Namespace every user-facing setting is stored under. Matches ipc/settings.ts. */
const NAMESPACE = "appSettings.";

/**
 * Reads one app setting, checked against its declared shape, falling back to `fallback` if the
 * stored row is missing or unusable.
 *
 * `getSetting<number>(…)` is a type *assertion*, not a check — it tells the compiler what the
 * row holds and nothing verifies it. That was fine while the only writer validated, but rows
 * predate the write-side schema (X1), can be hand-edited, and survive a downgrade to a build
 * that wrote something else. The values this guards are used directly as a `setTimeout` delay,
 * a history slice size and a `setInterval` period, where a `0`, a negative, a string or a `null`
 * produces a broken runtime with no error: runs that time out instantly, an empty context
 * window, or a poll loop that pegs a core.
 *
 * Deliberately a separate layer rather than a change to `getSetting`, which is the generic KV
 * accessor and is also used for keys that have no schema entry — `allowedRoots`
 * (ipc/filesystem.ts) and the encryption key (security/secretStorage.ts).
 *
 * `fallback` defaults to the setting's canonical default, and callers should almost always let
 * it. Passing one inline is what let `voiceInputEnabled` end up `true` in the renderer and
 * `false` here (finding S1) — every call site was its own source of truth, so a disagreement was
 * invisible until someone compared two files. Pass one only for a genuinely local override, and
 * say why.
 */
export function readAppSetting<K extends SettingKey>(
  key: K,
  fallback: SettingValue<K> = SETTING_DEFAULTS[key]
): SettingValue<K> {
  const raw = getSetting<unknown>(NAMESPACE + key, undefined);
  // Absent row: the caller's default is the answer, and that is not worth logging — it is the
  // normal state of a setting the user has never touched.
  if (raw === undefined) return fallback;

  const result = validateSettingValue(key, raw);
  if (!result.ok) {
    // Never the value itself: this reaches userData/debug.log, which users attach to bug
    // reports, and the same key set includes API URLs that can carry credentials.
    devLog(`[settings] ${key} is unusable (${result.reason}) — using the default instead`);
    return fallback;
  }
  return result.value as SettingValue<K>;
}
