import { describe, expect, it, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, cleanup } from "@testing-library/react";
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
});
