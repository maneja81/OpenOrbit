import { describe, expect, it, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import CodeBlock from "./CodeBlock";

describe("CodeBlock", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("labels the language and renders the code verbatim", () => {
    const { container } = render(<CodeBlock code="const a = 1;" language="ts" />);
    expect(container.querySelector(".code-block-lang")?.textContent).toBe("ts");
    expect(container.querySelector("pre code")?.textContent).toBe("const a = 1;");
  });

  it("keeps the copy button on a fence with no language", () => {
    const { container } = render(<CodeBlock code="plain" />);
    expect(container.querySelector(".code-block-lang")).toBeNull();
    expect(container.querySelector(".code-block-copy")).not.toBeNull();
  });

  it("renders an empty fence rather than collapsing", () => {
    const { container } = render(<CodeBlock code="" language="sh" />);
    expect(container.querySelector(".code-block")).not.toBeNull();
  });

  it("copies the exact code and confirms with a tick", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const { container } = render(<CodeBlock code="echo hi" language="sh" />);
    const button = container.querySelector(".code-block-copy") as HTMLButtonElement;
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(container.querySelector(".code-block-copy i")?.className).toContain("ti-check");
    });
    expect(writeText).toHaveBeenCalledWith("echo hi");
  });

  /** Previously both failure paths returned silently and the icon simply never changed,
   * which reads as "the click missed" rather than "copying is unavailable". CLAUDE.md
   * requires user-facing errors to go through humanizeError, so they now say so. */
  it("says so when the clipboard API is unavailable, without throwing", () => {
    // No clipboard in a non-secure context.
    vi.stubGlobal("navigator", {});
    const { container } = render(<CodeBlock code="echo hi" />);
    const button = container.querySelector(".code-block-copy") as HTMLButtonElement;

    expect(() => fireEvent.click(button)).not.toThrow();

    expect(container.querySelector(".code-block-error")?.textContent).toContain("Copying isn't available here.");
    expect(container.querySelector(".code-block-copy i")?.className).toContain("ti-alert-triangle");
  });

  it("surfaces a humanized message when the write is rejected", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const { container } = render(<CodeBlock code="x" />);
    fireEvent.click(container.querySelector(".code-block-copy") as HTMLButtonElement);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());

    const error = await vi.waitFor(() => {
      const el = container.querySelector(".code-block-error");
      expect(el).not.toBeNull();
      return el!;
    });
    // humanizeError's generic category: title, message, then a concrete next step.
    expect(error.textContent).toContain("denied");
    expect(error.textContent).toContain("Try again");
    expect(container.querySelector(".code-block-copy i")?.className).toContain("ti-alert-triangle");
  });

  it("shows no error on a successful copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const { container } = render(<CodeBlock code="ok" />);
    fireEvent.click(container.querySelector(".code-block-copy") as HTMLButtonElement);
    await vi.waitFor(() => {
      expect(container.querySelector(".code-block-copy i")?.className).toContain("ti-check");
    });

    expect(container.querySelector(".code-block-error")).toBeNull();
  });
});
