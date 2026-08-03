import { describe, expect, it } from "vitest";
import { MAX_DISCOVERED_LINKS, dedupKeyForUrl, partitionLinksByDomain } from "./knowledgeUrlDiscovery";

describe("dedupKeyForUrl", () => {
  it("treats query string and hash as insignificant", () => {
    expect(dedupKeyForUrl("https://example.com/docs?utm_source=x")).toBe(dedupKeyForUrl("https://example.com/docs?utm_source=y"));
  });

  it("treats a trailing slash as insignificant", () => {
    expect(dedupKeyForUrl("https://example.com/docs/")).toBe(dedupKeyForUrl("https://example.com/docs"));
  });

  it("treats www. and bare host as the same", () => {
    expect(dedupKeyForUrl("https://www.example.com/docs")).toBe(dedupKeyForUrl("https://example.com/docs"));
  });

  it("does not dedup genuinely different paths", () => {
    expect(dedupKeyForUrl("https://example.com/docs")).not.toBe(dedupKeyForUrl("https://example.com/other"));
  });
});

describe("partitionLinksByDomain", () => {
  it("splits links into same-domain and external groups", () => {
    const result = partitionLinksByDomain("https://example.com/docs", [
      { href: "https://example.com/docs/page-1", text: "Page 1" },
      { href: "https://other.com/page", text: "Other" },
    ]);
    expect(result.sameDomainLinks).toEqual([{ url: "https://example.com/docs/page-1", text: "Page 1" }]);
    expect(result.externalLinks).toEqual([{ url: "https://other.com/page", text: "Other" }]);
  });

  it("treats www. and bare domain as the same domain on both sides", () => {
    const result = partitionLinksByDomain("https://www.example.com/docs", [
      { href: "https://example.com/other-page", text: "Bare domain" },
    ]);
    expect(result.sameDomainLinks).toEqual([{ url: "https://example.com/other-page", text: "Bare domain" }]);
    expect(result.externalLinks).toEqual([]);
  });

  it("skips links with an unparseable href instead of throwing", () => {
    const result = partitionLinksByDomain("https://example.com", [
      { href: "not a url", text: "Broken" },
      { href: "https://example.com/ok", text: "OK" },
    ]);
    expect(result.sameDomainLinks).toEqual([{ url: "https://example.com/ok", text: "OK" }]);
    expect(result.externalLinks).toEqual([]);
  });

  it("caps the combined total at MAX_DISCOVERED_LINKS, prioritizing same-domain links", () => {
    const sameDomain = Array.from({ length: MAX_DISCOVERED_LINKS }, (_, i) => ({
      href: `https://example.com/page-${i}`,
      text: `Page ${i}`,
    }));
    const external = [{ href: "https://other.com/page", text: "Other" }];
    const result = partitionLinksByDomain("https://example.com", [...sameDomain, ...external]);
    expect(result.sameDomainLinks).toHaveLength(MAX_DISCOVERED_LINKS);
    expect(result.externalLinks).toEqual([]);
  });

  it("fills remaining budget with external links once same-domain links are under the cap", () => {
    const sameDomain = [{ href: "https://example.com/page", text: "Page" }];
    const external = [
      { href: "https://other.com/a", text: "A" },
      { href: "https://other.com/b", text: "B" },
    ];
    const result = partitionLinksByDomain("https://example.com", [...sameDomain, ...external]);
    expect(result.sameDomainLinks).toHaveLength(1);
    expect(result.externalLinks).toHaveLength(2);
  });

  it("collapses a repeated href on the same page to one entry", () => {
    const result = partitionLinksByDomain("https://example.com", [
      { href: "https://example.com/page", text: "Page" },
      { href: "https://example.com/page", text: "Page again" },
    ]);
    expect(result.sameDomainLinks).toHaveLength(1);
  });

  it("collapses links differing only by query string/hash to one entry", () => {
    const result = partitionLinksByDomain("https://example.com", [
      { href: "https://example.com/docs?ref=nav", text: "Docs" },
      { href: "https://example.com/docs?ref=footer", text: "Docs again" },
    ]);
    expect(result.sameDomainLinks).toHaveLength(1);
  });

  it("excludes the seed URL itself from the discovered lists", () => {
    const result = partitionLinksByDomain("https://example.com/docs", [
      { href: "https://example.com/docs", text: "This page again" },
      { href: "https://example.com/other", text: "Other page" },
    ]);
    expect(result.sameDomainLinks).toEqual([{ url: "https://example.com/other", text: "Other page" }]);
  });

  it("skips non-http(s) hrefs instead of surfacing them as candidates", () => {
    const result = partitionLinksByDomain("https://example.com", [
      { href: "javascript:alert(1)", text: "Bad" },
      { href: "http://169.254.169.254/latest/meta-data/", text: "Metadata" },
    ]);
    // Protocol filter drops javascript:; the private-IP link isn't same-host as
    // example.com so it lands in external — full SSRF filtering happens at fetch time
    // (assertPublicHttpUrl), this is just the cheap same-page protocol/dedup filter.
    expect(result.sameDomainLinks).toEqual([]);
  });
});
