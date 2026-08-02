import dns from "node:dns";

/** IPv4 ranges that must never be reachable from the knowledgebase "Add from URL" flow:
 * loopback, RFC1918 private space, link-local (includes the 169.254.169.254
 * cloud-metadata address), and the unspecified address. */
const BLOCKED_IPV4_RANGES: [number, number][] = [
  [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],
  [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],
  [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],
  [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],
  [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],
  [ipv4ToInt("0.0.0.0"), ipv4ToInt("0.255.255.255")],
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpv4(host: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isBlockedIpv4(host: string): boolean {
  if (!isIpv4(host)) return false;
  const value = ipv4ToInt(host);
  return BLOCKED_IPV4_RANGES.some(([lo, hi]) => value >= lo && value <= hi);
}

/** Decodes an IPv4-mapped IPv6 address into dotted-decimal, handling both the
 * dotted form (::ffff:127.0.0.1) and the compressed-hex form Node's URL parser
 * actually produces (::ffff:7f00:1 — the last two hex groups pack the 4 octets). */
function decodeMappedIpv4(normalized: string): string | null {
  const dotted = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

/** IPv6 loopback (::1), unique-local (fc00::/7), and link-local (fe80::/10) — plus
 * IPv4-mapped IPv6 addresses (::ffff:127.0.0.1 etc.), which are re-checked as IPv4. */
function isBlockedIpv6(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1") return true;
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true; // fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7
  const mapped = decodeMappedIpv4(normalized);
  if (mapped) return isBlockedIpv4(mapped);
  return false;
}

function isBlockedHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (isBlockedIpv4(normalized)) return true;
  if (normalized.includes(":") && isBlockedIpv6(normalized)) return true;
  return false;
}

/** Validates a URL is safe to fetch from the knowledgebase "Add from URL"/discovery/sitemap flows:
 * http(s) only, and neither the literal hostname nor any of its DNS-resolved addresses
 * point at loopback/private/link-local space. The resolved-address check defends against
 * DNS rebinding (a hostname that looks public but resolves to an internal address at
 * request time). Throws with a message suitable for surfacing to the user via
 * humanizeError; returns the parsed URL on success so callers can reuse it. */
export async function assertPublicHttpUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Refusing to fetch non-http(s) URL: "${url}"`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Refusing to fetch a local/private address: "${url}"`);
  }

  try {
    // dns.lookup rejects a bracketed IPv6 literal outright — strip the brackets
    // WHATWG URL puts around parsed.hostname so this check actually runs instead
    // of silently no-op'ing via the "DNS failure isn't a security failure" catch below.
    const bareHost = parsed.hostname.replace(/^\[|\]$/g, "");
    const addresses = await dns.promises.lookup(bareHost, { all: true });
    if (addresses.some((a) => isBlockedHost(a.address))) {
      throw new Error(`Refusing to fetch "${url}": resolves to a local/private address`);
    }
  } catch (e) {
    // Only re-throw if this is our own rejection above — a DNS lookup failure itself
    // (unknown host, network down) isn't a security check failure, let the caller's
    // normal fetch-failure path surface that naturally.
    if (e instanceof Error && e.message.startsWith("Refusing to fetch")) throw e;
  }

  return parsed;
}
