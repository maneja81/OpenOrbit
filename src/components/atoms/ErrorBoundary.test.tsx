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
});
