import { describe, expect, it, vi } from "vitest";
import { FALLBACK_RELEASE_INFO, resolveReleaseInfo } from "./releaseInfo";

const REPO = "maneja81/OpenOrbit";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe("resolveReleaseInfo", () => {
  it("maps a published release onto the injected fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        tag_name: "v1.2.0",
        published_at: "2026-07-12T09:30:00Z",
        body: "- First bullet\n- Second bullet",
        html_url: "https://github.com/maneja81/OpenOrbit/releases/tag/v1.2.0",
      })
    );

    const info = await resolveReleaseInfo({ repo: REPO, fetchImpl });

    expect(info.version).toBe("1.2.0");
    expect(info.releaseDate).toBe("2026-07-12T09:30:00Z");
    expect(info.releaseNotes).toBe("- First bullet\n- Second bullet");
    expect(info.releaseUrl).toBe("https://github.com/maneja81/OpenOrbit/releases/tag/v1.2.0");
  });

  it("requests the latest-release endpoint unauthenticated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: "v1.0.0" }));

    await resolveReleaseInfo({ repo: REPO, fetchImpl });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/maneja81/OpenOrbit/releases/latest");
    expect(options.headers).toEqual({ Accept: "application/vnd.github+json" });
    // A bundled token would be extractable from the shipped app — there must never be one.
    expect(JSON.stringify(options.headers)).not.toMatch(/authorization|bearer|token/i);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("honours a repo override", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: "v1.0.0" }));

    await resolveReleaseInfo({ repo: "someone/else", fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toContain("/repos/someone/else/releases/latest");
  });

  it("falls back to 0.0.0 on a 404 — the repo's current state, with no release published", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "Not Found" }, false));

    const info = await resolveReleaseInfo({ repo: REPO, fetchImpl });

    expect(info).toMatchObject(FALLBACK_RELEASE_INFO);
    expect(info.version).toBe("0.0.0");
  });

  it("falls back when the network is unavailable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(resolveReleaseInfo({ repo: REPO, fetchImpl })).resolves.toMatchObject(FALLBACK_RELEASE_INFO);
  });

  it("falls back when the request times out", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "TimeoutError"));

    await expect(resolveReleaseInfo({ repo: REPO, fetchImpl })).resolves.toMatchObject(FALLBACK_RELEASE_INFO);
  });

  it("falls back when the response body is not valid JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    await expect(resolveReleaseInfo({ repo: REPO, fetchImpl })).resolves.toMatchObject(FALLBACK_RELEASE_INFO);
  });

  it("falls back when a 200 carries no usable tag", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: "", body: "notes with no tag" }));

    const info = await resolveReleaseInfo({ repo: REPO, fetchImpl });

    expect(info.version).toBe("0.0.0");
    expect(info.releaseNotes).toBe("");
  });

  it("tolerates a release tag with no leading v", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: "2.0.1" }));

    expect((await resolveReleaseInfo({ repo: REPO, fetchImpl })).version).toBe("2.0.1");
  });

  it("always returns a string commit, whatever happened to the fetch", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));

    expect(typeof (await resolveReleaseInfo({ repo: REPO, fetchImpl })).commit).toBe("string");
  });
});
