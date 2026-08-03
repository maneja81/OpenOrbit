import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import HttpToolsTab from "./HttpToolsTab";
import { useHttpTools } from "@/hooks/useHttpTools";
import { DEFAULT_SETTINGS } from "@/lib/settings";

// jsdom has no layout, so Combobox's scroll-into-view has nothing to call.
Element.prototype.scrollIntoView = vi.fn();

// Same shape as McpServersTab.test.tsx / ConnectorsTab.test.tsx — the tab takes the hook's
// return value as a prop, so the surface is fakeable without module mocking.
type HttpTools = ReturnType<typeof useHttpTools>;

function collection(id: string, name: string, overrides: Partial<HttpToolCollectionRow> = {}): HttpToolCollectionRow {
  return {
    id,
    name,
    description: `${name} API`,
    base_url: `https://${name.toLowerCase()}.example.com`,
    headers: "{}",
    enabled: 1,
    allow_private_hosts: 0,
    created_at: "2026-08-01 10:00:00",
    ...overrides,
  };
}

function renderTab(collections: HttpToolCollectionRow[], overrides: Partial<HttpTools> = {}, settingsPatch = {}) {
  const httpTools: HttpTools = {
    collections,
    tools: [],
    toolsForCollection: vi.fn(() => []),
    error: null,
    addCollection: vi.fn(async () => undefined),
    updateCollection: vi.fn(async () => undefined),
    removeCollection: vi.fn(async () => undefined),
    addTool: vi.fn(async () => undefined),
    updateTool: vi.fn(async () => undefined),
    removeTool: vi.fn(async () => undefined),
    getCollectionHeaders: vi.fn(async () => ({})),
    getToolHeaders: vi.fn(async () => ({})),
    testTool: vi.fn(async () => null),
    ...overrides,
  } as unknown as HttpTools;
  const settings = { ...DEFAULT_SETTINGS, ...settingsPatch };
  const view = render(<HttpToolsTab httpTools={httpTools} settings={settings} />);
  return { ...view, httpTools };
}

// The approval controls moved to Settings → Privacy & Safety (finding S10); their tests
// moved with them, to SettingsPanel.test.tsx. What stays here is the per-endpoint "Asks first"
// badge, which is context for the tools rather than a control.
describe("HttpToolsTab", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("renders one accordion per collection", () => {
    const { container } = renderTab([collection("a", "Stripe"), collection("b", "Linear")]);
    expect(container.querySelectorAll(".agent-accordion").length).toBe(2);
  });

  it("tells an empty list how to start", () => {
    renderTab([]);
    expect(screen.getByText(/No HTTP tools yet/)).toBeTruthy();
  });

  // --- Per-method approval policy -------------------------------------------------------

  /** The write methods each get their own toggle, and reads are never gated — the hint says
   * so, and there is deliberately no GET/HEAD row to turn on. */
  // --- Encrypted header storage ---------------------------------------------------------

  /** Header values are stored encrypted on the row, so the form must fetch the decrypted set
   * over IPC when editing rather than reading `collection.headers` off the row it already has. */
  it("fetches decrypted headers over IPC when editing, not from the row", async () => {
    const getCollectionHeaders = vi.fn(async () => ({ Authorization: "Bearer real-secret" }));
    renderTab([collection("a", "Stripe", { headers: '{"Authorization":"<encrypted>"}' })], {
      getCollectionHeaders,
    });

    fireEvent.click(screen.getByText(/^Stripe —/));

    await waitFor(() => expect(getCollectionHeaders).toHaveBeenCalledWith("a"));
    await waitFor(() => {
      expect(screen.getByDisplayValue(/Bearer real-secret/)).toBeTruthy();
    });
  });

  it("never renders the encrypted header blob", () => {
    renderTab([collection("a", "Stripe", { headers: '{"Authorization":"<encrypted>"}' })]);
    expect(screen.queryByText(/<encrypted>/)).toBeNull();
  });

  // --- Private-host gating --------------------------------------------------------------

  /** Reaching a private host is off by default — an agent that can call localhost or a
   * 192.168.* address reaches things the user never meant to expose. */
  it("defaults a new collection to refusing private hosts", () => {
    renderTab([]);

    fireEvent.click(screen.getByText("Add API"));

    expect(screen.getByLabelText("Toggle local address access").getAttribute("aria-checked")).toBe("false");
  });

  it("carries an existing collection's private-host setting into the edit form", async () => {
    renderTab([collection("a", "Local", { allow_private_hosts: 1 })]);

    fireEvent.click(screen.getByText(/^Local —/));

    await waitFor(() => {
      expect(screen.getByLabelText("Toggle local address access").getAttribute("aria-checked")).toBe("true");
    });
  });

  // --- Deletion -------------------------------------------------------------------------

  /** Removing a collection takes its tools with it, so it asks first rather than acting on
   * the click. */
  it("confirms before removing a collection", () => {
    const { httpTools } = renderTab([collection("a", "Stripe")]);

    fireEvent.click(screen.getByLabelText("Remove Stripe"));

    expect(httpTools.removeCollection).not.toHaveBeenCalled();
    // The confirm dialog is the second mention of the name — the accordion header is the first.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText(/Stripe/).length).toBeGreaterThan(1);
  });

  it("surfaces the hook's error", () => {
    renderTab([], { error: "Couldn't save that API. Try again." });
    expect(screen.getByText(/Couldn't save that API/)).toBeTruthy();
  });
});
