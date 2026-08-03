/**
 * Content-Security-Policy for the renderer.
 *
 * The renderer makes no network requests of its own — every API call, tool run and connector
 * lives in the main process and arrives over IPC — so `connect-src 'none'` costs nothing and
 * removes the most useful primitive an injected script would have. Every asset is local: the
 * Tabler icon font is vendored under src/, the background video and audio ship in public/.
 *
 * `img-src` admits https: because replies legitimately contain remote images. That is not
 * what stops a prompt-injected tracking or exfiltration URL — no CSP can, once remote images
 * are allowed at all. The control for that is consent: ChatImage refuses to emit an <img>
 * for a remote URL until the user clicks Load, so the request is never made. This policy is
 * the layer underneath it, closing script, frame, object and connect.
 *
 * `style-src` needs 'unsafe-inline': ten components set style={{…}} for computed values
 * (orb geometry, meter widths), and React writes those as inline style attributes.
 *
 * `media-src` admits data: because useSpeak plays synthesized TTS audio via
 * `new Audio('data:audio/mp3;base64,...')` — the bytes come from the Voice API over IPC,
 * not a network fetch, so there's no bundled asset to point a `self` src at instead.
 */
const DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: https:",
  "media-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
];

/**
 * Dev serves the renderer from Vite, which injects an inline React-Refresh preamble, uses
 * eval for HMR, and opens a websocket back to the dev server. Relaxing exactly those two
 * directives keeps `npm run dev` working while every other one stays identical to
 * production, so a violation that matters is still caught while developing.
 */
const DEV_OVERRIDES: Record<string, string> = {
  "script-src": "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src": "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*",
};

export function contentSecurityPolicy(isDev: boolean): string {
  const directives = isDev
    ? DIRECTIVES.map((d) => DEV_OVERRIDES[d.split(" ")[0]] ?? d)
    : DIRECTIVES;
  return directives.join("; ");
}
