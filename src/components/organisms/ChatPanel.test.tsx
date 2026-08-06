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
      // msg() alternates user/assistant, so 5 conversations = 10 messages — same visible
      // count the old flat MAX_VISIBLE_MESSAGES=10 cap produced, which is what the tests
      // below (written for that flat cap) still assert against.
      visibleConversationCount={5}
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

  it("caps the log at visibleConversationCount conversations and keeps the newest", () => {
    // 12 messages at the default visibleConversationCount=5 (see renderPanel) = the last 5
    // conversations = 10 messages, since msg() alternates user/assistant 1:1.
    const { container } = renderPanel(Array.from({ length: 12 }, (_, i) => msg(i)));
    expect(container.querySelectorAll(".turn")).toHaveLength(10);
    const text = container.querySelector("#chat-log")?.textContent ?? "";
    expect(text).toContain("message 11");
    expect(text).not.toContain("message 0");
  });

  it("shows only the single in-progress conversation at the real default of 1", () => {
    const { container } = renderPanel(Array.from({ length: 6 }, (_, i) => msg(i)), {
      visibleConversationCount: 1,
    });
    expect(container.querySelectorAll(".turn")).toHaveLength(2);
    const text = container.querySelector("#chat-log")?.textContent ?? "";
    expect(text).toContain("message 5");
    expect(text).not.toContain("message 3");
  });

  it("keeps a conversation's extra trailing messages together rather than splitting on a flat count", () => {
    // Turn 2 (a user message plus three assistant messages — e.g. a streamed reply, a
    // config-ack notice, and an onboarding-failure follow-up) must not be cut mid-turn.
    const messages: ChatMessage[] = [
      msg(0),
      msg(1, { text: "reply 1" }),
      msg(2, { role: "user", text: "message 2" }),
      msg(3, { role: "assistant", text: "reply 2a" }),
      msg(4, { role: "assistant", text: "reply 2b" }),
      msg(5, { role: "assistant", text: "reply 2c" }),
    ];
    const { container } = renderPanel(messages, { visibleConversationCount: 1 });
    expect(container.querySelectorAll(".turn")).toHaveLength(4);
    const text = container.querySelector("#chat-log")?.textContent ?? "";
    expect(text).toContain("reply 2c");
    expect(text).toContain("reply 2a");
    expect(text).not.toContain("reply 1");
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

  it("shows a plain non-interactive duration line for a finished turn with no tool calls", () => {
    const { container } = renderPanel([msg(1, { elapsedMs: 3400 })]);
    const toggle = container.querySelector(".thinking-toggle-static");
    expect(toggle?.textContent).toBe("Thought for 3s");
    expect(toggle?.tagName).toBe("SPAN");
    expect(container.querySelector(".thinking-toggle button")).toBeNull();
  });

  it("shows an expandable duration toggle once a finished turn has tool-call steps", () => {
    const { container } = renderPanel([
      msg(1, { elapsedMs: 12000, steps: [{ type: "tool_called", label: "get_settings" }] }),
    ]);
    const btn = container.querySelector(".thinking-toggle-btn") as HTMLButtonElement;
    expect(btn.textContent).toBe("Thought for 12s");
    expect(container.querySelector(".thinking-steps")).toBeNull();
    fireEvent.click(btn);
    expect(container.querySelector(".thinking-steps")?.textContent).toContain("get_settings");
  });

  it("renders the live indicator while a turn is in flight, not a completed toggle", () => {
    const { container } = renderPanel([msg(1)], {
      liveStartedAt: Date.now(),
      liveSteps: [{ type: "interpreting", label: "Interpreting…" }],
    });
    expect(container.querySelector(".thinking-dots")).not.toBeNull();
    expect(container.querySelector(".thinking-toggle-btn")?.textContent).toContain("Interpreting…");
  });

  it("omits the live indicator once nothing is running", () => {
    const { container } = renderPanel([msg(1)], { liveStartedAt: null });
    expect(container.querySelector(".thinking-dots")).toBeNull();
  });

  it("starts at the bottom, so no jump button is offered", () => {
    // jsdom reports every dimension as 0, which reads as "at the bottom" — the threshold
    // arithmetic itself is covered in useScrollToBottom.test.ts.
    const { container } = renderPanel([msg(0), msg(1)]);
    expect(container.querySelector("#chat-jump-bottom")).toBeNull();
  });
});
