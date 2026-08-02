import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("renders the fallback UI when a child throws", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
    consoleSpy.mockRestore();
  });

  it("uses a custom fallback title when provided", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallbackTitle="Custom title">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText("Custom title")).toBeTruthy();
    consoleSpy.mockRestore();
  });

  // U12 — AgentsApp nests a boundary around ChatPanel inside the one around OrbitScene, because
  // ChatPanel is rendered as OrbitScene's children. These two pin the behaviour that makes the
  // nesting worth having: the innermost boundary catches, and its siblings stay mounted.
  it("contains a throw to the innermost boundary, leaving siblings mounted", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallbackTitle="The orbit failed to load">
        <div>
          <p>orbit still here</p>
          <ErrorBoundary fallbackTitle="The chat failed to load">
            <Bomb />
          </ErrorBoundary>
        </div>
      </ErrorBoundary>
    );

    expect(screen.getByText("The chat failed to load")).toBeTruthy();
    expect(screen.getByText("orbit still here")).toBeTruthy();
    // The outer boundary must NOT have tripped — if it had, the sibling would be gone and the
    // whole scene would have been replaced, which is the behaviour this finding is about.
    expect(screen.queryByText("The orbit failed to load")).toBeNull();
    consoleSpy.mockRestore();
  });

  it("catches at the outer boundary when the throw is outside the inner one", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallbackTitle="The orbit failed to load">
        <div>
          <Bomb />
          <ErrorBoundary fallbackTitle="The chat failed to load">
            <p>chat</p>
          </ErrorBoundary>
        </div>
      </ErrorBoundary>
    );

    expect(screen.getByText("The orbit failed to load")).toBeTruthy();
    expect(screen.queryByText("chat")).toBeNull();
    consoleSpy.mockRestore();
  });
});
