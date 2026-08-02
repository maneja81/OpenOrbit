/**
 * Display formatting for Settings → About. Kept here rather than inline in AboutTab so it
 * is unit-testable, matching the convention orbStatus.ts set.
 *
 * Every function is a pure function of its arguments — none reads the clock. `new Date(iso)`
 * parses a value it was handed, which is why it is safe under the React Compiler purity
 * rules this project enforces (a `Date.now()` here would not be).
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/** os.platform() returns kernel identifiers; users know the product names. */
const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** "2h 14m" / "12m". Anything under a minute reads as text rather than "0m", which looks broken. */
export function formatUptime(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "Less than a minute";
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  if (totalMinutes < 1) return "Less than a minute";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** "12 Jul 2026", or "" for the empty/invalid dates a build with no release produces.
 * Formatted from UTC parts rather than toLocaleDateString so the output does not shift
 * with the machine's timezone or locale. */
export function formatReleaseDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "macOS" for os.platform()'s "darwin". Unknown platforms fall through unchanged rather
 * than being hidden — an unrecognised id is still more useful than nothing. */
export function formatPlatformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US");
}
