import { describe, expect, it, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import OrchestratorOrb from "./OrchestratorOrb";

function renderOrb(cognitiveState: string, sessionStats: string) {
  return render(
    <OrchestratorOrb
      orchestratorRef={createRef<HTMLDivElement>()}
      speaking={false}
      name="Orbit"
      cognitiveState={cognitiveState}
      sessionStats={sessionStats}
    />
  );
}

describe("OrchestratorOrb", () => {
  afterEach(cleanup);

  it("renders the cognitive state under the name", () => {
    const { container } = renderOrb("thinking", "");
    expect(screen.getByText("ORBIT")).toBeTruthy();
    expect(container.querySelector(".sb")?.textContent).toBe("thinking");
  });

  it("renders session stats in their own line when there are any", () => {
    const { container } = renderOrb("orchestrator", "3 messages · 12m");
    expect(container.querySelector(".ss")?.textContent).toBe("3 messages · 12m");
  });

  it("omits the stats line entirely when there is nothing to report", () => {
    const { container } = renderOrb("orchestrator", "");
    expect(container.querySelector(".ss")).toBeNull();
    expect(container.textContent).not.toContain("0");
  });

  it("exposes the orb as a focusable button with a stable name", () => {
    renderOrb("thinking", "3 messages · 12m");
    const orb = screen.getByRole("button", { name: "Orbit details" });
    expect(orb.getAttribute("tabindex")).toBe("0");
  });

  it.each(["Enter", " "])("opens the info modal on %s", (key) => {
    renderOrb("orchestrator", "");
    fireEvent.keyDown(screen.getByRole("button", { name: "Orbit details" }), { key });
    expect(screen.getByRole("dialog", { name: "Orbit" })).toBeTruthy();
  });

  it("ignores other keys", () => {
    renderOrb("orchestrator", "");
    fireEvent.keyDown(screen.getByRole("button", { name: "Orbit details" }), { key: "a" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still opens the info modal on click", () => {
    renderOrb("orchestrator", "");
    fireEvent.click(screen.getByRole("button", { name: "Orbit details" }));
    expect(screen.getByRole("dialog", { name: "Orbit" })).toBeTruthy();
  });
});
