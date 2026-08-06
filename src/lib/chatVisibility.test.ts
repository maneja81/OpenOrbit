import { describe, expect, it } from "vitest";
import { sliceRecentConversations } from "./chatVisibility";

function msgs(roles: ("user" | "assistant")[]) {
  return roles.map((role, i) => ({ role, id: `m${i}` }));
}

describe("sliceRecentConversations", () => {
  it("keeps only the last conversation by default (count=1)", () => {
    const all = msgs(["user", "assistant", "user", "assistant", "assistant"]);
    const visible = sliceRecentConversations(all, 1);
    expect(visible).toEqual(all.slice(2));
  });

  it("keeps a whole conversation together even when it has multiple trailing messages", () => {
    // A turn that produced a streamed reply plus a config-ack notice — both belong to the same
    // conversation and must not be split by a flat message-count cap.
    const all = msgs(["user", "assistant", "user", "assistant", "assistant", "assistant"]);
    const visible = sliceRecentConversations(all, 1);
    expect(visible).toEqual(all.slice(2));
  });

  it("keeps the last N conversations for N>1", () => {
    const all = msgs(["user", "assistant", "user", "assistant", "user", "assistant"]);
    const visible = sliceRecentConversations(all, 2);
    expect(visible).toEqual(all.slice(2));
  });

  it("returns everything when fewer conversations exist than requested", () => {
    const all = msgs(["assistant", "user", "assistant"]);
    const visible = sliceRecentConversations(all, 5);
    expect(visible).toEqual(all);
  });

  it("includes a leading assistant-only greeting when it's part of the only conversation kept", () => {
    const all = msgs(["assistant"]);
    expect(sliceRecentConversations(all, 1)).toEqual(all);
  });

  it("returns everything for a non-positive count rather than hiding the whole log", () => {
    const all = msgs(["user", "assistant"]);
    expect(sliceRecentConversations(all, 0)).toEqual(all);
    expect(sliceRecentConversations(all, -1)).toEqual(all);
  });

  it("returns an empty array unchanged", () => {
    expect(sliceRecentConversations([], 1)).toEqual([]);
  });
});
