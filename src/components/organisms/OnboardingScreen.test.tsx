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

/** Chip steps 4–6, then the provider chip and the three steps it seeds. */
function finishFromChipSteps(chips: [string, string, string], provider = "OpenAI") {
  for (const chip of chips) fireEvent.click(screen.getByText(chip));
  fireEvent.click(screen.getByText(provider));
  // URL and model arrive prefilled from the registry, so Enter alone carries them.
  fireEvent.keyDown(screen.getByLabelText("Where should I reach it?"), { key: "Enter" });
  fireEvent.change(screen.getByPlaceholderText("sk-…"), { target: { value: " sk-test " } });
  fireEvent.keyDown(screen.getByPlaceholderText("sk-…"), { key: "Enter" });
  fireEvent.keyDown(screen.getByLabelText("Which model?"), { key: "Enter" });
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
    expect(document.querySelector(".onboarding-step-index")?.textContent).toBe("4 / 10");
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
      // The chip stores the registry id, not the label the user clicked.
      providerId: "openai",
      // Both seeded by the provider choice and carried through untouched.
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4.1-mini",
    });
  });

  it("lets the skip button pass an optional chip step without recording an answer", () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen onComplete={onComplete} />);

    reachChipSteps();
    fireEvent.click(screen.getByLabelText("Skip"));
    fireEvent.click(screen.getByLabelText("Skip"));
    fireEvent.click(screen.getByLabelText("Skip"));
    // The provider step is required, so it offers no Skip — proving that is the point of the
    // assertion below rather than an incidental detail of this walkthrough.
    expect(screen.queryByLabelText("Skip")).toBeNull();
    fireEvent.click(screen.getByText("OpenAI"));
    fireEvent.keyDown(screen.getByLabelText("Where should I reach it?"), { key: "Enter" });
    fireEvent.change(screen.getByPlaceholderText("sk-…"), { target: { value: "sk-test" } });
    fireEvent.keyDown(screen.getByPlaceholderText("sk-…"), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("Which model?"), { key: "Enter" });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ responseStyle: "", technicalLevel: "", stuckStyle: "" })
    );
  });

  it("seeds the URL and model from the provider, and stores its id", () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen onComplete={onComplete} />);
    reachChipSteps();
    finishFromChipSteps(["Detailed", "Expert", "Give me options"], "Claude");

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "anthropic",
        apiUrl: "https://api.anthropic.com/v1",
        model: "claude-haiku-4-5-20251001",
      })
    );
  });

  it("does not require a key for a local server, but does require a URL and model", () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen onComplete={onComplete} />);
    reachChipSteps();
    for (const chip of ["Detailed", "Expert", "Give me options"]) fireEvent.click(screen.getByText(chip));
    fireEvent.click(screen.getByText("Local AI"));

    // Nothing to prefill — only the user knows their server's address, so blank cannot mean
    // "use OpenAI's" the way an empty chatApiUrl does elsewhere.
    const url = screen.getByLabelText("Where should I reach it?") as HTMLInputElement;
    expect(url.value).toBe("");
    expect((screen.getByLabelText("Next") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(url, { target: { value: "http://localhost:11434/v1" } });
    fireEvent.keyDown(url, { key: "Enter" });

    // A local server authenticates nothing, so the key step must let an empty value through —
    // requiring one would block the provider whose whole point is not having one.
    expect((screen.getByLabelText("Next") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(screen.getByPlaceholderText("sk-…"), { key: "Enter" });

    const model = screen.getByLabelText("Which model?") as HTMLInputElement;
    expect(model.value).toBe("");
    fireEvent.change(model, { target: { value: "llama3.2:3b" } });
    fireEvent.keyDown(model, { key: "Enter" });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "local", apiUrl: "http://localhost:11434/v1", apiKey: "", model: "llama3.2:3b" })
    );
  });

  it("warns when a remote provider URL would send the key in the clear", () => {
    render(<OnboardingScreen onComplete={vi.fn()} />);
    reachChipSteps();
    for (const chip of ["Detailed", "Expert", "Give me options"]) fireEvent.click(screen.getByText(chip));
    fireEvent.click(screen.getByText("Local AI"));

    const url = screen.getByLabelText("Where should I reach it?");
    fireEvent.change(url, { target: { value: "http://example.com/v1" } });
    expect(screen.getByText(/sent unencrypted/)).toBeTruthy();

    // Loopback is the case the warning must stay quiet for — it is the documented Ollama setup.
    fireEvent.change(url, { target: { value: "http://localhost:11434/v1" } });
    expect(screen.queryByText(/sent unencrypted/)).toBeNull();
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
