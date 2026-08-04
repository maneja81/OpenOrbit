/**
 * Outbound links shown in Settings → About.
 *
 * Docs and Report a Bug point at the public repo and ship enabled. Privacy and Terms have
 * no destination yet, so they keep a `#` placeholder and render as disabled rows — they are
 * never passed to `fs.openExternal`, which **throws** on any non-http(s) URL (see
 * electron/main/ipc/filesystem.ts). Guard with isPlaceholderLink before opening anything.
 *
 * Every link is overridable at build time via its VITE_ env var, so a future docs site or
 * policy page needs no code change.
 */

export const REPO_URL = "https://github.com/maneja81/OpenOrbit";

export const APP_LINKS = {
  /** No docs site exists yet, so the repo README is the honest destination. */
  docs: import.meta.env.VITE_APP_DOCS_URL ?? REPO_URL,
  /** Requires Issues to be enabled on the repo — it is off at the time of writing. */
  bug: import.meta.env.VITE_APP_BUG_URL ?? `${REPO_URL}/issues`,
  privacy: import.meta.env.VITE_APP_PRIVACY_URL ?? "#privacy",
  terms: import.meta.env.VITE_APP_TERMS_URL ?? "#terms",
  wiki: import.meta.env.VITE_APP_WIKI_URL ?? `${REPO_URL}/wiki`,
} as const;

export type AppLinkKey = keyof typeof APP_LINKS;

/** True for a link with no real destination configured. */
export function isPlaceholderLink(url: string): boolean {
  return url.startsWith("#");
}
