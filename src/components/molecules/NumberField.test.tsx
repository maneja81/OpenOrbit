import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import NumberField from "./NumberField";
import { SETTING_BOUNDS, type NumericBound } from "@/lib/settings";

// vitest runs with globals: false, so RTL cannot register its own cleanup.
afterEach(cleanup);

function setup(bound: NumericBound = SETTING_BOUNDS.agentRunTimeoutSeconds, value = 60) {
  const onCommit = vi.fn();
  const { container, rerender } = render(
    <NumberField label="Agent run timeout (seconds)" value={value} bound={bound} onCommit={onCommit} />
  );
  const input = container.querySelector("input");
  if (!input) throw new Error("no input rendered");
  return { onCommit, input, rerender };
}

const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });

describe("NumberField", () => {
  it("commits a valid value on blur", () => {
    const { onCommit, input } = setup();
    type(input, "120");
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(120);
  });

  it("commits on Enter too", () => {
    const { onCommit, input } = setup();
    type(input, "120");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(120);
  });

  it("does not commit an unchanged value", () => {
    const { onCommit, input } = setup();
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  describe("the range it advertises is the range it enforces", () => {
    it("refuses a value below the floor, and says why", () => {
      // `min` on a number input binds the spinner only. A 1-second agent timeout and a 1 ms
      // system-stats poll were both reachable by typing.
      const { onCommit, input } = setup();
      type(input, "1");
      fireEvent.blur(input);
      expect(onCommit).not.toHaveBeenCalled();
      expect(screen.getByText(/Must be between 5–3600/)).toBeInTheDocument();
    });

    it("refuses a value above the ceiling", () => {
      const { onCommit, input } = setup();
      type(input, "600000");
      fireEvent.blur(input);
      expect(onCommit).not.toHaveBeenCalled();
      expect(screen.getByText(/Must be between 5–3600/)).toBeInTheDocument();
    });

    it("accepts values sitting exactly on each bound", () => {
      const { onCommit, input } = setup();
      type(input, "5");
      fireEvent.blur(input);
      type(input, "3600");
      fireEvent.blur(input);
      expect(onCommit).toHaveBeenNthCalledWith(1, 5);
      expect(onCommit).toHaveBeenNthCalledWith(2, 3600);
    });

    it("refuses a fraction where only whole numbers make sense", () => {
      const { onCommit, input } = setup();
      type(input, "1.5");
      fireEvent.blur(input);
      expect(onCommit).not.toHaveBeenCalled();
      expect(screen.getByText(/whole number/i)).toBeInTheDocument();
    });

    it("allows a fraction where the setting is fractional", () => {
      const { onCommit, input } = setup(SETTING_BOUNDS.bgMusicVolume, 0.1);
      type(input, "0.35");
      fireEvent.blur(input);
      expect(onCommit).toHaveBeenCalledWith(0.35);
    });

    it("advertises the real range on the input itself", () => {
      const { input } = setup();
      expect(input.getAttribute("min")).toBe("5");
      expect(input.getAttribute("max")).toBe("3600");
    });
  });

  describe("clearing the box", () => {
    it("restores the stored value rather than committing zero", () => {
      // Number("") is 0, which the old guard rejected — so the field snapped back mid-edit and
      // the number could not be changed by deleting first. For bgMusicVolume 0 is legal, so the
      // same coercion silently muted the music instead.
      const { onCommit, input } = setup();
      type(input, "");
      fireEvent.blur(input);
      expect(onCommit).not.toHaveBeenCalled();
      expect(input.value).toBe("60");
    });

    it("does not mute the music when the volume box is cleared", () => {
      const { onCommit, input } = setup(SETTING_BOUNDS.bgMusicVolume, 0.1);
      type(input, "");
      fireEvent.blur(input);
      expect(onCommit).not.toHaveBeenCalled();
      expect(input.value).toBe("0.1");
    });

    it("lets a value be deleted and retyped, which it previously could not be", () => {
      const { onCommit, input } = setup();
      type(input, "");
      type(input, "9");
      type(input, "90");
      fireEvent.blur(input);
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(90);
    });
  });

  describe("recovering from a rejection", () => {
    it("clears the error as soon as the user types again", () => {
      const { input } = setup();
      type(input, "1");
      fireEvent.blur(input);
      expect(screen.getByText(/Must be between/)).toBeInTheDocument();
      type(input, "10");
      expect(screen.queryByText(/Must be between/)).not.toBeInTheDocument();
    });

    it("keeps the rejected text on screen so it can be corrected", () => {
      // Snapping straight back was the old behaviour, and it lost what the user had typed.
      const { input } = setup();
      type(input, "1");
      fireEvent.blur(input);
      expect(input.value).toBe("1");
    });
  });

  it("follows the stored value when it changes underneath", () => {
    const { input, rerender } = setup();
    rerender(
      <NumberField
        label="Agent run timeout (seconds)"
        value={300}
        bound={SETTING_BOUNDS.agentRunTimeoutSeconds}
        onCommit={vi.fn()}
      />
    );
    expect(input.value).toBe("300");
  });
});
