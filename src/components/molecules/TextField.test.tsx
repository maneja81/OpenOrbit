import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import TextField from "./TextField";

afterEach(cleanup);

function setup(value = "gpt-4.1-mini", warningFor?: (v: string) => string | null) {
  const onCommit = vi.fn();
  const { container, rerender } = render(
    <TextField label="Model ID" value={value} onCommit={onCommit} warningFor={warningFor} />
  );
  const input = container.querySelector("input");
  if (!input) throw new Error("no input rendered");
  return { onCommit, input, rerender };
}

const type = (input: HTMLInputElement, v: string) => fireEvent.change(input, { target: { value: v } });

describe("TextField", () => {
  it("saves once on blur, not per keystroke", () => {
    // Each keystroke used to be an IPC round trip and a SQLite write, with the whole settings
    // blob coming back to re-render the panel.
    const { onCommit, input } = setup();
    type(input, "g");
    type(input, "gp");
    type(input, "gpt-5");
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("gpt-5");
  });

  it("saves on Enter too", () => {
    const { onCommit, input } = setup();
    type(input, "gpt-5");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("gpt-5");
  });

  it("trims what it saves", () => {
    const { onCommit, input } = setup();
    type(input, "  gpt-5  ");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("gpt-5");
  });

  it("does not save an unchanged value", () => {
    const { onCommit, input } = setup();
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not save when only whitespace was added", () => {
    const { onCommit, input } = setup();
    type(input, "  gpt-4.1-mini  ");
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("saves an emptied field, which is how a value is cleared", () => {
    // Unlike the API key field, blank is meaningful here — it is how a URL or model returns to
    // the provider default.
    const { onCommit, input } = setup();
    type(input, "");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("");
  });

  it("follows the stored value when it changes underneath", () => {
    const { input, rerender } = setup();
    rerender(<TextField label="Model ID" value="claude-opus-5" onCommit={vi.fn()} />);
    expect(input.value).toBe("claude-opus-5");
  });

  describe("the optional warning", () => {
    const warn = (v: string) => (v.startsWith("http://") ? "plain http" : null);

    it("reacts to what is typed, before it is saved", () => {
      // Computed from the draft rather than the stored value, so it appears while the value is
      // being considered instead of only after committing it.
      const { input } = setup("https://api.openai.com/v1", warn);
      expect(screen.queryByText("plain http")).not.toBeInTheDocument();
      type(input, "http://example.com/v1");
      expect(screen.getByText("plain http")).toBeInTheDocument();
    });

    it("goes away when the value is corrected", () => {
      const { input } = setup("http://example.com/v1", warn);
      expect(screen.getByText("plain http")).toBeInTheDocument();
      type(input, "https://example.com/v1");
      expect(screen.queryByText("plain http")).not.toBeInTheDocument();
    });
  });
});
