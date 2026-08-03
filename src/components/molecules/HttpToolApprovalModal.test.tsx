import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import HttpToolApprovalModal, { type PendingToolApproval } from "./HttpToolApprovalModal";

// expiresAt is built per-render from the current clock so the countdown assertions don't go
// stale as the suite runs.
const approvalIn = (ms: number): PendingToolApproval => ({
  approvalId: "ap-1",
  toolName: "jsonplaceholder_delete_post",
  agentName: "Atlas",
  args: '{"id":1}',
  requestedAt: Date.now(),
  expiresAt: Date.now() + ms,
});

const APPROVAL: PendingToolApproval = approvalIn(5 * 60 * 1000);

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

  // U6 — the prompt answers itself at the deadline; without this the only way to find out was
  // to walk away and come back to a declined call.
  //
  // Fake timers on a whole-second epoch: useApprovalCountdown floors the clock to the second,
  // so against a real clock a five-minute window renders as "5:01" whenever the current
  // millisecond is past .000. Pinning the time makes the rendered digits exact rather than
  // forcing a vaguer assertion.
  describe("countdown", () => {
    const T0 = 1_800_000_000_000;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
      vi.setSystemTime(T0);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows how long is left before it declines itself", () => {
      render(<HttpToolApprovalModal approval={approvalIn(5 * 60 * 1000)} onRespond={vi.fn()} />);

      expect(screen.getByText(/Declines automatically in/)).toBeInTheDocument();
      expect(screen.getByText("5:00")).toBeInTheDocument();
    });

    it("marks the last 30 seconds", () => {
      const { baseElement } = render(<HttpToolApprovalModal approval={approvalIn(25 * 1000)} onRespond={vi.fn()} />);

      expect(baseElement.querySelector(".http-approval-expiry--soon")).not.toBeNull();
      expect(screen.getByText("0:25")).toBeInTheDocument();
    });

    it("does not mark a window that still has minutes on it", () => {
      const { baseElement } = render(
        <HttpToolApprovalModal approval={approvalIn(5 * 60 * 1000)} onRespond={vi.fn()} />
      );

      expect(baseElement.querySelector(".http-approval-expiry--soon")).toBeNull();
    });

    it("says it is expiring once the deadline has passed", () => {
      render(<HttpToolApprovalModal approval={approvalIn(-1000)} onRespond={vi.fn()} />);

      expect(screen.getByText(/Expired/)).toBeInTheDocument();
    });
  });
});
