import { describe, expect, it } from "vitest";
import { APP_LINKS, REPO_URL, isPlaceholderLink } from "./appLinks";

describe("isPlaceholderLink", () => {
  it("flags links with no configured destination", () => {
    expect(isPlaceholderLink("#privacy")).toBe(true);
    expect(isPlaceholderLink("#terms")).toBe(true);
  });

  it("does not flag real URLs", () => {
    expect(isPlaceholderLink(REPO_URL)).toBe(false);
    expect(isPlaceholderLink("https://example.com/docs")).toBe(false);
  });
});

describe("APP_LINKS", () => {
  it("ships Docs and Report a Bug against real https destinations", () => {
    expect(APP_LINKS.docs).toMatch(/^https:\/\//);
    expect(APP_LINKS.bug).toMatch(/^https:\/\//);
    expect(isPlaceholderLink(APP_LINKS.docs)).toBe(false);
    expect(isPlaceholderLink(APP_LINKS.bug)).toBe(false);
  });

  it("points the bug link at the repo's issue tracker", () => {
    expect(APP_LINKS.bug).toBe(`${REPO_URL}/issues`);
  });

  it("leaves Privacy and Terms as placeholders until real URLs exist", () => {
    expect(isPlaceholderLink(APP_LINKS.privacy)).toBe(true);
    expect(isPlaceholderLink(APP_LINKS.terms)).toBe(true);
  });

  it("never carries a link fs.openExternal would reject unguarded", () => {
    // fs:openExternal throws on any non-http(s) URL, so a placeholder reaching it is a
    // runtime error rather than a no-op — every link is either https or caught by the guard.
    for (const url of Object.values(APP_LINKS)) {
      expect(isPlaceholderLink(url) || url.startsWith("https://")).toBe(true);
    }
  });
});
