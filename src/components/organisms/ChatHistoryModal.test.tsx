import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

const useChatHistoryPage = vi.fn();
// Signature declared rather than implemented: the factory below forwards the trace-id list
// (which one test asserts on), and every test sets the return value in beforeEach.
const useTraceUsage = vi.fn<(ids: (string | undefined)[]) => Record<string, TraceUsage>>();

vi.mock("@/hooks/useChatHistoryPage", () => ({
  useChatHistoryPage: (open: boolean, page: number) => useChatHistoryPage(open, page),
}));
vi.mock("@/hooks/useTraceUsage", () => ({
  useTraceUsage: (ids: (string | undefined)[]) => useTraceUsage(ids),
}));

import ChatHistoryModal from "./ChatHistoryModal";

function message(id: number, overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id,
    conversationId: 1,
    role: "assistant",
    text: `msg-${id}`,
    agentId: "Orbit",
    traceId: `trace-${id}`,
    createdAt: "2026-07-31 12:41:34",
    ...overrides,
  };
}

function setPage(state: Partial<{ messages: ChatMessageRecord[]; total: number; loading: boolean; error: string | null }>) {
  useChatHistoryPage.mockReturnValue({ messages: [], total: 0, loading: false, error: null, ...state });
}

describe("ChatHistoryModal", () => {
  beforeEach(() => {
    useChatHistoryPage.mockReset();
    useTraceUsage.mockReset();
    useTraceUsage.mockReturnValue({});
    setPage({});
  });
  afterEach(cleanup);

  it("says so when there is nothing to show, and hides the pager", () => {
    setPage({ total: 0 });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(screen.getByText("No messages yet.")).toBeTruthy();
    expect(screen.queryByLabelText("Older messages")).toBeNull();
  });

  it("renders a row per message with who said it", () => {
    setPage({
      messages: [message(1, { role: "user", agentId: null, traceId: null }), message(2)],
      total: 2,
    });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(document.querySelectorAll(".ch-row")).toHaveLength(2);
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Orbit")).toBeTruthy();
  });

  it("renders each turn as a chat bubble on its speaker's side", () => {
    setPage({
      messages: [message(1, { role: "user", agentId: null, traceId: null }), message(2)],
      total: 2,
    });
    render(<ChatHistoryModal open onClose={() => {}} />);
    // .m.u is what flips the row to row-reverse in globals.css — the left/right split is
    // the whole point of this view, and a plain .m would render both turns left-aligned.
    expect(document.querySelectorAll(".ch-row--user .m.u")).toHaveLength(1);
    expect(document.querySelectorAll(".ch-row--assistant .m.a")).toHaveLength(1);
  });

  // jsdom does no layout, so the collapse this guards against can't be caught by measuring a
  // rendered bubble — the rule itself is the contract. `.ch-row .mb` caps the bubble at 86%,
  // a percentage that needs a definite reference: `.m` is shrink-to-fit in the live log (it
  // sits beside the sender dot), and without this override 86% resolves against fit-content
  // and collapses every history bubble to min-content, wrapping "Ok." to "O / k.".
  it("gives history bubbles a definite width to size their 86% cap against", () => {
    // process.cwd(), not import.meta.url: under jsdom that resolves to an http:// URL.
    const css = readFileSync(path.join(process.cwd(), "src/globals.css"), "utf8");
    const rule = css.match(/\.ch-row \.m\s*\{([^}]*)\}/)?.[1];
    expect(rule, ".ch-row .m rule is missing from globals.css").toBeTruthy();
    expect(rule).toMatch(/width:\s*100%/);
  });

  it("shows the cost of a reply next to it", () => {
    setPage({ messages: [message(2)], total: 1 });
    useTraceUsage.mockReturnValue({ "trace-2": { totalTokens: 11_461, costUsd: 0.0046, calls: 3 } });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(document.querySelector(".message-cost-price")?.textContent).toBe("$0.0046");
    expect(document.querySelector(".message-cost-tokens")?.textContent).toBe("11.5K tok");
  });

  it("asks for usage only for the traces on this page", () => {
    setPage({ messages: [message(1, { role: "user", traceId: null }), message(2)], total: 2 });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(useTraceUsage).toHaveBeenCalledWith([undefined, "trace-2"]);
  });

  it("numbers the visible range from the oldest message", () => {
    setPage({ messages: [message(1)], total: 118 });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(screen.getByText("99–118 of 118")).toBeTruthy();
  });

  it("starts on the newest page, so Newer is disabled and Older is not", () => {
    setPage({ messages: [message(1)], total: 118 });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(screen.getByLabelText("Newer messages").hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Older messages").hasAttribute("disabled")).toBe(false);
  });

  it("walks the page number up when going older", () => {
    setPage({ messages: [message(1)], total: 118 });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(useChatHistoryPage).toHaveBeenLastCalledWith(true, 0);

    fireEvent.click(screen.getByLabelText("Older messages"));
    expect(useChatHistoryPage).toHaveBeenLastCalledWith(true, 1);
  });

  it("disables both directions when everything fits on one page", () => {
    setPage({ messages: [message(1)], total: 5 });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(screen.getByLabelText("Older messages").hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Newer messages").hasAttribute("disabled")).toBe(true);
  });

  it("blocks paging while a fetch is in flight", () => {
    setPage({ messages: [message(1)], total: 118, loading: true });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(screen.getByLabelText("Older messages").hasAttribute("disabled")).toBe(true);
  });

  it("routes a failure through humanizeError rather than printing it bare", () => {
    setPage({ error: "Error: ECONNREFUSED", total: 0 });
    render(<ChatHistoryModal open onClose={() => {}} />);
    const shown = document.querySelector(".widget-empty")?.textContent ?? "";
    // The humanizer's fallback keeps the underlying message but wraps it in a title and a
    // next step (CLAUDE.md requires the wrapping, not that the detail be hidden).
    expect(shown).not.toBe("Error: ECONNREFUSED");
    expect(shown).toContain("Something went wrong");
    expect(shown).toMatch(/Try again/);
  });

  it("shows the error instead of the empty state, not both", () => {
    setPage({ error: "boom", total: 0 });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(screen.queryByText("No messages yet.")).toBeNull();
  });

  it("carries the id the tour targets", () => {
    setPage({ messages: [message(1)], total: 1 });
    render(<ChatHistoryModal open onClose={() => {}} />);
    expect(document.querySelector("#chat-history-list")).toBeTruthy();
  });
});
