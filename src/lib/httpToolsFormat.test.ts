import { describe, expect, it } from "vitest";
import {
  coerceSampleArgs,
  formatToolCountLabel,
  headersToText,
  isWriteMethod,
  parseHeaders,
  willAskApproval,
} from "./httpToolsFormat";

const ALL_ON = { post: true, putPatch: true, delete: true };
const DELETE_ONLY = { post: false, putPatch: false, delete: true };

const param = (over: Partial<HttpToolParam> & Pick<HttpToolParam, "name">): HttpToolParam => ({
  description: "",
  type: "string",
  required: true,
  location: "query",
  ...over,
});

describe("parseHeaders", () => {
  it("parses one KEY=value per line", () => {
    expect(parseHeaders("Authorization=Bearer abc\nAccept=application/json")).toEqual({
      Authorization: "Bearer abc",
      Accept: "application/json",
    });
  });

  it("splits on the first = only, so a value may contain =", () => {
    expect(parseHeaders("X-Token=a=b=c")).toEqual({ "X-Token": "a=b=c" });
  });

  it("skips blank lines, lines with no =, and lines with a blank key", () => {
    expect(parseHeaders("\n  \nnot-a-header\n=orphan\nOk=1")).toEqual({ Ok: "1" });
  });

  it("round-trips through headersToText", () => {
    const headers = { Authorization: "Bearer abc", Accept: "application/json" };
    expect(parseHeaders(headersToText(headers))).toEqual(headers);
  });
});

describe("isWriteMethod", () => {
  it("classifies state-changing methods regardless of case", () => {
    expect(isWriteMethod("post")).toBe(true);
    expect(isWriteMethod("PATCH")).toBe(true);
    expect(isWriteMethod("get")).toBe(false);
    expect(isWriteMethod("HEAD")).toBe(false);
  });
});

describe("coerceSampleArgs", () => {
  it("types values according to the parameter declaration", () => {
    const params = [
      param({ name: "id", type: "number" }),
      param({ name: "draft", type: "boolean" }),
      param({ name: "title", type: "string" }),
    ];
    expect(coerceSampleArgs(params, { id: "7", draft: "true", title: "hello" })).toEqual({
      id: 7,
      draft: true,
      title: "hello",
    });
  });

  it("omits blank and missing entries so an optional parameter stays absent", () => {
    const params = [param({ name: "id", type: "number" }), param({ name: "q", required: false })];
    expect(coerceSampleArgs(params, { id: "1", q: "   " })).toEqual({ id: 1 });
    expect(coerceSampleArgs(params, {})).toEqual({});
  });

  it("passes a non-numeric entry through rather than sending NaN", () => {
    // The request builder's own error names the problem better than a silent NaN would.
    expect(coerceSampleArgs([param({ name: "id", type: "number" })], { id: "abc" })).toEqual({ id: "abc" });
  });

  it("treats anything other than 'true' as false for a boolean", () => {
    const params = [param({ name: "draft", type: "boolean" })];
    expect(coerceSampleArgs(params, { draft: "TRUE" })).toEqual({ draft: true });
    expect(coerceSampleArgs(params, { draft: "no" })).toEqual({ draft: false });
  });
});

describe("willAskApproval", () => {
  it("mirrors the main-process resolver: reads never ask", () => {
    expect(willAskApproval("GET", ALL_ON)).toBe(false);
    expect(willAskApproval("HEAD", ALL_ON)).toBe(false);
    expect(willAskApproval("OPTIONS", ALL_ON)).toBe(false);
  });

  it("follows the policy per method group", () => {
    expect(willAskApproval("POST", ALL_ON)).toBe(true);
    expect(willAskApproval("post", DELETE_ONLY)).toBe(false);
    expect(willAskApproval("PUT", DELETE_ONLY)).toBe(false);
    expect(willAskApproval("PATCH", DELETE_ONLY)).toBe(false);
    expect(willAskApproval("delete", DELETE_ONLY)).toBe(true);
  });
});

describe("formatToolCountLabel", () => {
  const tool = (enabled: number, method = "GET") => ({ enabled, method });

  it("reports enabled count against the total", () => {
    expect(formatToolCountLabel([tool(1), tool(1), tool(0)], ALL_ON)).toBe("2 of 3 endpoints on");
    expect(formatToolCountLabel([tool(1)], ALL_ON)).toBe("1 of 1 endpoint on");
  });

  it("counts how many will ask under the current policy", () => {
    expect(formatToolCountLabel([tool(1, "GET"), tool(1, "POST")], ALL_ON)).toBe("2 of 2 endpoints on, 1 asks first");
    expect(formatToolCountLabel([tool(1, "POST"), tool(1, "DELETE")], ALL_ON)).toBe(
      "2 of 2 endpoints on, 2 ask first"
    );
  });

  it("moves with the policy rather than with the endpoint", () => {
    const tools = [tool(1, "POST"), tool(1, "DELETE")];
    // Same endpoints, different posture — nothing about the rows changed.
    expect(formatToolCountLabel(tools, DELETE_ONLY)).toBe("2 of 2 endpoints on, 1 asks first");
  });

  it("does not count a disabled endpoint as asking", () => {
    expect(formatToolCountLabel([tool(1, "GET"), tool(0, "DELETE")], ALL_ON)).toBe("1 of 2 endpoints on");
  });

  it("handles an empty collection", () => {
    expect(formatToolCountLabel([], ALL_ON)).toBe("no endpoints yet");
  });
});
