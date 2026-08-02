import { describe, expect, it } from "vitest";
import { isHttpUrl, isOpenableExternally } from "./externalUrl";

/** The obfuscation set the pending-items register probed against the renderer's anchor
 * policy. Main must reject every one of them on its own, without relying on the renderer
 * having filtered first — that independence is the whole point of this module. */
const HOSTILE = [
  "javascript:alert(1)",
  " javascript:alert(1)",
  "\tjavascript:alert(1)",
  "\njavascript:alert(1)",
  "java\tscript:alert(1)",
  "java\nscript:alert(1)",
  "JAVASCRIPT:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
];

describe("isOpenableExternally", () => {
  it("allows pages", () => {
    expect(isOpenableExternally("https://example.com/x")).toBe(true);
    expect(isOpenableExternally("http://example.com")).toBe(true);
  });

  /** ChatBubble routes these through window.open alongside http(s), so locking this path
   * to http(s) would have silently killed every mail and phone link in a reply. */
  it("allows the two schemes that address a person", () => {
    expect(isOpenableExternally("mailto:someone@example.com")).toBe(true);
    expect(isOpenableExternally("tel:+15551234567")).toBe(true);
  });

  it("refuses every hostile scheme", () => {
    for (const url of HOSTILE) {
      expect(isOpenableExternally(url), url).toBe(false);
    }
  });

  it("refuses other local and network schemes", () => {
    expect(isOpenableExternally("smb://host/share")).toBe(false);
    expect(isOpenableExternally("ftp://host/f")).toBe(false);
  });

  it("refuses anything that isn't a parseable absolute URL", () => {
    expect(isOpenableExternally("")).toBe(false);
    expect(isOpenableExternally("/just/a/path")).toBe(false);
    expect(isOpenableExternally("example.com")).toBe(false);
    expect(isOpenableExternally(undefined as unknown as string)).toBe(false);
    expect(isOpenableExternally(null as unknown as string)).toBe(false);
  });
});

describe("isHttpUrl", () => {
  it("allows only pages", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
  });

  /** Stricter than the window.open path on purpose: fs:openExternal is only ever handed a
   * page URL, and src/lib/appLinks.ts documents that it throws on anything else. */
  it("refuses mailto and tel, unlike the window.open path", () => {
    expect(isHttpUrl("mailto:someone@example.com")).toBe(false);
    expect(isHttpUrl("tel:+15551234567")).toBe(false);
  });

  it("refuses every hostile scheme", () => {
    for (const url of HOSTILE) {
      expect(isHttpUrl(url), url).toBe(false);
    }
  });
});
