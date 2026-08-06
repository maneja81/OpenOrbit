import { describe, expect, it, afterEach } from "vitest";
import { createRef } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useGlobalTypingFocus } from "./useGlobalTypingFocus";

function Harness({ enabled = true, disabled = false }: { enabled?: boolean; disabled?: boolean }) {
  const inputRef = createRef<HTMLTextAreaElement>();
  useGlobalTypingFocus(inputRef, enabled);
  return <textarea ref={inputRef} disabled={disabled} />;
}

describe("useGlobalTypingFocus", () => {
  afterEach(cleanup);

  it("redirects a background keystroke into the textarea when it's enabled and not disabled", () => {
    const { container } = render(<Harness />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.keyDown(document.body, { key: "h" });
    expect(textarea.value).toBe("h");
  });

  it("does not write into a disabled textarea (KI-12: sendDisabled while an approval/question/run is pending)", () => {
    const { container } = render(<Harness disabled />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.keyDown(document.body, { key: "h" });
    expect(textarea.value).toBe("");
  });

  it("does nothing when the hook itself is disabled (typeAnywhereEnabled off)", () => {
    const { container } = render(<Harness enabled={false} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.keyDown(document.body, { key: "h" });
    expect(textarea.value).toBe("");
  });
});
