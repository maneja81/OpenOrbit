import { describe, expect, it, afterEach, beforeAll, vi } from "vitest";
import { createRef } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import ChatInputBar from "./ChatInputBar";

// jsdom implements no layout, so Element.scrollIntoView is absent — SlashCommandMenu calls it
// on mount to keep the active row visible. Stubbed rather than guarded in the component:
// the call is correct in a real browser and shouldn't grow a defensive branch for the test env.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// useAppLauncher guards on hasAgentsAPI(), which is false in jsdom, so the launcher no-ops
// and needs no mock — the slash menu's "apps" mode simply has an empty list here.
function renderBar(overrides: Partial<Parameters<typeof ChatInputBar>[0]> = {}) {
  const props = {
    inputRef: createRef<HTMLTextAreaElement>(),
    agentName: "Alex",
    listening: false,
    transcribing: false,
    voiceEnabled: true,
    agents: [],
    onSend: vi.fn(),
    onStartVoice: vi.fn(),
    onStopVoice: vi.fn(),
    ...overrides,
  };
  return { ...render(<ChatInputBar {...props} />), props };
}

describe("ChatInputBar", () => {
  afterEach(cleanup);

  it("keeps the ids the tour targets", () => {
    // #inp and #vbtn are live TOUR_STEPS selectors (src/lib/tourSteps.ts) — the two-zone
    // card restructure moved both into .input-top, so this guards against a silent rename.
    const { container } = renderBar();
    expect(container.querySelector("#inp")).not.toBeNull();
    expect(container.querySelector("#vbtn")).not.toBeNull();
    expect(container.querySelector(".input-card")).not.toBeNull();
    expect(container.querySelector(".input-toolbar")).not.toBeNull();
  });

  it("omits the voice button when voice is disabled", () => {
    const { container } = renderBar({ voiceEnabled: false });
    expect(container.querySelector("#vbtn")).toBeNull();
    // The card must still render its top zone with only the textarea in it.
    expect(container.querySelector(".input-top #inp")).not.toBeNull();
  });

  it("shows the send button only once there is text", () => {
    const { container } = renderBar();
    expect(container.querySelector("#sbtn")).toBeNull();
    const input = container.querySelector("#inp") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "hello" } });
    expect(container.querySelector("#sbtn")).not.toBeNull();
  });

  it("names the agent in the disclaimer", () => {
    const { container } = renderBar({ agentName: "Orbit" });
    expect(container.querySelector(".hint")?.textContent).toBe(
      "Orbit can make mistakes, please validate responses."
    );
  });

  it("renders the slash menu as a sibling of the card, not inside it", () => {
    // .input-card sets overflow:hidden to clip the toolbar's corners, so a menu nested
    // inside it would be cut off rather than floating above the card.
    const { container } = renderBar();
    const input = container.querySelector("#inp") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "/" } });
    expect(container.querySelector(".slash-menu")).not.toBeNull();
    expect(container.querySelector(".input-card .slash-menu")).toBeNull();
  });

  it("opens the command menu from the toolbar chip", () => {
    const { container } = renderBar();
    fireEvent.click(container.querySelector(".tb-chip") as HTMLButtonElement);
    const input = container.querySelector("#inp") as HTMLTextAreaElement;
    expect(input.value).toBe("/");
    expect(container.querySelector(".slash-menu")).not.toBeNull();
  });

  it("reopens the menu from the chip after Escape leaves a bare slash behind", () => {
    // Escape calls closeSlashMenu(), which resets the menu state but not the input — the
    // value stays "/". Found in a live run: gating the chip on hasText alone left it dead
    // in that state, so the affordance could open the menu once and never again.
    const { container } = renderBar();
    const input = container.querySelector("#inp") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "/" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(container.querySelector(".slash-menu")).toBeNull();

    const chip = container.querySelector(".tb-chip") as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    fireEvent.click(chip);
    expect(container.querySelector(".slash-menu")).not.toBeNull();
  });

  it("re-enables the chip after a send clears the field", () => {
    // onSend leaves the textarea to AgentsApp to clear, so no input event fires — the chip's
    // enabled state has to be reset explicitly or it stays disabled over an empty field.
    const { container } = renderBar();
    const input = container.querySelector("#inp") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "hello" } });
    expect((container.querySelector(".tb-chip") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect((container.querySelector(".tb-chip") as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the chip once there is text", () => {
    // parseSlashState only recognises a leading "/", so with text present the chip could
    // only act by discarding what was typed.
    const { container } = renderBar();
    const chip = container.querySelector(".tb-chip") as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    fireEvent.input(container.querySelector("#inp") as HTMLTextAreaElement, {
      target: { value: "hello" },
    });
    expect((container.querySelector(".tb-chip") as HTMLButtonElement).disabled).toBe(true);
  });
});
