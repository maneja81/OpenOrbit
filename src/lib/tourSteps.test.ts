import { describe, expect, it } from "vitest";
import { TOUR_STEPS } from "./tourSteps";
import defaultAgents from "../../electron/main/ai/defaultAgents.json";

const SETTINGS_SECTIONS = [
  "models",
  "agents",
  "mcp",
  "connectors",
  "http",
  "files",
  "general",
  "safety",
  "sounds",
  "danger",
  "about",
] as const;

const MAX_TITLE_WORDS = 5;

describe("TOUR_STEPS", () => {
  it("targets only id selectors", () => {
    // useTour runs with skipMissingElement: true, so a class or dynamic selector that
    // stops matching degrades silently instead of throwing — hence the id-only contract.
    for (const step of TOUR_STEPS) {
      expect(step.element, `step "${step.title}"`).toMatch(/^#[A-Za-z][\w-]*$/);
    }
  });

  it("keeps titles short and descriptions present", () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.trim().length, `step "${step.title}"`).toBeGreaterThan(0);
      expect(step.title.trim().split(/\s+/).length, `step "${step.title}"`).toBeLessThanOrEqual(MAX_TITLE_WORDS);
      expect(step.description.trim().length, `step "${step.title}"`).toBeGreaterThan(0);
    }
  });

  it("only uses known settings sections", () => {
    for (const step of TOUR_STEPS) {
      if (step.settingsSection === undefined) continue;
      expect(SETTINGS_SECTIONS, `step "${step.title}"`).toContain(step.settingsSection);
    }
  });

  it("never targets an element that only exists inside a modal", () => {
    // The bug this guards: a "Browse past chats" step targeted #chat-history-list, inside the
    // /chat-history modal. driver.js chooses the next step by scanning ahead with a skip
    // predicate and never fires onHighlightStarted for a skipped step, so the step could not
    // open the modal it lived in — it was silently unreachable in every run. Verified live:
    // the tour jumped 7 → 10, skipping it. Features reachable only through a modal or slash
    // command are covered by the step on the affordance that opens them (see CLAUDE.md).
    const MODAL_ONLY_TARGETS = ["#chat-history-list"];

    for (const step of TOUR_STEPS) {
      expect(MODAL_ONLY_TARGETS, `step "${step.title}" targets an element inside a modal`).not.toContain(step.element);
    }
  });

  it("repeats a target only to switch settings sections", () => {
    // Guards the bug this array replaced: two steps both pointed at #widgets-right, so the
    // second highlight silently repeated the first. Re-targeting is legal only when the
    // step opens Settings on a different section, which visibly changes what's on screen.
    const byElement = new Map<string, typeof TOUR_STEPS>();
    for (const step of TOUR_STEPS) {
      byElement.set(step.element, [...(byElement.get(step.element) ?? []), step]);
    }

    for (const [element, steps] of byElement) {
      if (steps.length === 1) continue;
      const sections = steps.map((s) => s.settingsSection);
      expect(sections.every(Boolean), `${element} repeats without a settingsSection`).toBe(true);
      expect(new Set(sections).size, `${element} repeats the same settingsSection`).toBe(steps.length);
    }
  });

  it("only targets agent orbs that are seeded, undeletable system agents", () => {
    // #ag-<id> comes from AgentOrb's id={`ag-${agent.id}`}. Those ids live in the agents
    // table and have been renamed by migration before (setup -> configAgent), so pin them
    // to the seed file: a future rename or a demotion from system fails here instead of
    // silently dropping the step at runtime.
    const systemAgentIds = new Set(defaultAgents.filter((a) => a.system).map((a) => a.id));
    const orbSteps = TOUR_STEPS.filter((s) => s.element.startsWith("#ag-"));

    expect(orbSteps.length).toBeGreaterThan(0);
    for (const step of orbSteps) {
      expect(systemAgentIds, `step "${step.title}"`).toContain(step.element.slice("#ag-".length));
    }
  });
});
