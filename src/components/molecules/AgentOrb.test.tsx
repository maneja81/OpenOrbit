import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AgentOrb from "./AgentOrb";
import { AgentLayoutItem } from "@/lib/agents";

const agent: AgentLayoutItem = {
  id: "knowledgeAgent",
  name: "Atlas",
  icon: "ti-book",
  tagline: "Know & Reference",
  description: "Keeps the knowledge base.",
  prompt: "",
  model: "gpt-4.1-mini",
  tools: "[]",
  enabled: 1,
  system: 1,
  created_at: "2026-01-01",
  mcp_server_ids: "[]",
  connector_ids: "[]",
  http_tool_collection_ids: "[]",
  provider_id: "",
  toolNames: ["search_knowledge"],
  connectorToolCount: 0,
  angle: 0,
  orbitTime: 0,
  band: "inner",
};

function renderOrb() {
  return render(<AgentOrb agent={agent} status="standby" side="left" orbRef={() => {}} />);
}

describe("AgentOrb keyboard reachability", () => {
  afterEach(cleanup);

  it("exposes the orb as a focusable button named after the agent", () => {
    renderOrb();
    const orb = screen.getByRole("button", { name: "Atlas details" });
    expect(orb.getAttribute("tabindex")).toBe("0");
  });

  it.each(["Enter", " "])("opens the info modal on %s", (key) => {
    renderOrb();
    fireEvent.keyDown(screen.getByRole("button", { name: "Atlas details" }), { key });
    expect(screen.getByRole("dialog", { name: "Atlas" })).toBeTruthy();
  });

  it("ignores other keys", () => {
    renderOrb();
    fireEvent.keyDown(screen.getByRole("button", { name: "Atlas details" }), { key: "a" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still opens the info modal on click", () => {
    renderOrb();
    fireEvent.click(screen.getByRole("button", { name: "Atlas details" }));
    expect(screen.getByRole("dialog", { name: "Atlas" })).toBeTruthy();
  });

  it("does not let the status dot's label become the button's name", () => {
    renderOrb();
    expect(screen.queryByRole("button", { name: /status/ })).toBeNull();
  });
});
