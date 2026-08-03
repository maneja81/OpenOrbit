import { afterEach, describe, expect, it } from "vitest";
import { hasAgentsAPI } from "./agentsApi";

describe("hasAgentsAPI", () => {
  afterEach(() => {
    delete (window as unknown as { agentsAPI?: unknown }).agentsAPI;
  });

  it("returns false when window.agentsAPI is not set", () => {
    expect(hasAgentsAPI()).toBe(false);
  });

  it("returns true once window.agentsAPI is injected", () => {
    (window as unknown as { agentsAPI?: unknown }).agentsAPI = {};
    expect(hasAgentsAPI()).toBe(true);
  });

  it("returns false when window.agentsAPI is explicitly falsy", () => {
    (window as unknown as { agentsAPI?: unknown }).agentsAPI = null;
    expect(hasAgentsAPI()).toBe(false);
  });
});
