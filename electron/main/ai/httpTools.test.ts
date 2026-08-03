import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { FunctionTool, RunContext } from "@openai/agents";
import { runMigrations } from "../db/migrations";

vi.mock("../security/secretStorage", () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => v.replace(/^enc:/, ""),
}));

vi.mock("../devLog", () => ({ devLog: () => {} }));

let db: Database.Database;
vi.mock("../db", () => ({ getDb: () => db }));
vi.mock("../db/index", () => ({ getDb: () => db }));

import { createHttpTool, createHttpToolCollection, updateHttpTool, updateHttpToolCollection } from "../db/httpToolsStore";
import { setSetting } from "../db/settingsStore";
import {
  buildHttpToolsForCollectionIds,
  buildHttpToolsPromptBlock,
  formatHttpToolsForPrompt,
  readApprovalPolicy,
} from "./httpTools";

/** Calls a built tool the way the SDK does — through invoke() with a JSON argument string,
 * so zod parsing runs too. */
function callTool(builtTool: unknown, args: Record<string, unknown>): Promise<unknown> {
  const fn = builtTool as FunctionTool;
  return fn.invoke({} as RunContext, JSON.stringify(args));
}

const PUBLIC_BASE = "https://93.184.216.34";

describe("formatHttpToolsForPrompt", () => {
  it("returns an empty string when nothing is attached", () => {
    expect(formatHttpToolsForPrompt([])).toBe("");
    // A collection with no endpoints must not produce a dangling header either.
    expect(formatHttpToolsForPrompt([{ name: "Empty", description: "", baseUrl: "https://x.dev", tools: [] }])).toBe("");
  });

  it("lists each endpoint with its parameters and confirmation requirement", () => {
    const block = formatHttpToolsForPrompt([
      {
        name: "JSONPlaceholder",
        description: "Fake REST API",
        baseUrl: "https://jsonplaceholder.typicode.com",
        tools: [
          { toolName: "list_posts", method: "GET", path: "/posts", description: "List all posts.", params: [], willAskApproval: false },
          {
            toolName: "create_post",
            method: "POST",
            path: "/posts",
            description: "Create a post.",
            params: [
              { name: "title", description: "", type: "string", required: true, location: "body" },
              { name: "draft", description: "", type: "boolean", required: false, location: "body" },
            ],
            willAskApproval: true,
          },
        ],
      },
    ]);

    expect(block).toContain("You have HTTP tools attached from 1 API collection:");
    expect(block).toContain("JSONPlaceholder (https://jsonplaceholder.typicode.com) — Fake REST API");
    expect(block).toContain("- list_posts (GET /posts): List all posts.");
    expect(block).toContain("Parameters: title (string, required), draft (boolean, optional).");
    // Must read as "the app handles approval", never as "ask the user first" — the latter
    // made the model reply with a question and never call the tool, so the SDK's approval
    // interruption never fired and the turn stalled.
    expect(block).toContain("call it directly, don't ask first");
    expect(block).toContain("never ask the user for permission in chat");
    expect(block).toContain("never invent a response");
    // Appended to an existing prompt, so it must open with its own separation.
    expect(block.startsWith("\n\n")).toBe(true);
  });

  it("pluralises the collection count", () => {
    const collection = (name: string) => ({
      name,
      description: "",
      baseUrl: "https://x.dev",
      tools: [{ toolName: "t", method: "GET", path: "/", description: "", params: [], willAskApproval: false }],
    });
    expect(formatHttpToolsForPrompt([collection("A"), collection("B")])).toContain("from 2 API collections:");
  });
});

describe("http tool building and execution", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const seed = (options?: { baseUrl?: string; allowPrivateHosts?: boolean }) => {
    const collection = createHttpToolCollection({
      name: "JSONPlaceholder",
      description: "Fake REST API",
      baseUrl: options?.baseUrl ?? PUBLIC_BASE,
      headers: { Authorization: "Bearer secret-token" },
      allowPrivateHosts: options?.allowPrivateHosts,
    });
    const getPost = createHttpTool({
      collectionId: collection.id,
      name: "Get Post",
      description: "Fetch one post.",
      method: "GET",
      path: "/posts/{{id}}",
      params: [{ name: "id", description: "The post id", type: "number", required: true, location: "path" }],
    });
    return { collection, getPost };
  };

  const mockFetch = (body: string, init?: { status?: number; contentType?: string }) => {
    const fetchMock = vi.fn(async () =>
      new Response(body, {
        status: init?.status ?? 200,
        headers: { "content-type": init?.contentType ?? "application/json" },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it("builds one tool per enabled endpoint of an enabled collection", () => {
    const { collection } = seed();
    createHttpTool({ collectionId: collection.id, name: "List Posts", method: "GET", path: "/posts" });

    const tools = buildHttpToolsForCollectionIds([collection.id]) as FunctionTool[];
    expect(tools.map((t) => t.name)).toEqual(["get_post", "list_posts"]);
  });

  it("skips disabled endpoints, disabled collections, and unknown ids", () => {
    const { collection, getPost } = seed();
    const listPosts = createHttpTool({ collectionId: collection.id, name: "List Posts", method: "GET", path: "/posts" });

    updateHttpTool(listPosts.id, { enabled: false });
    expect((buildHttpToolsForCollectionIds([collection.id]) as FunctionTool[]).map((t) => t.name)).toEqual(["get_post"]);

    // An unknown id must not throw — one bad attachment can't take down the agent build.
    expect(buildHttpToolsForCollectionIds(["does-not-exist"])).toEqual([]);

    updateHttpToolCollection(collection.id, { enabled: false });
    expect(buildHttpToolsForCollectionIds([collection.id])).toEqual([]);
    expect(getPost.enabled).toBe(1);
  });

  it("decides approval from the global policy, not from the endpoint", async () => {
    const { collection } = seed();
    createHttpTool({ collectionId: collection.id, name: "Create Post", method: "POST", path: "/posts" });
    createHttpTool({ collectionId: collection.id, name: "Delete Post", method: "DELETE", path: "/posts/1" });

    const approvalFor = (name: string) => {
      const tools = buildHttpToolsForCollectionIds([collection.id]) as FunctionTool[];
      // The SDK normalises the option into a function; `input` is the raw argument JSON
      // string, not a parsed object.
      return tools.find((t) => t.name === name)!.needsApproval({} as RunContext, "{}", "call-1");
    };

    // Defaults: every write asks, reads never do.
    await expect(approvalFor("create_post")).resolves.toBe(true);
    await expect(approvalFor("delete_post")).resolves.toBe(true);
    await expect(approvalFor("get_post")).resolves.toBe(false);

    // The "only DELETE needs approval" posture, set globally — the endpoint rows are
    // untouched, which is the whole point of moving this off the endpoint.
    setSetting("appSettings.httpToolApprovalPost", false);
    setSetting("appSettings.httpToolApprovalPutPatch", false);
    await expect(approvalFor("create_post")).resolves.toBe(false);
    await expect(approvalFor("delete_post")).resolves.toBe(true);

    setSetting("appSettings.httpToolApprovalDelete", false);
    await expect(approvalFor("delete_post")).resolves.toBe(false);
  });

  it("never mentions approval in a tool description", () => {
    const { collection } = seed();
    createHttpTool({ collectionId: collection.id, name: "Create Post", method: "POST", path: "/posts" });

    // Saying so made the model ask the user in prose and skip the call entirely, so the
    // gate never fired (observed live).
    const tools = buildHttpToolsForCollectionIds([collection.id]) as FunctionTool[];
    const description = tools.find((t) => t.name === "create_post")!.description;
    expect(description).toContain("This changes data on the remote service.");
    expect(description).not.toMatch(/approve|confirmation/i);
  });

  it("sends the resolved URL with decrypted headers and returns the parsed response", async () => {
    const { collection } = seed();
    const fetchMock = mockFetch('{"id":7,"title":"hello"}');

    const tools = buildHttpToolsForCollectionIds([collection.id]);
    const result = (await callTool(tools[0], { id: 7 })) as { status: number; ok: boolean; body: string };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${PUBLIC_BASE}/posts/7`);
    expect(init.method).toBe("GET");
    // Headers are stored encrypted and decrypted only here, right before the call.
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.body)).toEqual({ id: 7, title: "hello" });
  });

  it("returns a non-2xx response instead of throwing", async () => {
    const { collection } = seed();
    mockFetch("Not Found", { status: 404, contentType: "text/plain" });

    const tools = buildHttpToolsForCollectionIds([collection.id]);
    const result = (await callTool(tools[0], { id: 999 })) as { status: number; ok: boolean; body: string };

    // Throwing would collapse "404" and "the network is down" into one opaque tool failure.
    expect(result.status).toBe(404);
    expect(result.ok).toBe(false);
    expect(result.body).toBe("Not Found");
  });

  it("truncates an oversized response body and says so", async () => {
    const { collection } = seed();
    mockFetch("x".repeat(25_000));

    const tools = buildHttpToolsForCollectionIds([collection.id]);
    const result = (await callTool(tools[0], { id: 1 })) as { body: string; truncated: boolean };

    expect(result.truncated).toBe(true);
    expect(result.body.endsWith("…[truncated]")).toBe(true);
    expect(result.body.length).toBeLessThan(21_000);
  });

  it("refuses a private address unless the collection opts in", async () => {
    const { collection } = seed({ baseUrl: "http://localhost:3000" });
    const fetchMock = mockFetch("{}");

    const tools = buildHttpToolsForCollectionIds([collection.id]);
    // A tool failure reaches the model as text, not a rejection — errorFunction makes that
    // text name the real cause instead of the SDK's generic "please try again".
    expect(await callTool(tools[0], { id: 1 })).toMatch(/get_post failed: .*local\/private address/i);
    expect(fetchMock).not.toHaveBeenCalled();

    updateHttpToolCollection(collection.id, { allowPrivateHosts: true });
    const optedIn = buildHttpToolsForCollectionIds([collection.id]);
    await callTool(optedIn[0], { id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-http(s) URL even when private hosts are allowed", async () => {
    const { collection } = seed({ baseUrl: "file:///etc", allowPrivateHosts: true });
    const fetchMock = mockFetch("{}");

    const tools = buildHttpToolsForCollectionIds([collection.id]);
    // Opting into private hosts widens which hosts are reachable, never which protocols.
    expect(await callTool(tools[0], { id: 1 })).toMatch(/get_post failed: .*non-http\(s\)/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the prompt block from live rows, skipping disabled ones", () => {
    const { collection } = seed();
    const draft = createHttpTool({ collectionId: collection.id, name: "Delete Post", method: "DELETE", path: "/posts/1" });

    expect(buildHttpToolsPromptBlock([collection.id])).toContain("- get_post (GET /posts/{{id}})");
    expect(buildHttpToolsPromptBlock([collection.id])).toContain("delete_post");

    updateHttpTool(draft.id, { enabled: false });
    expect(buildHttpToolsPromptBlock([collection.id])).not.toContain("delete_post");
    expect(buildHttpToolsPromptBlock([])).toBe("");
  });

  it("only advertises the approval prompt when the policy actually enables it", () => {
    const { collection } = seed();
    createHttpTool({ collectionId: collection.id, name: "Delete Post", method: "DELETE", path: "/posts/1" });

    // Default policy asks for DELETE, so the agent is told the app will handle it.
    expect(buildHttpToolsPromptBlock([collection.id])).toContain("call it directly, don't ask first");

    // With the gate off, claiming the app will ask would be a lie the agent acts on.
    setSetting("appSettings.httpToolApprovalDelete", false);
    expect(buildHttpToolsPromptBlock([collection.id])).not.toContain("call it directly, don't ask first");
  });
});

describe("readApprovalPolicy", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  it("asks before every write when nothing has been stored", () => {
    // A fresh install must ask. The defaults come from settingsSchema now rather than three
    // inline `true`s here.
    expect(readApprovalPolicy()).toEqual({ post: true, putPatch: true, delete: true });
  });

  it("honours a real stored choice", () => {
    setSetting("appSettings.httpToolApprovalDelete", false);
    expect(readApprovalPolicy().delete).toBe(false);
    expect(readApprovalPolicy().post).toBe(true);
  });

  it("falls back to asking when a stored value isn't a boolean", () => {
    // This is the one that matters. The policy feeds needsApproval directly, and a null row —
    // writable by any build from before the settings schema — is falsy, so the gate would have
    // stopped asking silently, in the unsafe direction.
    for (const bad of [null, "false", "true", 0, 1]) {
      setSetting("appSettings.httpToolApprovalDelete", bad);
      expect(readApprovalPolicy().delete).toBe(true);
    }
  });

  it("does not let one unusable value change the others", () => {
    setSetting("appSettings.httpToolApprovalPost", false);
    setSetting("appSettings.httpToolApprovalDelete", null);
    expect(readApprovalPolicy()).toEqual({ post: false, putPatch: true, delete: true });
  });
});
