import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import OnboardingScreen from "./OnboardingScreen";

/** Fills the two required text steps, leaving the flow parked on the first chip step. */
function reachChipSteps() {
  fireEvent.change(screen.getByPlaceholderText("Orbit"), { target: { value: "Nova" } });
  fireEvent.keyDown(screen.getByPlaceholderText("Orbit"), { key: "Enter" });
  fireEvent.change(screen.getByPlaceholderText("First name is fine"), { target: { value: "Mo" } });
  fireEvent.keyDown(screen.getByPlaceholderText("First name is fine"), { key: "Enter" });
  fireEvent.keyDown(screen.getByPlaceholderText("e.g. Product Designer"), { key: "Enter" });
}

/** Chip steps 4–6, then the final API key step. */
function finishFromChipSteps(chips: [string, string, string]) {
  for (const chip of chips) fireEvent.click(screen.getByText(chip));
  fireEvent.change(screen.getByPlaceholderText("sk-…"), { target: { value: " sk-test " } });
  fireEvent.keyDown(screen.getByPlaceholderText("sk-…"), { key: "Enter" });
}

describe("OnboardingScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("blocks the first step until an agent name is entered", () => {
    render(<OnboardingScreen onComplete={vi.fn()} />);

    const next = screen.getByLabelText("Next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Orbit"), { target: { value: "Nova" } });
    expect(next.disabled).toBe(false);
  });

  it("advances on chip selection and reports every answer, trimmed", () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen onComplete={onComplete} />);

    reachChipSteps();
    expect(document.querySelector(".onboarding-step-index")?.textContent).toBe("4 / 7");
    finishFromChipSteps(["Detailed", "Expert", "Give me options"]);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onComplete).toHaveBeenCalledWith({
      agentName: "Nova",
      userName: "Mo",
      profession: "",
      responseStyle: "Detailed",
      technicalLevel: "Expert",
      stuckStyle: "Give me options",
      apiKey: "sk-test",
    });
  });

  it("lets the skip button pass an optional chip step without recording an answer", () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen onComplete={onComplete} />);

    reachChipSteps();
    fireEvent.click(screen.getByLabelText("Skip"));
    fireEvent.click(screen.getByLabelText("Skip"));
    fireEvent.click(screen.getByLabelText("Skip"));
    fireEvent.change(screen.getByPlaceholderText("sk-…"), { target: { value: "sk-test" } });
    fireEvent.keyDown(screen.getByPlaceholderText("sk-…"), { key: "Enter" });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ responseStyle: "", technicalLevel: "", stuckStyle: "" })
    );
  });

  it("moves focus between chips with the arrow keys", () => {
    render(<OnboardingScreen onComplete={vi.fn()} />);
    reachChipSteps();

    const group = screen.getByRole("radiogroup");
    expect(document.activeElement).toBe(screen.getByText("Brief & direct"));

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByText("Detailed"));

    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByText("Brief & direct"));

    // Wraps backwards off the first chip rather than dead-ending.
    fireEvent.keyDown(group, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByText("Conversational"));
  });
});
