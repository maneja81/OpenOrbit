import { describe, expect, it } from "vitest";
import { methodGroup, requiresApproval, type ApprovalPolicy } from "./approvalPolicy";

const ALL_ON: ApprovalPolicy = { post: true, putPatch: true, delete: true };
const ALL_OFF: ApprovalPolicy = { post: false, putPatch: false, delete: false };

describe("methodGroup", () => {
  it("groups the write verbs, case- and whitespace-insensitively", () => {
    expect(methodGroup("POST")).toBe("post");
    expect(methodGroup("post")).toBe("post");
    expect(methodGroup(" put ")).toBe("putPatch");
    expect(methodGroup("PATCH")).toBe("putPatch");
    expect(methodGroup("DELETE")).toBe("delete");
  });

  it("treats reads and anything unrecognised as a read", () => {
    expect(methodGroup("GET")).toBe("read");
    expect(methodGroup("HEAD")).toBe("read");
    // An unclassifiable verb must not prompt on every call.
    expect(methodGroup("OPTIONS")).toBe("read");
    expect(methodGroup("")).toBe("read");
  });
});

describe("requiresApproval", () => {
  it("never asks for a read, whatever the policy says", () => {
    expect(requiresApproval("GET", ALL_ON)).toBe(false);
    expect(requiresApproval("HEAD", ALL_ON)).toBe(false);
  });

  it("asks for every write when everything is on", () => {
    expect(requiresApproval("POST", ALL_ON)).toBe(true);
    expect(requiresApproval("PUT", ALL_ON)).toBe(true);
    expect(requiresApproval("PATCH", ALL_ON)).toBe(true);
    expect(requiresApproval("DELETE", ALL_ON)).toBe(true);
  });

  it("asks for nothing when everything is off", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "GET"]) {
      expect(requiresApproval(method, ALL_OFF), method).toBe(false);
    }
  });

  it("supports the 'only DELETE needs approval' posture", () => {
    const deleteOnly: ApprovalPolicy = { post: false, putPatch: false, delete: true };
    expect(requiresApproval("POST", deleteOnly)).toBe(false);
    expect(requiresApproval("PUT", deleteOnly)).toBe(false);
    expect(requiresApproval("PATCH", deleteOnly)).toBe(false);
    expect(requiresApproval("DELETE", deleteOnly)).toBe(true);
  });

  it("treats PUT and PATCH as one switch", () => {
    const updatesOnly: ApprovalPolicy = { post: false, putPatch: true, delete: false };
    expect(requiresApproval("PUT", updatesOnly)).toBe(true);
    expect(requiresApproval("PATCH", updatesOnly)).toBe(true);
  });
});
