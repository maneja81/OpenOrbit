/**
 * Which URLs main is willing to hand to the OS via `shell.openExternal`.
 *
 * Two callers reach `openExternal`, and they are deliberately not the same policy:
 *
 *  - `setWindowOpenHandler` (index.ts) receives whatever the renderer passed to
 *    `window.open`. ChatBubble routes `mailto:` and `tel:` links there as well as
 *    `http(s)`, so this path allows all four — see `isOpenableExternally`.
 *  - `fs:openExternal` (ipc/filesystem.ts) is only ever given a page URL, so it stays
 *    http(s)-only and rejects the rest — see `isHttpUrl`.
 *
 * The renderer already filters both paths (`ChatBubble.isSafeHref` /
 * `isExternallyOpenable`, `ChatImage.openable`). That is exactly the problem this module
 * exists to fix: the gate lived in the process that shouldn't be authoritative, in two
 * components with two slightly different allowlists. One future unguarded `window.open`
 * and a `file://` or `smb://` URL went straight to the OS handler.
 *
 * Parsing is delegated to `new URL()` rather than a regex on purpose: it normalises the
 * scheme (case, and the leading tab/newline/space that WHATWG strips) before we compare,
 * so `"\tjavascript:alert(1)"` cannot slip past a `^https?:` test.
 */

const WINDOW_OPEN_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);
const HTTP_SCHEMES = new Set(["http:", "https:"]);

function scheme(url: string): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).protocol;
  } catch {
    // No scheme, or unparseable. Either way there is nothing safe to hand the OS.
    return null;
  }
}

/** For the `window.open` path: pages, plus the two schemes that address a person. */
export function isOpenableExternally(url: string): boolean {
  const s = scheme(url);
  return s !== null && WINDOW_OPEN_SCHEMES.has(s);
}

/** For `fs:openExternal`: pages only. */
export function isHttpUrl(url: string): boolean {
  const s = scheme(url);
  return s !== null && HTTP_SCHEMES.has(s);
}
