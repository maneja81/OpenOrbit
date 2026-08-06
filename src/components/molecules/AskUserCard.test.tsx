import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AskUserCard, { type PendingQuestion } from "./AskUserCard";

afterEach(cleanup);

function makePending(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    questionId: "q1",
    agentName: "Cipher",
    question: "What's your monthly income?",
    field: { type: "text", required: true },
    expiresAt: Date.now() + 5 * 60 * 1000,
    requestedAt: Date.now(),
    ...overrides,
  };
}

describe("AskUserCard — text field", () => {
  it("shows the agent name and question", () => {
    render(<AskUserCard pending={makePending()} onAnswer={vi.fn()} />);
    expect(screen.getByText("Cipher")).toBeTruthy();
    expect(screen.getByText("What's your monthly income?")).toBeTruthy();
  });

  it("submits the typed value on Answer", () => {
    const onAnswer = vi.fn();
    render(<AskUserCard pending={makePending()} onAnswer={onAnswer} />);
    fireEvent.change(screen.getByPlaceholderText("Type your answer…"), { target: { value: "$5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(onAnswer).toHaveBeenCalledWith("q1", "$5000");
  });

  it("does not show Skip when required", () => {
    render(<AskUserCard pending={makePending({ field: { type: "text", required: true } })} onAnswer={vi.fn()} />);
    expect(screen.queryByText("Skip")).toBeNull();
  });

  it("shows Cancel even when required, submitting the cancelled sentinel rather than any typed text", () => {
    const onAnswer = vi.fn();
    render(<AskUserCard pending={makePending({ field: { type: "text", required: true } })} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onAnswer).toHaveBeenCalledWith("q1", "[user cancelled — did not answer]");
  });

  it("Cancel is distinct from Skip when both are shown", () => {
    const onAnswer = vi.fn();
    render(
      <AskUserCard
        pending={makePending({ field: { type: "text", required: false, placeholder: "USD" } })}
        onAnswer={onAnswer}
      />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onAnswer).toHaveBeenCalledWith("q1", "[user cancelled — did not answer]");
  });

  it("shows Skip when not required, submitting the placeholder as the literal answer", () => {
    const onAnswer = vi.fn();
    render(
      <AskUserCard
        pending={makePending({ field: { type: "text", required: false, placeholder: "USD" } })}
        onAnswer={onAnswer}
      />
    );
    fireEvent.click(screen.getByText("Skip"));
    expect(onAnswer).toHaveBeenCalledWith("q1", "USD");
  });

  it("disables Answer until there's real text", () => {
    render(<AskUserCard pending={makePending()} onAnswer={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Answer" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Type your answer…"), { target: { value: "x" } });
    expect(button.disabled).toBe(false);
  });
});

describe("AskUserCard — single_select field", () => {
  const options = [
    { label: "US Dollar", value: "USD" },
    { label: "Euro", value: "EUR" },
  ];

  it("renders one numbered button per option", () => {
    render(
      <AskUserCard
        pending={makePending({ field: { type: "single_select", options, required: true } })}
        onAnswer={vi.fn()}
      />
    );
    expect(screen.getByText("US Dollar")).toBeTruthy();
    expect(screen.getByText("Euro")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("submits the option's value, not its label, on click", () => {
    const onAnswer = vi.fn();
    render(
      <AskUserCard
        pending={makePending({ field: { type: "single_select", options, required: true } })}
        onAnswer={onAnswer}
      />
    );
    fireEvent.click(screen.getByText("Euro"));
    expect(onAnswer).toHaveBeenCalledWith("q1", "EUR");
  });

  it("always shows a \"something else\" escape hatch, even though the model never authored one", () => {
    render(
      <AskUserCard
        pending={makePending({ field: { type: "single_select", options, required: true } })}
        onAnswer={vi.fn()}
      />
    );
    expect(screen.getByText("Something else")).toBeTruthy();
  });

  it("something else opens a free-text input that submits on its own", () => {
    const onAnswer = vi.fn();
    render(
      <AskUserCard
        pending={makePending({ field: { type: "single_select", options, required: true } })}
        onAnswer={onAnswer}
      />
    );
    fireEvent.click(screen.getByText("Something else"));
    const input = screen.getByPlaceholderText("Type your own answer…");
    fireEvent.change(input, { target: { value: "Bitcoin" } });
    fireEvent.submit(input.closest("form")!);
    expect(onAnswer).toHaveBeenCalledWith("q1", "Bitcoin");
  });
});
