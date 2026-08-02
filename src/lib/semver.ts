/**
 * Minimal dotted-numeric version comparison, used only to decide whether the latest
 * published release is newer than the running build (Settings → About). Deliberately not a
 * semver dependency: this is the single comparison the app makes.
 *
 * Segments that aren't numbers — a "1.2.0-beta" suffix, an empty string — count as 0, so
 * comparison degrades to "equal" rather than throwing on input the app doesn't produce.
 */

function segments(version: string): number[] {
  return version.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
}

/** -1 when `a` is older than `b`, 1 when newer, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

/** True when a published release is worth telling the user about. Both arguments must be
 * real versions — "0.0.0" is the resolver's "no release found" sentinel and never counts. */
export function isUpdateAvailable(latestRelease: string, currentBuild: string): boolean {
  if (!latestRelease || latestRelease === "0.0.0") return false;
  return compareVersions(latestRelease, currentBuild) > 0;
}
