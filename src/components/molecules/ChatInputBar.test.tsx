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

const MIXED_AGENTS = [
  { id: "a1", name: "Cipher", icon: "ti-settings", system: 1 },
  { id: "a2", name: "Bank Analyst", icon: "ti-robot", system: 0 },
];

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

  it("opens an agent-only menu, grouped System before Custom, on @", () => {
    const { container } = renderBar({ agents: MIXED_AGENTS });
    const input = container.querySelector("#inp") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "@" } });
    const menu = container.querySelector(".slash-menu");
    expect(menu).not.toBeNull();
    const labels = Array.from(menu!.querySelectorAll(".slash-menu-group-label")).map((el) => el.textContent);
    expect(labels).toEqual(["System", "Custom"]);
    const items = Array.from(menu!.querySelectorAll(".slash-menu-label")).map((el) => el.textContent);
    expect(items).toEqual(["Cipher", "Bank Analyst"]);
  });

  it("shows exactly one group header when every agent is in the same group", () => {
    // Default install has zero custom agents — only "System" ever appears, never "Custom".
    const { container } = renderBar({ agents: [MIXED_AGENTS[0]] });
    fireEvent.input(container.querySelector("#inp") as HTMLTextAreaElement, { target: { value: "@" } });
    const menu = container.querySelector(".slash-menu");
    const labels = Array.from(menu!.querySelectorAll(".slash-menu-group-label")).map((el) => el.textContent);
    expect(labels).toEqual(["System"]);
  });

  it("filters the @ menu by agent name and closes the / and apps modes are untouched", () => {
    const { container } = renderBar({ agents: MIXED_AGENTS });
    const input = container.querySelector("#inp") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "@bank" } });
    const items = Array.from(container.querySelectorAll(".slash-menu-label")).map((el) => el.textContent);
    expect(items).toEqual(["Bank Analyst"]);
  });

  it("selects an agent from the @ menu, inserting the plain-name mention and closing the menu", () => {
    const { container } = renderBar({ agents: MIXED_AGENTS });
    const input = container.querySelector("#inp") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "@cip" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("Cipher, ");
    expect(container.querySelector(".slash-menu")).toBeNull();
  });

  it("shows a second 'Agents' chip that opens the @ menu, independent of the Commands chip", () => {
    const { container } = renderBar({ agents: MIXED_AGENTS });
    const chips = container.querySelectorAll(".tb-chip");
    expect(chips.length).toBe(2);
    fireEvent.click(chips[1] as HTMLButtonElement);
    const input = container.querySelector("#inp") as HTMLTextAreaElement;
    expect(input.value).toBe("@");
    expect(container.querySelector(".slash-menu")).not.toBeNull();
  });

  it("disables the Agents chip once there is non-@ text, and re-enables both chips after send", () => {
    const { container } = renderBar({ agents: MIXED_AGENTS });
    const input = container.querySelector("#inp") as HTMLTextAreaElement;
    const chips = () => container.querySelectorAll(".tb-chip");
    fireEvent.input(input, { target: { value: "hello" } });
    expect((chips()[0] as HTMLButtonElement).disabled).toBe(true);
    expect((chips()[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect((chips()[0] as HTMLButtonElement).disabled).toBe(false);
    expect((chips()[1] as HTMLButtonElement).disabled).toBe(false);
  });
});
