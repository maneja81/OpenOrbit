/**
 * Resolves the app's release metadata once, at build time, for injection into the renderer
 * (see electron.vite.config.ts). Runs against the public release repo, so the request is
 * unauthenticated and no token is ever bundled into the app — only the resolved values are.
 *
 * Hard requirement: this must never throw and never reject. An offline `npm run build` has
 * to succeed, so every failure path resolves to FALLBACK_RELEASE_INFO instead. `0.0.0` is
 * the deliberate "no release tag found" sentinel; the About screen hides the row on it.
 */

import { execFileSync } from "node:child_process";

const GITHUB_API = "https://api.github.com";
const ACCEPT_HEADER = "application/vnd.github+json";
const DEFAULT_REPO = "maneja81/OpenOrbit";

// Bounds the worst case for `npm run dev` on a slow or captive network — without it, a
// hanging request would stall every build behind it.
const FETCH_TIMEOUT_MS = 3000;

export interface ReleaseInfo {
  /** Release tag with any leading "v" stripped, or "0.0.0" when no release was found. */
  version: string;
  /** Raw ISO timestamp from GitHub — formatted at display time, not here. */
  releaseDate: string;
  /** Release body as markdown. */
  releaseNotes: string;
  releaseUrl: string;
}

export interface ResolvedReleaseInfo extends ReleaseInfo {
  /** Short HEAD hash, or "" when built without a .git directory. */
  commit: string;
}

/** Only the surface this module actually uses, so tests can pass a plain object and the
 * global `fetch` still satisfies it. */
type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export const FALLBACK_RELEASE_INFO: ReleaseInfo = {
  version: "0.0.0",
  releaseDate: "",
  releaseNotes: "",
  releaseUrl: "",
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function resolveCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf-8",
      // stderr ignored so "not a git repository" doesn't pollute build output.
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** Maps GitHub's release payload onto our shape. Returns null when there is no usable tag. */
function mapRelease(payload: unknown): ReleaseInfo | null {
  const release = (payload ?? {}) as Record<string, unknown>;
  const version = asString(release.tag_name).replace(/^v/, "");
  if (!version) return null;
  return {
    version,
    releaseDate: asString(release.published_at),
    releaseNotes: asString(release.body),
    releaseUrl: asString(release.html_url),
  };
}

/**
 * Fetches the repo's latest published release. Returns null on any non-2xx — notably the
 * 404 GitHub returns when a repo has no releases yet, which is OpenOrbit's current state.
 */
export async function fetchLatestRelease(repo: string, fetchImpl: FetchLike = fetch): Promise<ReleaseInfo | null> {
  const response = await fetchImpl(`${GITHUB_API}/repos/${repo}/releases/latest`, {
    headers: { Accept: ACCEPT_HEADER },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return mapRelease(await response.json());
}

export async function resolveReleaseInfo({
  repo = process.env.GITHUB_RELEASE_REPO || DEFAULT_REPO,
  fetchImpl = fetch as FetchLike,
}: { repo?: string; fetchImpl?: FetchLike } = {}): Promise<ResolvedReleaseInfo> {
  const commit = resolveCommit();
  try {
    const release = await fetchLatestRelease(repo, fetchImpl);
    return { ...(release ?? FALLBACK_RELEASE_INFO), commit };
  } catch {
    // Offline, DNS failure, timeout, malformed JSON — all resolve to the fallback rather
    // than failing the build.
    return { ...FALLBACK_RELEASE_INFO, commit };
  }
}
