import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { THIRD_PARTY_NOTICES } from "./thirdPartyNotices";

describe("THIRD_PARTY_NOTICES", () => {
  it("gives every entry the fields CLAUDE.md's attribution convention requires", () => {
    expect(THIRD_PARTY_NOTICES.length).toBeGreaterThan(0);
    for (const notice of THIRD_PARTY_NOTICES) {
      expect(notice.name.trim(), "name").not.toBe("");
      expect(notice.version.trim(), `${notice.name} version`).not.toBe("");
      expect(notice.copyright.trim(), `${notice.name} copyright`).not.toBe("");
      expect(notice.license.trim(), `${notice.name} license`).not.toBe("");
      expect(notice.licenseText.trim(), `${notice.name} licenseText`).not.toBe("");
      expect(notice.path.trim(), `${notice.name} path`).not.toBe("");
      expect(notice.sourceUrl, `${notice.name} sourceUrl`).toMatch(/^https:\/\//);
    }
  });

  it("includes Tabler Icons with the vendored version and its real MIT text", () => {
    const tabler = THIRD_PARTY_NOTICES.find((n) => n.name.startsWith("Tabler Icons"));
    expect(tabler).toBeDefined();
    expect(tabler?.version).toBe("3.46.0");
    expect(tabler?.license).toBe("MIT");
    expect(tabler?.copyright).toContain("Paweł Kuna");
    // Imported with ?raw from the vendored file rather than retyped, so this asserts the
    // real upstream text made it into the bundle.
    expect(tabler?.licenseText).toContain("MIT License");
    expect(tabler?.licenseText).toContain("Copyright (c) 2020-2026 Paweł Kuna");
  });

  it("includes the bundled Pixabay media, pointing at the canonical licence", () => {
    const pixabay = THIRD_PARTY_NOTICES.find((n) => n.license === "Pixabay Content License");
    expect(pixabay).toBeDefined();
    expect(pixabay?.sourceUrl).toBe("https://pixabay.com");
    expect(pixabay?.licenseText).toContain("https://pixabay.com/service/license-summary/");
  });

  it("keeps the licence file shipped beside the media it covers", () => {
    // The convention requires the upstream LICENSE to stay next to the vendored asset —
    // the screen is how users see it, the file is what ships with the source.
    expect(existsSync(path.join(process.cwd(), "src/vendor/tabler-icons/LICENSE"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "public/PIXABAY-LICENSE.txt"))).toBe(true);
  });
});
