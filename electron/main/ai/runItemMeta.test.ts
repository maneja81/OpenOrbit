import { describe, expect, it } from "vitest";
import { extractApprovalMeta, extractRunItemMeta } from "./runItemMeta";

describe("extractRunItemMeta", () => {
  it("reads tool name, agent name, and call id off a function-call item", () => {
    expect(
      extractRunItemMeta({
        type: "tool_call_item",
        rawItem: { type: "function_call", name: "web_search", callId: "call_1", arguments: "{}" },
        agent: { name: "Explorer" },
      })
    ).toEqual({ toolName: "web_search", agentName: "Explorer", callId: "call_1" });
  });

  it("reads the same fields off a function-call-result item", () => {
    // The call and its output carry the same callId — that pairing is what gives the
    // activity feed a duration.
    expect(
      extractRunItemMeta({
        type: "tool_call_output_item",
        rawItem: { type: "function_call_result", name: "web_search", callId: "call_1", status: "completed" },
        agent: { name: "Explorer" },
        output: "results",
      })
    ).toEqual({ toolName: "web_search", agentName: "Explorer", callId: "call_1" });
  });

  it("drops empty-string fields instead of returning blanks", () => {
    expect(extractRunItemMeta({ rawItem: { name: "", callId: "" }, agent: { name: "" } })).toEqual({});
  });

  it("omits what is missing rather than failing", () => {
    expect(extractRunItemMeta({ rawItem: { name: "save_user_info" } })).toEqual({ toolName: "save_user_info" });
    expect(extractRunItemMeta({ agent: { name: "Orbit" } })).toEqual({ agentName: "Orbit" });
    expect(extractRunItemMeta({})).toEqual({});
  });

  it("ignores non-string values", () => {
    expect(extractRunItemMeta({ rawItem: { name: 42, callId: null }, agent: { name: { nested: true } } })).toEqual({});
  });

  it("returns an empty meta for items that are not objects", () => {
    expect(extractRunItemMeta(null)).toEqual({});
    expect(extractRunItemMeta(undefined)).toEqual({});
    expect(extractRunItemMeta("tool_called")).toEqual({});
  });

  it("swallows a throwing getter so a malformed item can never break the run", () => {
    const hostile = {
      get rawItem(): { name?: unknown } {
        throw new Error("boom");
      },
    };
    expect(extractRunItemMeta(hostile)).toEqual({});
  });
});

describe("extractApprovalMeta", () => {
  it("carries the call arguments alongside the usual meta", () => {
    expect(
      extractApprovalMeta({
        rawItem: { name: "create_post", callId: "call-1", arguments: '{"title":"hi"}' },
        agent: { name: "Orbit" },
      })
    ).toEqual({
      toolName: "create_post",
      callId: "call-1",
      agentName: "Orbit",
      args: '{"title":"hi"}',
    });
  });

  it("omits arguments that are absent, blank, or not a string", () => {
    expect(extractApprovalMeta({ rawItem: { name: "list_posts" } })).toEqual({ toolName: "list_posts" });
    expect(extractApprovalMeta({ rawItem: { name: "list_posts", arguments: "" } })).toEqual({ toolName: "list_posts" });
    expect(extractApprovalMeta({ rawItem: { name: "list_posts", arguments: { title: "hi" } } })).toEqual({
      toolName: "list_posts",
    });
  });

  it("never throws on a malformed item — the run is already paused on a human", () => {
    expect(extractApprovalMeta(null)).toEqual({});
    expect(extractApprovalMeta(undefined)).toEqual({});
    expect(
      extractApprovalMeta({
        get rawItem(): { name?: unknown } {
          throw new Error("boom");
        },
      })
    ).toEqual({});
  });
});
