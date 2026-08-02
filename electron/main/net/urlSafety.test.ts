import { describe, expect, it, vi, afterEach } from "vitest";

// Real dns.lookup rejects with ENOTFOUND for hosts it can't resolve (e.g. a
// bracketed IPv6 literal, or any hostname a test hasn't explicitly configured) —
// the mock must reproduce that, not echo the hostname back as a fake "address".
vi.mock("node:dns", () => ({
  default: { promises: { lookup: vi.fn(async () => Promise.reject(new Error("ENOTFOUND"))) } },
}));

import dns from "node:dns";
import { assertPublicHttpUrl } from "./urlSafety";

describe("assertPublicHttpUrl", () => {
  afterEach(() => {
    vi.mocked(dns.promises.lookup).mockReset();
    vi.mocked(dns.promises.lookup).mockImplementation(async () => Promise.reject(new Error("ENOTFOUND")));
  });

  it("accepts a public https URL", async () => {
    vi.mocked(dns.promises.lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    await expect(assertPublicHttpUrl("https://example.com/docs")).resolves.toBeInstanceOf(URL);
  });

  it.each(["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)"])(
    "rejects non-http(s) protocol: %s",
    async (url) => {
      await expect(assertPublicHttpUrl(url)).rejects.toThrow(/non-http/);
    }
  );

  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://172.16.5.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/", // IPv4-mapped IPv6, dotted form
    "http://[::ffff:7f00:1]/", // IPv4-mapped IPv6, compressed-hex form (what new URL() actually produces)
    "http://[::ffff:10.0.0.1]/", // IPv4-mapped IPv6 into RFC1918 space
    "http://[fe80::1]/",
    "http://[fc00::1]/",
  ])("rejects a literal local/private address: %s", async (url) => {
    await expect(assertPublicHttpUrl(url)).rejects.toThrow(/local\/private/);
  });

  it("rejects a hostname that DNS-resolves to a private address (rebinding)", async () => {
    vi.mocked(dns.promises.lookup).mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);
    await expect(assertPublicHttpUrl("http://looks-public.example.com/")).rejects.toThrow(/local\/private/);
  });

  it("does not treat a DNS lookup failure as a security rejection", async () => {
    vi.mocked(dns.promises.lookup).mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertPublicHttpUrl("https://nonexistent.example.invalid/")).resolves.toBeInstanceOf(URL);
  });

  it("rejects an invalid URL string", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow(/not a valid URL/);
  });
});
