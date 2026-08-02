import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import StepFeed from "./StepFeed";
import type { StepEvent } from "@/lib/agents";

describe("StepFeed", () => {
  afterEach(cleanup);

  it("carries the id the tour targets", () => {
    // CLAUDE.md requires tour selectors to be validated against a real rendered id;
    // #agent-activity-feed is asserted in tourSteps.test.ts, and this is the other half.
    const { container } = render(<StepFeed steps={[{ type: "waiting", label: "Waiting for message…" }]} />);
    expect(container.querySelector("#agent-activity-feed")).toBeTruthy();
  });

  it("renders nothing at all when there are no steps", () => {
    const { container } = render(<StepFeed steps={[]} />);
    expect(container.querySelector("#agent-activity-feed")).toBeNull();
  });

  it("shows the real tool name, the calling agent, and the elapsed time", () => {
    const steps: StepEvent[] = [
      { type: "tool_called", label: "Calling tool…", toolName: "web_search", agentName: "Explorer", callId: "c1", at: 1_000 },
      { type: "tool_output", label: "Tool responded", toolName: "web_search", agentName: "Explorer", callId: "c1", at: 2_200 },
    ];
    const { container } = render(<StepFeed steps={steps} />);
    const rows = container.querySelectorAll(".step-feed-item");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".step-feed-agent")?.textContent).toBe("Explorer");
    expect(rows[0].querySelector(".step-feed-label")?.textContent).toBe("Web Search");
    expect(rows[0].querySelector(".step-feed-duration")).toBeNull();
    expect(rows[1].querySelector(".step-feed-duration")?.textContent).toBe("1.2s");
  });

  it("keeps the last four steps and the per-type class the dot colours key off", () => {
    const steps: StepEvent[] = [
      { type: "message_received", label: "Message received" },
      { type: "interpreting", label: "Interpreting…" },
      { type: "handoff_occurred", label: "Delegating to Atlas" },
      { type: "tool_called", label: "Calling tool…", toolName: "read_knowledgebase_file" },
      { type: "responding", label: "Responding" },
    ];
    const { container } = render(<StepFeed steps={steps} />);
    const rows = container.querySelectorAll(".step-feed-item");
    expect(rows).toHaveLength(4);
    expect(rows[0].className).toContain("step-feed-item--interpreting");
    expect(rows[1].className).toContain("step-feed-item--handoff_occurred");
    expect(rows[2].querySelector(".step-feed-label")?.textContent).toBe("Read Knowledge File");
  });

  it("still renders a row when no meta arrived, using the generic label", () => {
    const { container } = render(<StepFeed steps={[{ type: "tool_called", label: "Calling tool…" }]} />);
    expect(container.querySelector(".step-feed-label")?.textContent).toBe("Calling tool…");
    expect(container.querySelector(".step-feed-agent")).toBeNull();
    expect(container.querySelector(".step-feed-duration")).toBeNull();
  });
});
