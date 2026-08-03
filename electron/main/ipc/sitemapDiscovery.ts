import { safeFetch } from "../net/urlSafety";
import { MAX_DISCOVERED_LINKS } from "./knowledgeUrlDiscovery";

const SITEMAP_FETCH_TIMEOUT_MS = 10_000;
// A sitemap index can point at other sitemaps — cap how many we'll follow so a
// pathological/malicious sitemap tree can't make discovery hang or balloon.
const MAX_CHILD_SITEMAPS = 20;

/** Raw-XML fetch, not via callDaemon: the daemon's only confirmed endpoint (/fetch-web)
 * is built for readability-extracted page content, not sitemap XML, and open-websearch's
 * source wasn't available to verify any other endpoint exists (node_modules not installed
 * in this environment) — a direct guarded fetch keeps this independently testable without
 * depending on undocumented daemon internals. */
async function guardedFetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITEMAP_FETCH_TIMEOUT_MS);
  try {
    // safeFetch validates the URL and re-validates every redirect hop, so a sitemap host
    // that 302s to a private/metadata address is refused rather than followed blind.
    const res = await safeFetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
};

function decodeXmlEntities(text: string): string {
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&apos;|&#39;/g, (m) => XML_ENTITIES[m]);
}

function extractLocText(raw: string): string {
  const trimmed = raw.trim();
  const cdata = trimmed.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  const inner = cdata ? cdata[1] : trimmed;
  return decodeXmlEntities(inner).trim();
}

function extractLocs(xml: string, tag: "sitemap" | "url"): string[] {
  const blockPattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  const locPattern = /<loc>([\s\S]+?)<\/loc>/i;
  const locs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(xml)) !== null) {
    const locMatch = locPattern.exec(match[1]);
    if (locMatch) locs.push(extractLocText(locMatch[1]));
  }
  return locs;
}

async function fetchSitemapTree(url: string, depth: number, seen: Set<string>): Promise<string[]> {
  if (seen.has(url) || seen.size >= MAX_CHILD_SITEMAPS) return [];
  seen.add(url);
  const xml = await guardedFetchText(url);
  if (!xml) return [];

  if (/<sitemapindex/i.test(xml)) {
    const childUrls = extractLocs(xml, "sitemap").slice(0, Math.max(0, MAX_CHILD_SITEMAPS - seen.size));
    const results: string[] = [];
    for (const childUrl of childUrls) {
      if (results.length >= MAX_DISCOVERED_LINKS) break;
      results.push(...(await fetchSitemapTree(childUrl, depth + 1, seen)));
    }
    return results;
  }

  return extractLocs(xml, "url");
}

/** Fetches and parses sitemap.xml (following a sitemap-index tree if present) for the
 * given origin. Returns null (not []) when no sitemap exists or it fails to
 * fetch/parse, so callers can fall back to the existing single-page link scan — the
 * distinction between "no sitemap" and "sitemap exists but empty" matters for that
 * fallback decision even though both currently take the same fallback path. */
export async function fetchSitemapUrls(originUrl: string): Promise<string[] | null> {
  let origin: string;
  try {
    origin = new URL(originUrl).origin;
  } catch {
    return null;
  }
  const urls = await fetchSitemapTree(`${origin}/sitemap.xml`, 0, new Set());
  if (urls.length === 0) return null;
  return urls.slice(0, MAX_DISCOVERED_LINKS);
}
