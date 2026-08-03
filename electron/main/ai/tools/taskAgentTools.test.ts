import { describe, expect, it } from "vitest";
import { promptTaskNeedsApproval } from "./taskAgentTools";

describe("promptTaskNeedsApproval (backs create_task/update_task's needsApproval)", () => {
  // KI-4: create_task ran unattended regardless of whether it carried a prompt, and a
  // one-shot or recurring prompt task runs through a full orchestrator (MCP servers,
  // connectors, HTTP tools all attached) at a time the conversation that created it may no
  // longer be open — the same persistence risk update_agent's prompt field carries.
  it("does not require approval for a plain reminder (no prompt)", () => {
    expect(promptTaskNeedsApproval(null)).toBe(false);
  });

  it("requires approval for a prompt task, one-shot or recurring", () => {
    expect(promptTaskNeedsApproval("Summarize my unread email")).toBe(true);
  });
});
