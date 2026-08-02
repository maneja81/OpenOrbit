import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import MessageCost from "./MessageCost";

describe("MessageCost", () => {
  afterEach(cleanup);

  it("renders nothing when the run has no logged usage", () => {
    // The greeting, error replies, and anything predating migration 32 land here — a "$0"
    // would claim the turn was free rather than unmeasured.
    const { container } = render(<MessageCost usage={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a trace that logged zero tokens", () => {
    const { container } = render(<MessageCost usage={{ totalTokens: 0, costUsd: null, calls: 0 }} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows tokens before the cost lookup has landed", () => {
    const { container } = render(<MessageCost usage={{ totalTokens: 2_900, costUsd: null, calls: 1 }} />);
    expect(container.querySelector(".message-cost-tokens")?.textContent).toBe("2.9K tok");
    expect(container.querySelector(".message-cost-price")).toBeNull();
  });

  it("adds the price once it backfills", () => {
    const { container } = render(<MessageCost usage={{ totalTokens: 2_900, costUsd: 0.0024, calls: 1 }} />);
    expect(container.querySelector(".message-cost-price")?.textContent).toBe("$0.0024");
    expect(container.querySelector(".message-cost-tokens")?.textContent).toBe("2.9K tok");
  });

  it("names the call count only when the turn spanned more than one", () => {
    const single = render(<MessageCost usage={{ totalTokens: 100, costUsd: 0.001, calls: 1 }} />);
    expect(single.container.querySelector(".message-cost-calls")).toBeNull();
    cleanup();

    const handoff = render(<MessageCost usage={{ totalTokens: 100, costUsd: 0.001, calls: 3 }} />);
    expect(handoff.container.querySelector(".message-cost-calls")?.textContent).toBe("3 calls");
  });

  it("carries the tour's anchor id only when asked to", () => {
    // ChatPanel stamps this on the first costed bubble; ids must stay unique, and
    // tourSteps.test.ts guards the selector contract from the other side.
    const withId = render(<MessageCost usage={{ totalTokens: 100, costUsd: null, calls: 1 }} id="message-cost" />);
    expect(withId.container.querySelector("#message-cost")).toBeTruthy();
    cleanup();

    const withoutId = render(<MessageCost usage={{ totalTokens: 100, costUsd: null, calls: 1 }} />);
    expect(withoutId.container.querySelector("#message-cost")).toBeNull();
  });
});
