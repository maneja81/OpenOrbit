import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import McpServersTab from "./McpServersTab";
import { useMcpServers } from "@/hooks/useMcpServers";

// The tab takes the hook's return value as a prop, so the whole surface can be faked
// directly — no module mocking needed.
type Mcp = ReturnType<typeof useMcpServers>;

function server(id: string, name: string, overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id,
    name,
    command: "npx",
    args: JSON.stringify(["-y", `@modelcontextprotocol/server-${name.toLowerCase()}`]),
    env: "{}",
    enabled: 1,
    created_at: "2026-08-01 10:00:00",
    ...overrides,
  };
}

function searchResult(name: string, overrides: Partial<McpSearchResult> = {}): McpSearchResult {
  return {
    id: name,
    name,
    description: `${name} server`,
    command: "npx",
    args: ["-y", `@modelcontextprotocol/server-${name}`],
    env: {},
    requiredEnv: [],
    ...overrides,
  };
}

/** Add → Browse Registry → Search, the three clicks every registry case starts with. */
async function search(container: HTMLElement) {
  fireEvent.click(screen.getByRole("button", { name: /Add MCP Server/ }));
  fireEvent.click(screen.getByRole("button", { name: "Browse Registry" }));
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(container.querySelector(".mcp-add-form")).not.toBeNull());
}

function renderTab(servers: McpServerRow[], overrides: Partial<Mcp> = {}) {
  const mcp: Mcp = {
    servers,
    loading: false,
    error: null,
    addServer: vi.fn(async () => undefined),
    updateServer: vi.fn(async () => undefined),
    removeServer: vi.fn(async () => undefined),
    getEnv: vi.fn(async () => ({})),
    testServer: vi.fn(async () => null),
    searchRegistry: vi.fn(async () => []),
    ...overrides,
  } as unknown as Mcp;
  const view = render(<McpServersTab mcp={mcp} />);
  return { ...view, mcp };
}

describe("McpServersTab", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("renders one accordion per server, matching Connectors and HTTP Tools", () => {
    const { container } = renderTab([server("a", "Everything"), server("b", "Docker")]);
    expect(container.querySelectorAll(".agent-accordion-list")).toHaveLength(1);
    expect(container.querySelectorAll(".agent-accordion")).toHaveLength(2);
    // The chevron is what makes a row read as expandable — it's the visible difference
    // from the flat .settings-folder-row list this replaced.
    expect(container.querySelectorAll(".agent-accordion-chevron")).toHaveLength(2);
    expect(container.querySelectorAll(".settings-folder-row")).toHaveLength(0);
  });

  it("opens the edit form inside the row it belongs to, not below the whole list", async () => {
    // The original defect: editing the *first* server rendered one shared form at the
    // bottom of the section, below every other row, with nothing tying it to its server.
    const { container } = renderTab([server("a", "Everything"), server("b", "Docker")]);
    fireEvent.click(screen.getByRole("button", { expanded: false, name: /Everything/ }));

    const body = await waitFor(() => {
      const el = container.querySelector(".agent-accordion-body");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const first = container.querySelectorAll(".agent-accordion")[0];
    expect(first.contains(body)).toBe(true);
    expect(body.querySelector("textarea.mcp-env-textarea")).not.toBeNull();
  });

  it("decrypts env only when a row is actually opened", async () => {
    const getEnv = vi.fn(async () => ({ API_KEY: "sk-test" }));
    const { mcp } = renderTab([server("a", "Everything")], { getEnv });
    expect(mcp.getEnv).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { expanded: false, name: /Everything/ }));
    await waitFor(() => expect(mcp.getEnv).toHaveBeenCalledWith("a"));
    // Fetched env lands in the textarea as KEY=value lines.
    await waitFor(() =>
      expect(screen.getByPlaceholderText("API_KEY=sk-...")).toHaveProperty("value", "API_KEY=sk-test")
    );
  });

  it("keeps delete from expanding the row being deleted", () => {
    // Holds today because SettingsAccordion renders headerActions as a *sibling* of the
    // toggle button rather than inside it, so the click never reaches the toggle. That's
    // a property of the shell, not of this file — pinned here because nesting the actions
    // inside the toggle would silently expand the row behind the confirm modal.
    const { container } = renderTab([server("a", "Everything")]);
    fireEvent.click(screen.getByLabelText("Remove Everything"));
    expect(container.querySelector(".agent-accordion-body")).toBeNull();
    // Scoped to the header rather than by name: the confirm modal now on screen also
    // carries the server's name, so a name-based lookup matches two buttons.
    const header = container.querySelector(".agent-accordion-header-toggle") as HTMLElement;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    // The delete itself still got through — the click wasn't simply swallowed.
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("toggles a server without opening its form", async () => {
    const { container, mcp } = renderTab([server("a", "Everything")]);
    fireEvent.click(screen.getByLabelText("Toggle Everything"));
    await waitFor(() => expect(mcp.updateServer).toHaveBeenCalledWith("a", { enabled: false }));
    expect(container.querySelector(".agent-accordion-body")).toBeNull();
  });

  it("shows only one form at a time — opening a server closes the Add form", async () => {
    const { container } = renderTab([server("a", "Everything")]);
    fireEvent.click(screen.getByRole("button", { name: /Add MCP Server/ }));
    expect(container.querySelector(".mcp-add-form")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { expanded: false, name: /Everything/ }));
    await waitFor(() => expect(container.querySelector(".mcp-add-form")).toBeNull());
    expect(container.querySelector(".agent-accordion-body")).not.toBeNull();
  });

  it("offers Manual/Registry only when adding, not when editing an existing server", async () => {
    const { container } = renderTab([server("a", "Everything")]);
    fireEvent.click(screen.getByRole("button", { name: /Add MCP Server/ }));
    expect(container.querySelector(".mcp-add-mode-tabs")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { expanded: false, name: /Everything/ }));
    await waitFor(() => expect(container.querySelector(".agent-accordion-body")).not.toBeNull());
    // An existing server has nothing to browse a registry for — its body is the edit form.
    expect(container.querySelector(".mcp-add-mode-tabs")).toBeNull();
  });

  it("still lists registry results as flat rows with an Install action", async () => {
    const searchRegistry = vi.fn(async () => [
      {
        id: "r1",
        name: "filesystem",
        description: "Local files",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: {},
        requiredEnv: [],
      },
    ]);
    const { container } = renderTab([], { searchRegistry });
    fireEvent.click(screen.getByRole("button", { name: /Add MCP Server/ }));
    fireEvent.click(screen.getByRole("button", { name: "Browse Registry" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(container.querySelectorAll(".settings-folder-row")).toHaveLength(1));
    // Results are search hits with one action, not editable items — no accordion for them.
    expect(container.querySelectorAll(".agent-accordion")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
  });

  it("saves an edit against the server whose row is open", async () => {
    const { mcp } = renderTab([server("a", "Everything"), server("b", "Docker")]);
    fireEvent.click(screen.getByRole("button", { expanded: false, name: /Docker/ }));
    await waitFor(() => expect(mcp.getEnv).toHaveBeenCalledWith("b"));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mcp.updateServer).toHaveBeenCalled());
    expect((mcp.updateServer as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("b");
  });

  it("installs a registry result disabled, in a single write", async () => {
    const searchRegistry = vi.fn(async () => [searchResult("filesystem")]);
    const { container, mcp } = renderTab([], { searchRegistry });
    await search(container);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => expect(mcp.addServer).toHaveBeenCalledTimes(1));
    expect((mcp.addServer as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ enabled: false });
    // The create-then-disable pair this replaced left a third-party command enabled whenever the
    // second write failed — the one outcome installing-disabled exists to prevent.
    expect(mcp.updateServer).not.toHaveBeenCalled();
  });

  it("says nothing matched only once a search has actually run", async () => {
    const searchRegistry = vi.fn(async () => []);
    renderTab([], { searchRegistry });
    fireEvent.click(screen.getByRole("button", { name: /Add MCP Server/ }));
    fireEvent.click(screen.getByRole("button", { name: "Browse Registry" }));

    // An empty list before the first search must not read as "no results". It was indistinguishable
    // for as long as the parser returned nothing for every query.
    expect(screen.queryByText(/No installable servers matched/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText(/No installable servers matched/)).toBeTruthy());
  });

  it("names the keys a result needs before it is installed", async () => {
    const searchRegistry = vi.fn(async () => [
      searchResult("gcs", { requiredEnv: ["GCS_BUCKET", "GCS_PROJECT_ID"] }),
      searchResult("plain"),
    ]);
    const { container } = renderTab([], { searchRegistry });
    await search(container);
    await waitFor(() => expect(container.querySelectorAll(".settings-folder-row")).toHaveLength(2));

    // Installed servers land disabled with empty env values, so a required key that isn't named
    // here surfaces only as an opaque Test connection failure later.
    const warnings = container.querySelectorAll(".settings-warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].textContent).toContain("GCS_BUCKET, GCS_PROJECT_ID");
  });

  it("counts the results it is showing", async () => {
    const searchRegistry = vi.fn(async () => [searchResult("a"), searchResult("b")]);
    const { container } = renderTab([], { searchRegistry });
    await search(container);

    await waitFor(() => expect(container.querySelectorAll(".settings-folder-row")).toHaveLength(2));
    // Scoped to the add form: the section's own .settings-hint sits outside it.
    const form = container.querySelector(".mcp-add-form") as HTMLElement;
    expect(form.querySelector(".settings-hint")?.textContent).toMatch(/2 servers — npm packages only/);
  });

  it("hides the empty-state message while the Add form is open", () => {
    const { container } = renderTab([]);
    expect(screen.getByText("No MCP servers configured yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add MCP Server/ }));
    expect(container.querySelector(".settings-empty")).toBeNull();
  });
});
