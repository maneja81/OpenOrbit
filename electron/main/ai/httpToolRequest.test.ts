import { describe, expect, it } from "vitest";
import { buildHttpRequest, joinUrl, toolParamsSchema } from "./httpToolRequest";
import type { HttpToolParam } from "../db/httpToolsStore";

const param = (over: Partial<HttpToolParam> & Pick<HttpToolParam, "name" | "location">): HttpToolParam => ({
  description: "",
  type: "string",
  required: true,
  ...over,
});

const BASE = "https://jsonplaceholder.typicode.com";

describe("joinUrl", () => {
  it("normalises the separator in both directions", () => {
    expect(joinUrl(BASE, "posts")).toBe(`${BASE}/posts`);
    expect(joinUrl(`${BASE}/`, "/posts")).toBe(`${BASE}/posts`);
    expect(joinUrl(`${BASE}//`, "posts")).toBe(`${BASE}/posts`);
  });

  it("leaves the base URL alone when there is no path", () => {
    expect(joinUrl(BASE, "")).toBe(BASE);
    expect(joinUrl(`${BASE}/`, "   ")).toBe(BASE);
  });
});

describe("toolParamsSchema", () => {
  it("types each parameter and makes optional ones nullable", () => {
    const schema = toolParamsSchema([
      param({ name: "id", location: "path", type: "number" }),
      param({ name: "draft", location: "query", type: "boolean", required: false }),
    ]);

    expect(schema.safeParse({ id: 1, draft: true }).success).toBe(true);
    // null is how the model says "not provided" — the SDK's schema conversion needs every
    // top-level key present, so optional is modelled as nullable.
    expect(schema.safeParse({ id: 1, draft: null }).success).toBe(true);
    expect(schema.safeParse({ id: "one", draft: null }).success).toBe(false);
    expect(schema.safeParse({ draft: null }).success).toBe(false);
  });
});

describe("buildHttpRequest", () => {
  it("builds a plain GET with no parameters", () => {
    const request = buildHttpRequest({
      baseUrl: BASE,
      path: "/posts",
      method: "get",
      params: [],
      args: {},
    });

    expect(request).toEqual({
      url: `${BASE}/posts`,
      method: "GET",
      headers: {},
      body: undefined,
    });
  });

  it("substitutes a path placeholder", () => {
    const request = buildHttpRequest({
      baseUrl: BASE,
      path: "/posts/{{id}}",
      method: "GET",
      params: [param({ name: "id", location: "path", type: "number" })],
      args: { id: 7 },
    });

    expect(request.url).toBe(`${BASE}/posts/7`);
  });

  it("URL-encodes a path value so it cannot escape its segment", () => {
    const request = buildHttpRequest({
      baseUrl: BASE,
      path: "/posts/{{id}}",
      method: "GET",
      params: [param({ name: "id", location: "path" })],
      args: { id: "../../admin?x=1" },
    });

    // Without encoding this would reshape the URL into a different endpoint entirely.
    expect(request.url).toBe(`${BASE}/posts/..%2F..%2Fadmin%3Fx%3D1`);
  });

  it("throws when a path placeholder is never filled in", () => {
    expect(() =>
      buildHttpRequest({
        baseUrl: BASE,
        path: "/posts/{{id}}",
        method: "GET",
        params: [param({ name: "other", location: "query", required: false })],
        args: {},
      })
    ).toThrow(/Unresolved placeholder/);
  });

  it("appends query parameters and skips omitted optional ones", () => {
    const request = buildHttpRequest({
      baseUrl: BASE,
      path: "/posts",
      method: "GET",
      params: [
        param({ name: "userId", location: "query", type: "number" }),
        param({ name: "_limit", location: "query", type: "number", required: false }),
      ],
      args: { userId: 3, _limit: null },
    });

    expect(request.url).toBe(`${BASE}/posts?userId=3`);
  });

  it("throws when a required parameter is missing or null", () => {
    const params = [param({ name: "id", location: "path", type: "number" })];
    expect(() => buildHttpRequest({ baseUrl: BASE, path: "/posts/{{id}}", method: "GET", params, args: {} })).toThrow(
      /Missing required parameter "id"/
    );
    expect(() =>
      buildHttpRequest({ baseUrl: BASE, path: "/posts/{{id}}", method: "GET", params, args: { id: null } })
    ).toThrow(/Missing required parameter "id"/);
  });

  it("layers headers: collection, then tool, then parameter", () => {
    const request = buildHttpRequest({
      baseUrl: BASE,
      path: "/posts",
      method: "GET",
      params: [param({ name: "X-Trace", location: "header" })],
      args: { "X-Trace": "abc" },
      collectionHeaders: { Authorization: "Bearer token", Accept: "application/xml" },
      toolHeaders: { Accept: "application/json" },
    });

    expect(request.headers).toEqual({
      Authorization: "Bearer token",
      Accept: "application/json",
      "X-Trace": "abc",
    });
  });

  it("rejects a header value containing line breaks", () => {
    expect(() =>
      buildHttpRequest({
        baseUrl: BASE,
        path: "/posts",
        method: "GET",
        params: [param({ name: "X-Trace", location: "header" })],
        args: { "X-Trace": "ok\r\nX-Admin: true" },
      })
    ).toThrow(/cannot contain line breaks/);
  });

  it("builds a JSON body object from body parameters", () => {
    const request = buildHttpRequest({
      baseUrl: BASE,
      path: "/posts",
      method: "POST",
      params: [
        param({ name: "title", location: "body" }),
        param({ name: "userId", location: "body", type: "number" }),
        param({ name: "draft", location: "body", type: "boolean", required: false }),
      ],
      args: { title: "hello", userId: 1, draft: null },
    });

    expect(request.method).toBe("POST");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(request.body!)).toEqual({ title: "hello", userId: 1 });
  });

  it("fills a body template with correctly typed, escaped values", () => {
    const request = buildHttpRequest({
      baseUrl: BASE,
      path: "/posts",
      method: "POST",
      params: [
        param({ name: "title", location: "body" }),
        param({ name: "userId", location: "body", type: "number" }),
      ],
      args: { title: 'a "quoted" title', userId: 1 },
      bodyTemplate: '{"title": {{title}}, "userId": {{userId}}, "source": "orbit"}',
    });

    // Placeholders are unquoted in the template and JSON.stringify'd on substitution, so a
    // value containing a quote cannot break out of its string.
    expect(JSON.parse(request.body!)).toEqual({ title: 'a "quoted" title', userId: 1, source: "orbit" });
  });

  it("rejects a body template that is not valid JSON once filled in", () => {
    expect(() =>
      buildHttpRequest({
        baseUrl: BASE,
        path: "/posts",
        method: "POST",
        params: [param({ name: "title", location: "body" })],
        args: { title: "hi" },
        bodyTemplate: '{"title": {{title}},}',
      })
    ).toThrow(/not valid JSON/);
  });

  it("throws on an unresolved body placeholder", () => {
    expect(() =>
      buildHttpRequest({
        baseUrl: BASE,
        path: "/posts",
        method: "POST",
        params: [],
        args: {},
        bodyTemplate: '{"title": {{title}}}',
      })
    ).toThrow(/Unresolved placeholder/);
  });

  it("refuses to put a body on a GET or HEAD request", () => {
    expect(() =>
      buildHttpRequest({
        baseUrl: BASE,
        path: "/posts",
        method: "GET",
        params: [param({ name: "title", location: "body" })],
        args: { title: "hi" },
      })
    ).toThrow(/cannot send a body/);
  });

  it("does not override a Content-Type the user set explicitly", () => {
    const request = buildHttpRequest({
      baseUrl: BASE,
      path: "/posts",
      method: "POST",
      params: [param({ name: "title", location: "body" })],
      args: { title: "hi" },
      collectionHeaders: { "Content-Type": "application/vnd.api+json" },
    });

    expect(request.headers["Content-Type"]).toBe("application/vnd.api+json");
  });
});
