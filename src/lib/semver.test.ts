import { describe, expect, it } from "vitest";
import { compareVersions, isUpdateAvailable } from "./semver";

describe("compareVersions", () => {
  it("orders by each numeric segment in turn", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("compares segments numerically, not as strings", () => {
    // The bug this guards: "10" < "9" lexically, so a string sort calls 1.10.0 older.
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
  });

  it("treats missing trailing segments as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
  });

  it("degrades to zero on non-numeric segments rather than throwing", () => {
    expect(compareVersions("1.2.0-beta", "1.2.0")).toBe(0);
    expect(compareVersions("", "")).toBe(0);
    expect(compareVersions("not-a-version", "0.0.0")).toBe(0);
  });
});

describe("isUpdateAvailable", () => {
  it("is true only when the published release is genuinely newer", () => {
    expect(isUpdateAvailable("0.2.0", "0.1.0")).toBe(true);
    expect(isUpdateAvailable("0.1.0", "0.1.0")).toBe(false);
    expect(isUpdateAvailable("0.1.0", "0.2.0")).toBe(false);
  });

  it("never reports an update for the no-release-found sentinel", () => {
    // 0.0.0 is what scripts/releaseInfo.ts returns on a 404 or an offline build — it must
    // never be presented as a release the user could go and get.
    expect(isUpdateAvailable("0.0.0", "0.1.0")).toBe(false);
    expect(isUpdateAvailable("", "0.1.0")).toBe(false);
  });
});
