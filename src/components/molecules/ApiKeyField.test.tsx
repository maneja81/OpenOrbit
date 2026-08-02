import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ApiKeyField from "./ApiKeyField";

// vitest runs with globals: false, so @testing-library/react cannot register its own auto
// cleanup — without this every render accumulates and queries match across tests.
afterEach(cleanup);

function setup(isSet = false) {
  const onSave = vi.fn();
  // Queried directly rather than by label: the label's text also contains the "a key is saved"
  // hint, so getByLabelText matches more than one node. A password input has no implicit role.
  const { container } = render(<ApiKeyField label="API Key" isSet={isSet} onSave={onSave} />);
  const input = container.querySelector("input");
  if (!input) throw new Error("no input rendered");
  return { onSave, input };
}

describe("ApiKeyField", () => {
  it("saves what was typed on blur, once", () => {
    // Not per keystroke: the response carries no key, so a per-keystroke field would clear
    // itself after the first character and a key could never be typed.
    const { onSave, input } = setup();
    fireEvent.change(input, { target: { value: "sk-abc123" } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledExactlyOnceWith("sk-abc123");
  });

  it("saves on Enter too", () => {
    const { onSave, input } = setup();
    fireEvent.change(input, { target: { value: "sk-abc123" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledExactlyOnceWith("sk-abc123");
  });

  it("trims what it saves", () => {
    const { onSave, input } = setup();
    fireEvent.change(input, { target: { value: "  sk-abc123  " } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith("sk-abc123");
  });

  it("does not save when the field was never touched", () => {
    // Tabbing through Settings must not wipe a stored key. An empty draft means "unchanged",
    // not "remove it" — the renderer has no way to tell the difference otherwise, because it
    // is never given the stored value to compare against.
    const { onSave, input } = setup(true);
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save whitespace", () => {
    const { onSave, input } = setup(true);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears the box after saving, so the key is not left on screen", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "sk-abc123" } });
    fireEvent.blur(input);
    expect(input.value).toBe("");
  });

  it("says a key is saved when one already is", () => {
    setup(true);
    expect(screen.getByText(/A key is saved/i, { selector: "small" })).toBeInTheDocument();
  });

  it("says nothing of the sort on a fresh install", () => {
    setup(false);
    expect(screen.queryByText(/A key is saved/i, { selector: "small" })).not.toBeInTheDocument();
  });

  it("reports saved immediately after a save, without waiting for a refetch", () => {
    // isSet arrives from main, so it lags the write by a round trip; without this the field
    // would briefly claim no key was set right after one was entered.
    const { input } = setup(false);
    fireEvent.change(input, { target: { value: "sk-abc123" } });
    fireEvent.blur(input);
    expect(screen.getByText(/A key is saved/i, { selector: "small" })).toBeInTheDocument();
  });

  it("never renders the key as readable text", () => {
    const { input } = setup(true);
    fireEvent.change(input, { target: { value: "sk-abc123" } });
    expect(input.type).toBe("password");
  });
});
