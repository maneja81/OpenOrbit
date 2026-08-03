import { describe, expect, it } from "vitest";
import { approvalSettledMessage } from "./approvalSettledMessage";

describe("approvalSettledMessage", () => {
  it("says a timed-out approval was declined and can be asked for again", () => {
    const text = approvalSettledMessage("jsonplaceholder_delete_post", "timeout", 5 * 60 * 1000);

    expect(text).toContain("expired after 5 minutes");
    expect(text).toContain("declined");
    expect(text).toContain("Ask me again");
  });

  // The whole reason the duration is a parameter: it used to be hardcoded as "5 minutes" while
  // APPROVAL_TIMEOUT_MS lived in main, and a 20-second timeout still produced "5 minutes".
  it("reports the window main actually enforced, not a hardcoded one", () => {
    expect(approvalSettledMessage("x_y", "timeout", 20 * 1000)).toContain("expired after 20 seconds");
    expect(approvalSettledMessage("x_y", "timeout", 20 * 1000)).not.toContain("5 minutes");
  });

  it("omits the duration rather than inventing one when the window is unknown", () => {
    const text = approvalSettledMessage("x_y", "timeout");

    expect(text).toContain("expired,");
    expect(text).not.toMatch(/after \d/);
  });

  it("says an abandoned approval never ran, without inviting a retry", () => {
    const text = approvalSettledMessage("jsonplaceholder_delete_post", "abandoned", 5 * 60 * 1000);

    expect(text).toContain("the run ended");
    expect(text).toContain("never ran");
    // Retrying the approval alone achieves nothing once the run is gone — the user has to
    // start a new turn, so this case must not suggest otherwise.
    expect(text).not.toContain("Ask me again");
  });

  it("humanizes the tool name rather than showing the raw identifier", () => {
    const text = approvalSettledMessage("jsonplaceholder_delete_post", "timeout", 60_000);

    expect(text).not.toContain("jsonplaceholder_delete_post");
  });

  it("both reasons make clear the call did not run", () => {
    expect(approvalSettledMessage("x_y", "timeout", 60_000)).toMatch(/declined/);
    expect(approvalSettledMessage("x_y", "abandoned", 60_000)).toMatch(/never ran/);
  });
});
