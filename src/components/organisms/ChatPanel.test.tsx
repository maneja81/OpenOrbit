import { describe, expect, it, afterEach, beforeAll, vi } from "vitest";
import { createRef } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import ChatPanel, { ChatMessage } from "./ChatPanel";

// jsdom implements neither of these: scrollIntoView is called by SlashCommandMenu (mounted
// via ChatInputBar) and scrollTo by useScrollToBottom.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});

// useTraceUsage reaches for window.agentsAPI, which doesn't exist here, so it returns an
// empty map — and MessageCost renders nothing without usage, which would make the cost
// anchor untestable. Stubbed with usage for both traces so the "first one only" rule is
// actually exercised rather than passing because neither rendered.
vi.mock("@/hooks/useTraceUsage", () => ({
  useTraceUsage: () => ({
    t1: { totalTokens: 1200, costUsd: 0.0012, calls: 1 },
    t2: { totalTokens: 900, costUsd: 0.0009, calls: 1 },
  }),
}));

function msg(i: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    text: `message ${i}`,
    avatarLabel: i % 2 === 0 ? "M" : "A",
    createdAt: new Date(2026, 7, 1, 9, 0, 0).getTime() + i * 1000,
    ...overrides,
  };
}

function renderPanel(messages: ChatMessage[], overrides = {}) {
  const onShowFullHistory = vi.fn();
  const view = render(
    <ChatPanel
      messages={messages}
      inputRef={createRef<HTMLTextAreaElement>()}
      agentName="Orbit"
      listening={false}
      transcribing={false}
      voiceEnabled={true}
      agents={[]}
      onShowFullHistory={onShowFullHistory}
      onSend={vi.fn()}
      onStartVoice={vi.fn()}
      onStopVoice={vi.fn()}
      {...overrides}
    />
  );
  return { ...view, onShowFullHistory };
}

describe("ChatPanel", () => {
  afterEach(cleanup);

  it("renders one turn per message, tagged by role", () => {
    const { container } = renderPanel([msg(0), msg(1)]);
    expect(container.querySelectorAll(".turn")).toHaveLength(2);
    expect(container.querySelectorAll(".turn.user")).toHaveLength(1);
    expect(container.querySelectorAll(".turn.assistant")).toHaveLength(1);
    // The dot is what carries the sender colour, one per turn.
    expect(container.querySelectorAll(".turn-row .dot")).toHaveLength(2);
  });

  it("caps the log at ten messages and keeps the newest", () => {
    const { container } = renderPanel(Array.from({ length: 12 }, (_, i) => msg(i)));
    expect(container.querySelectorAll(".turn")).toHaveLength(10);
    const text = container.querySelector("#chat-log")?.textContent ?? "";
    expect(text).toContain("message 11");
    expect(text).not.toContain("message 0");
  });

  it("offers full history only once there are older messages", () => {
    const { container: exactly } = renderPanel(Array.from({ length: 10 }, (_, i) => msg(i)));
    expect(exactly.querySelector("#chat-history-link")).toBeNull();
    cleanup();

    const { container, onShowFullHistory } = renderPanel(
      Array.from({ length: 11 }, (_, i) => msg(i))
    );
    const link = container.querySelector("#chat-history-link") as HTMLButtonElement;
    expect(link).not.toBeNull();
    fireEvent.click(link);
    expect(onShowFullHistory).toHaveBeenCalledTimes(1);
  });

  it("keeps the history link outside the faded scroller", () => {
    // #chat-log carries the top-fade mask; a link drawn inside it renders half-transparent.
    const { container } = renderPanel(Array.from({ length: 11 }, (_, i) => msg(i)));
    expect(container.querySelector("#chat-log #chat-history-link")).toBeNull();
    expect(container.querySelector("#chat #chat-history-link")).not.toBeNull();
  });

  it("names the sender and shows a time in the meta row", () => {
    const { container } = renderPanel([msg(0), msg(1)]);
    const names = [...container.querySelectorAll(".meta .agent-name")].map((e) => e.textContent);
    // The assistant row uses the agent's name, not the single-letter avatarLabel.
    expect(names).toEqual(["You", "Orbit"]);
    expect(container.querySelector(".meta .meta-time")?.textContent).toMatch(/\d/);
  });

  it("anchors the tour's cost target to the first costed reply only", () => {
    const { container } = renderPanel([
      msg(0),
      msg(1, { traceId: "t1" }),
      msg(2),
      msg(3, { traceId: "t2" }),
    ]);
    expect(container.querySelectorAll("#message-cost")).toHaveLength(1);
  });

  it("renders the approval card after the turns, inside the log", () => {
    // ToolApprovalCard blocks the run until answered, so the cap and the layout must never
    // push it out of the scroller.
    const { container } = renderPanel(Array.from({ length: 12 }, (_, i) => msg(i)), {
      approvalCard: <div data-testid="approval">approve me</div>,
    });
    const log = container.querySelector("#chat-log") as HTMLElement;
    const card = log.querySelector("[data-testid='approval']");
    expect(card).not.toBeNull();
    expect(log.lastElementChild).toBe(card);
  });

  it("credits the specialist a turn was delegated to", () => {
    const { container } = renderPanel([
      msg(1, {
        steps: [
          { type: "handoff_occurred", label: "Delegating to Atlas", handoffTo: "Atlas" },
          // A turn can bounce through more than one specialist; the reply belongs to the last.
          { type: "handoff_occurred", label: "Delegating to Explorer", handoffTo: "Explorer" },
        ],
      }),
    ]);
    expect(container.querySelector(".meta .handoff")?.textContent).toBe("via Explorer");
  });

  it("shows no handoff pill on a turn that stayed with the orchestrator", () => {
    const { container } = renderPanel([
      msg(1, { steps: [{ type: "tool_called", label: "Calling tool…", toolName: "get_settings" }] }),
    ]);
    expect(container.querySelector(".meta .handoff")).toBeNull();
  });

  it("anchors the copy button on the first reply that really has a fence", () => {
    const { container } = renderPanel([
      // Backticks that never become a block: inline, and blockquoted. Selecting on a bare
      // text.includes("```") burned the anchor here and it then vanished from the whole app.
      msg(1, { text: "run ``` to open a fence" }),
      msg(3, { text: "> ```ts\n> quoted\n> ```" }),
      msg(5, { text: "```ts\nconst a = 1;\n```" }),
    ]);
    expect(container.querySelectorAll("#code-block-copy")).toHaveLength(1);
    const blocks = [...container.querySelectorAll(".code-block")];
    const anchored = blocks.find((b) => b.querySelector("#code-block-copy"));
    expect(anchored?.querySelector("code")?.textContent).toBe("const a = 1;");
  });

  it("never anchors on a user message", () => {
    // Four leading spaces make a user's prose an indented code block, which would otherwise
    // claim the anchor — and the tour step describes code arriving in a reply.
    const { container } = renderPanel([
      msg(0, { role: "user", text: "    please look at this\n    thanks" }),
      msg(1, { role: "assistant", text: "```ts\nconst a = 1;\n```" }),
    ]);
    expect(container.querySelectorAll("#code-block-copy")).toHaveLength(1);
    const userTurn = container.querySelector(".turn.user");
    expect(userTurn?.querySelector("#code-block-copy")).toBeNull();
  });

  it("assigns no anchor when no reply has a fence", () => {
    const { container } = renderPanel([msg(1, { text: "no code here at all" })]);
    expect(container.querySelector("#code-block-copy")).toBeNull();
  });

  it("shows no steps disclosure for a message without steps", () => {
    const { container } = renderPanel([msg(1)]);
    expect(container.querySelector(".thinking-toggle")).toBeNull();
  });

  it("starts at the bottom, so no jump button is offered", () => {
    // jsdom reports every dimension as 0, which reads as "at the bottom" — the threshold
    // arithmetic itself is covered in useScrollToBottom.test.ts.
    const { container } = renderPanel([msg(0), msg(1)]);
    expect(container.querySelector("#chat-jump-bottom")).toBeNull();
  });
});
