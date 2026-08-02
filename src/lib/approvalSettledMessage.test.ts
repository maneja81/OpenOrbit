import { describe, expect, it } from "vitest";
import { approvalSettledMessage } from "./approvalSettledMessage";

describe("approvalSettledMessage", () => {
  it("says a timed-out approval was declined and can be asked for again", () => {
    const text = approvalSettledMessage("jsonplaceholder_delete_post", "timeout");

    expect(text).toContain("expired after 5 minutes");
    expect(text).toContain("declined");
    expect(text).toContain("Ask me again");
  });

  it("says an abandoned approval never ran, without inviting a retry", () => {
    const text = approvalSettledMessage("jsonplaceholder_delete_post", "abandoned");

    expect(text).toContain("the run ended");
    expect(text).toContain("never ran");
    // Retrying the approval alone achieves nothing once the run is gone — the user has to
    // start a new turn, so this case must not suggest otherwise.
    expect(text).not.toContain("Ask me again");
  });

  it("humanizes the tool name rather than showing the raw identifier", () => {
    const text = approvalSettledMessage("jsonplaceholder_delete_post", "timeout");

    expect(text).not.toContain("jsonplaceholder_delete_post");
  });

  it("both reasons make clear the call did not run", () => {
    expect(approvalSettledMessage("x_y", "timeout")).toMatch(/declined/);
    expect(approvalSettledMessage("x_y", "abandoned")).toMatch(/never ran/);
  });
});
