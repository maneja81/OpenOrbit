import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { APP_LICENSE } from "./appLicense";

describe("APP_LICENSE", () => {
  it("declares MIT with a copyright holder", () => {
    expect(APP_LICENSE.spdx).toBe("MIT");
    expect(APP_LICENSE.copyright).toContain("Mohit Aneja");
  });

  it("carries the MIT permission notice", () => {
    expect(APP_LICENSE.text).toContain("Permission is hereby granted, free of charge");
    expect(APP_LICENSE.text).toContain("THE SOFTWARE IS PROVIDED \"AS IS\"");
  });

  it("has not drifted from the root LICENSE file that ships with the source", () => {
    // The displayed text and the shipped file must say the same thing — editing one and
    // not the other would mean the app shows a licence the repo does not grant.
    const shipped = readFileSync(path.join(process.cwd(), "LICENSE"), "utf-8");
    expect(APP_LICENSE.text.trim()).toBe(shipped.trim());
  });
});
