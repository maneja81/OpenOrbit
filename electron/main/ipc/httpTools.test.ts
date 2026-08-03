import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

// The store reaches the real database and none of it is what these tests are about — only
// the handler's own argument validation is.
vi.mock("../db/httpToolsStore", () => ({
  createHttpTool: vi.fn(),
  createHttpToolCollection: vi.fn(),
  deleteHttpTool: vi.fn(),
  deleteHttpToolCollection: vi.fn(),
  getDecryptedCollectionHeaders: vi.fn(),
  getDecryptedToolHeaders: vi.fn(),
  listHttpToolCollections: vi.fn(),
  listHttpTools: vi.fn(),
  updateHttpTool: vi.fn(),
  updateHttpToolCollection: vi.fn(),
  HTTP_METHODS: ["GET", "POST", "PUT", "PATCH", "DELETE"],
}));

const buildHttpRequestMock = vi.hoisted(() => vi.fn());
vi.mock("../ai/httpToolRequest", () => ({ buildHttpRequest: buildHttpRequestMock }));
const assertHttpProtocolMock = vi.hoisted(() => vi.fn());
vi.mock("../net/urlSafety", () => ({
  assertPublicHttpUrl: vi.fn(),
  assertHttpProtocol: assertHttpProtocolMock,
  safeFetch: vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", text: async () => "{}" })),
}));

import { ipcMain } from "electron";
import { registerHttpToolHandlers } from "./httpTools";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function handlerFor(channel: string): Handler {
  registerHttpToolHandlers();
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`${channel} was never registered`);
  return call[1] as Handler;
}

function testTool(input: unknown): Promise<unknown> {
  return handlerFor("httpTools:testTool")(null, input) as Promise<unknown>;
}

const VALID = {
  baseUrl: "https://api.example.com",
  path: "/things/{id}",
  method: "GET",
  params: [{ name: "id", description: "the id", type: "string", location: "path", required: true }],
  args: { id: "1" },
};

describe("httpTools:testTool argument names", () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    buildHttpRequestMock.mockReset();
    assertHttpProtocolMock.mockReset();
    buildHttpRequestMock.mockReturnValue({
      url: "https://api.example.com/things/1",
      method: "GET",
      headers: {},
      body: undefined,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", text: async () => "{}" }))
    );
  });

  it("names args when the sample values arrive under the wrong key", async () => {
    // The whole finding: this used to reach buildHttpRequest with no args at all and fail
    // with `Missing required parameter "id"`, blaming the param definition.
    const { args, ...rest } = VALID;
    void args;
    await expect(testTool({ ...rest, values: { id: "1" } })).rejects.toThrow(
      /does not accept "values".*accepted keys are .*\bargs\b/s
    );
    expect(buildHttpRequestMock).not.toHaveBeenCalled();
  });

  it("names every unrecognised key, not just the first", async () => {
    await expect(testTool({ ...VALID, values: {}, timeout: 5 })).rejects.toThrow(
      /does not accept "values", "timeout"/
    );
  });

  it("accepts every documented key", async () => {
    await testTool({
      ...VALID,
      headers: { authorization: "Bearer x" },
      bodyTemplate: "",
      allowPrivateHosts: false,
    });
    expect(buildHttpRequestMock).toHaveBeenCalledTimes(1);
  });

  // KI-12: allowPrivateHosts widens which *hosts* are reachable, never which protocols —
  // this branch previously skipped assertPublicHttpUrl (correctly, since private hosts are
  // allowed) but also assertHttpProtocol, unlike ai/httpTools.ts's equivalent branch.
  it("still runs the protocol check when private hosts are allowed", async () => {
    await testTool({ ...VALID, allowPrivateHosts: true });
    expect(assertHttpProtocolMock).toHaveBeenCalledWith("https://api.example.com/things/1");
  });

  it("does not run the protocol check when private hosts are not allowed (safeFetch covers it)", async () => {
    await testTool({ ...VALID, allowPrivateHosts: false });
    expect(assertHttpProtocolMock).not.toHaveBeenCalled();
  });

  it("surfaces a rejected protocol as a returned error rather than a thrown one", async () => {
    assertHttpProtocolMock.mockImplementation(() => {
      throw new Error('Refusing to call a non-http(s) URL: "file:///etc/passwd"');
    });
    const result = await testTool({ ...VALID, allowPrivateHosts: true });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Refusing to call a non-http(s) URL") });
  });

  it("still accepts an input carrying only the required key", async () => {
    await testTool({ baseUrl: "https://api.example.com" });
    expect(buildHttpRequestMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-object input before looking at its keys", async () => {
    await expect(testTool("https://api.example.com")).rejects.toThrow(
      "httpTools:testTool requires a plain object input"
    );
  });

  it("still reports a missing baseUrl as a missing baseUrl", async () => {
    await expect(testTool({ path: "/things" })).rejects.toThrow(
      "httpTools:testTool requires a non-empty baseUrl"
    );
  });
});

describe("httpTools:createTool param name validation", () => {
  function createTool(input: unknown): unknown {
    return handlerFor("httpTools:createTool")(null, input);
  }

  const BASE_INPUT = { collectionId: "col-1", name: "Get Thing" };

  // KI-11: param.name is later interpolated unescaped into a per-param RegExp
  // (httpToolRequest.ts's path substitution). A name like ".*" builds a pattern that
  // swallows every "{{...}}" placeholder in the path; an unbalanced "(" throws a
  // SyntaxError building the regex. Restricting the name to the same class the {{name}}
  // placeholder syntax already implies closes both off at creation time.
  it.each([".*", "id)", "a b", "1id"])("rejects a param name that isn't a valid identifier: %s", (name) => {
    expect(() =>
      createTool({
        ...BASE_INPUT,
        params: [{ name, description: "", type: "string", location: "path", required: false }],
      })
    ).toThrow(/must match/);
  });

  it.each(["id", "user_id", "_private", "id2"])("accepts a valid identifier param name: %s", (name) => {
    expect(() =>
      createTool({
        ...BASE_INPUT,
        params: [{ name, description: "", type: "string", location: "path", required: false }],
      })
    ).not.toThrow();
  });
});
