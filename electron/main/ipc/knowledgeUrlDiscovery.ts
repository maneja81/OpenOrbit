export interface DiscoveredLink {
  url: string;
  text: string;
}

export interface DiscoveredLinks {
  seedUrl: string;
  title: string;
  sameDomainLinks: DiscoveredLink[];
  externalLinks: DiscoveredLink[];
}

/** Discovery is single-level (links found on the one entered page) — no recursive
 * crawling. Keeps the candidate list bounded regardless of how large the source page is. */
export const MAX_DISCOVERED_LINKS = 100;

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

/** Logical-page identity for dedup purposes: hostname + path, deliberately WITHOUT
 * query string/hash (so "/docs?utm_source=x" and "/docs?utm_source=y" collapse to one
 * candidate) and with a trailing slash stripped. This is intentionally narrower than
 * slugifyUrlFilename() in knowledgeBase.ts, which keeps query/hash so two genuinely
 * different query-param pages don't collide on disk — the two functions serve different
 * purposes (discovery-time "is this the same page?" vs storage-time "is this the same
 * file?") and should not be merged into one. */
export function dedupKeyForUrl(url: string): string {
  const parsed = new URL(url);
  const host = normalizeHostname(parsed.hostname.toLowerCase());
  const pathname = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  return `${host}${pathname}`;
}

/** Splits a page's outbound links into same-domain vs external groups (exact hostname
 * match after stripping a leading "www." from both sides), capped at MAX_DISCOVERED_LINKS
 * combined — same-domain links fill the cap first, external links take any remaining budget.
 * Links that fail to parse, or that resolve to a blocked (non-http(s)/local/private) address,
 * are silently dropped from the candidate list rather than surfaced or thrown — one bad link
 * on a page shouldn't fail the whole discovery. Duplicate links (by dedupKeyForUrl — same
 * logical page reached via different hrefs, including exact repeats) collapse to one entry,
 * first-seen wins. */
export function partitionLinksByDomain(
  seedUrl: string,
  links: { href: string; text: string }[]
): { sameDomainLinks: DiscoveredLink[]; externalLinks: DiscoveredLink[] } {
  const seedHost = normalizeHostname(new URL(seedUrl).hostname);
  const seedKey = dedupKeyForUrl(seedUrl);
  const same: DiscoveredLink[] = [];
  const external: DiscoveredLink[] = [];
  const seenKeys = new Set<string>([seedKey]);

  for (const link of links) {
    let parsed: URL;
    try {
      parsed = new URL(link.href);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    const key = dedupKeyForUrl(link.href);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const linkHost = normalizeHostname(parsed.hostname);
    const entry: DiscoveredLink = { url: link.href, text: link.text };
    if (linkHost === seedHost) same.push(entry);
    else external.push(entry);
  }

  const sameDomainLinks = same.slice(0, MAX_DISCOVERED_LINKS);
  const externalLinks = external.slice(0, Math.max(0, MAX_DISCOVERED_LINKS - sameDomainLinks.length));
  return { sameDomainLinks, externalLinks };
}
