/**
 * Whether a provider URL is about to send the API key across a network in the clear.
 *
 * Every provider call attaches `Authorization: Bearer <key>` to whatever host these settings
 * name, so an `http://` endpoint puts the key on the wire unencrypted. Plain http isn't refused
 * outright — the app explicitly invites pointing at Ollama or another self-hosted server, and
 * those are http — so this warns instead, and only when the traffic would actually leave the
 * machine or the local network.
 *
 * Deliberately its own small implementation rather than reaching for `net/urlSafety.ts`: that one
 * is main-process code, imports `node:dns`, and its exported entry point is async because it
 * resolves the hostname to defend against DNS rebinding. None of that belongs in a settings field
 * that has to render a hint as you type. The two answer different questions — that one asks "is
 * this safe to fetch", this one asks "would the key travel in the clear".
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(host)) return true;
  // `.localhost` is reserved for loopback, and `.local` is mDNS on the local network.
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^127\./.test(host)) return true;
  // RFC1918 private space, plus link-local.
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10), with or without brackets.
  const bare = host.replace(/^\[|\]$/g, "");
  if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(bare)) return true;
  return false;
}

/**
 * A warning to show under a provider URL field, or null when there is nothing to say.
 *
 * Empty and unparseable both return null: empty means "use the default", and an unparseable value
 * is already refused at the write boundary, so warning about it here would be noise on top of a
 * rejection.
 */
export function providerUrlWarning(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:") return null;
  if (isLocalHostname(parsed.hostname)) return null;

  return "This is a plain http:// address, so your API key will be sent unencrypted. Use https:// unless this host is on your own machine or network.";
}
