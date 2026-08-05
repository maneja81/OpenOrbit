import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ChecklistWidget from "./ChecklistWidget";

afterEach(cleanup);

function makeItem(overrides: Partial<ChecklistItemRow> = {}): ChecklistItemRow {
  return {
    id: 1,
    trace_id: "trace-1",
    agent_name: "Orbit",
    position: 0,
    text: "Understand intent",
    status: "pending",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

describe("ChecklistWidget", () => {
  it("shows the empty state when there are no items", () => {
    render(<ChecklistWidget items={[]} />);
    expect(screen.getByText("Nothing planned yet.")).toBeTruthy();
  });

  it("renders every item's text", () => {
    render(
      <ChecklistWidget
        items={[
          makeItem({ id: 1, text: "Understand intent", status: "completed" }),
          makeItem({ id: 2, text: "Respond to user", status: "in_progress" }),
        ]}
      />
    );
    expect(screen.getByText("Understand intent")).toBeTruthy();
    expect(screen.getByText("Respond to user")).toBeTruthy();
  });

  it("does not show an agent label when only one agent has items", () => {
    render(<ChecklistWidget items={[makeItem({ agent_name: "Orbit" })]} />);
    expect(screen.queryByText("Orbit")).toBeNull();
  });

  it("labels each group when more than one agent has items in the same turn", () => {
    render(
      <ChecklistWidget
        items={[
          makeItem({ id: 1, agent_name: "Orbit", text: "Delegate to Cipher" }),
          makeItem({ id: 2, agent_name: "Cipher", text: "Ask domain questions" }),
        ]}
      />
    );
    expect(screen.getByText("Orbit")).toBeTruthy();
    expect(screen.getByText("Cipher")).toBeTruthy();
  });

  it("applies a status-specific class per row so completed/cancelled read as visually distinct", () => {
    render(
      <ChecklistWidget
        items={[
          makeItem({ id: 1, text: "Done", status: "completed" }),
          makeItem({ id: 2, text: "Skipped", status: "cancelled" }),
          makeItem({ id: 3, text: "Waiting", status: "pending" }),
        ]}
      />
    );
    expect(screen.getByText("Done").closest(".checklist-row")?.className).toContain("checklist-row--completed");
    expect(screen.getByText("Skipped").closest(".checklist-row")?.className).toContain("checklist-row--cancelled");
    expect(screen.getByText("Waiting").closest(".checklist-row")?.className).toContain("checklist-row--pending");
  });
});
