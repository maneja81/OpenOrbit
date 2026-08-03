import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../net/urlSafety", () => ({
  assertPublicHttpUrl: async (url: string) => new URL(url),
  // Redirect-following behavior is covered by urlSafety.test.ts — here it's a passthrough
  // so these tests can keep asserting against the plain global `fetch` mock.
  safeFetch: async (url: string, init?: RequestInit) => (globalThis.fetch as typeof fetch)(url, init),
}));

import { fetchSitemapUrls } from "./sitemapDiscovery";

const fetchMock = vi.fn();

describe("fetchSitemapUrls", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a leaf sitemap into a URL list", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>`,
    });

    const result = await fetchSitemapUrls("https://example.com/docs");
    expect(result).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("follows a sitemap-index tree and flattens child sitemaps", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          `<sitemapindex><sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap></sitemapindex>`,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `<urlset><url><loc>https://example.com/child-page</loc></url></urlset>`,
      });

    const result = await fetchSitemapUrls("https://example.com/");
    expect(result).toEqual(["https://example.com/child-page"]);
  });

  it("returns null when the sitemap request fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, text: async () => "" });
    expect(await fetchSitemapUrls("https://example.com/")).toBeNull();
  });

  it("returns null on malformed/empty XML instead of throwing", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "not xml at all" });
    expect(await fetchSitemapUrls("https://example.com/")).toBeNull();
  });

  it("decodes escaped XML entities in <loc> URLs (e.g. &amp; in query strings)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        `<urlset><url><loc>https://example.com/p?a=1&amp;b=2</loc></url></urlset>`,
    });
    const result = await fetchSitemapUrls("https://example.com/");
    expect(result).toEqual(["https://example.com/p?a=1&b=2"]);
  });

  it("extracts CDATA-wrapped <loc> URLs", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => `<urlset><url><loc><![CDATA[https://example.com/cdata]]></loc></url></urlset>`,
    });
    const result = await fetchSitemapUrls("https://example.com/");
    expect(result).toEqual(["https://example.com/cdata"]);
  });

  it("never fetches more than the child-sitemap cap, even with a larger index", async () => {
    const childSitemaps = Array.from(
      { length: 30 },
      (_, i) => `<sitemap><loc>https://example.com/sitemap-${i}.xml</loc></sitemap>`
    ).join("");
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/sitemap.xml") {
        return { ok: true, text: async () => `<sitemapindex>${childSitemaps}</sitemapindex>` };
      }
      return {
        ok: true,
        text: async () => `<urlset><url><loc>${url}-page</loc></url></urlset>`,
      };
    });

    await fetchSitemapUrls("https://example.com/");
    // Root index fetch counts against the cap too, so total fetches (root + children)
    // never exceeds MAX_CHILD_SITEMAPS (20).
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});
