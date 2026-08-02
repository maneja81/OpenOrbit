import { describe, expect, it, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import HttpToolApprovalModal, { type PendingToolApproval } from "./HttpToolApprovalModal";

const APPROVAL: PendingToolApproval = {
  approvalId: "ap-1",
  toolName: "jsonplaceholder_delete_post",
  agentName: "Atlas",
  args: '{"id":1}',
};

/** This modal gates a paused agent run over a real side effect — a POST, PUT or DELETE against
 * someone's API. Every exit has to answer the call, and no accidental one may answer it. */
describe("HttpToolApprovalModal", () => {
  afterEach(cleanup);

  it("approves on Approve", () => {
    const onRespond = vi.fn();
    render(<HttpToolApprovalModal approval={APPROVAL} onRespond={onRespond} />);

    fireEvent.click(screen.getByText("Approve"));

    expect(onRespond).toHaveBeenCalledWith("ap-1", true);
  });

  it("declines on Don't run", () => {
    const onRespond = vi.fn();
    render(<HttpToolApprovalModal approval={APPROVAL} onRespond={onRespond} />);

    fireEvent.click(screen.getByText("Don't run"));

    expect(onRespond).toHaveBeenCalledWith("ap-1", false);
  });

  // U5 — the backdrop used to reach Modal's onClose, which for this modal is a decline. A click
  // that missed the panel silently answered a security prompt.
  it("ignores a click on the backdrop", () => {
    const onRespond = vi.fn();
    const { baseElement } = render(<HttpToolApprovalModal approval={APPROVAL} onRespond={onRespond} />);
    const backdrop = baseElement.querySelector(".modal-backdrop");

    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop!);

    expect(onRespond).not.toHaveBeenCalled();
  });

  it("still declines on Escape", () => {
    const onRespond = vi.fn();
    render(<HttpToolApprovalModal approval={APPROVAL} onRespond={onRespond} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onRespond).toHaveBeenCalledWith("ap-1", false);
  });

  it("renders nothing and answers nothing when there is no approval", () => {
    const onRespond = vi.fn();
    render(<HttpToolApprovalModal approval={null} onRespond={onRespond} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("names the dialog and pretty-prints the call arguments", () => {
    render(<HttpToolApprovalModal approval={APPROVAL} onRespond={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Run this tool?" })).toBeInTheDocument();
    expect(screen.getByText(/"id": 1/)).toBeInTheDocument();
  });

  it("falls back to the raw string when the arguments are not JSON", () => {
    render(<HttpToolApprovalModal approval={{ ...APPROVAL, args: "not json" }} onRespond={vi.fn()} />);

    expect(screen.getByText("not json")).toBeInTheDocument();
  });
});
