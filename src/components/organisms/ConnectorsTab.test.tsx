import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import ConnectorsTab from "./ConnectorsTab";
import { useConnectors } from "@/hooks/useConnectors";

// Same shape as McpServersTab.test.tsx: the tab takes the hook's return value as a prop, so
// the whole surface is fakeable without module mocking.
type Connectors = ReturnType<typeof useConnectors>;

function entry(id: string, name: string, overrides: Partial<ConnectorCatalogEntry> = {}): ConnectorCatalogEntry {
  return {
    id,
    name,
    description: `${name} connector`,
    icon: "ti-plug",
    status: "disconnected",
    accountLabel: null,
    settingsFields: [],
    settingsConfigured: true,
    credentialsOnly: false,
    settingsSourceId: null,
    ...overrides,
  };
}

function renderTab(catalog: ConnectorCatalogEntry[], overrides: Partial<Connectors> = {}) {
  const connectors: Connectors = {
    connectors: catalog,
    connectingId: null,
    error: null,
    refresh: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    test: vi.fn(async () => ({ ok: true })),
    getSettings: vi.fn(async () => ({})),
    saveSettings: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as Connectors;
  const view = render(<ConnectorsTab connectors={connectors} />);
  return { ...view, connectors };
}

describe("ConnectorsTab", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("renders one accordion per connector", () => {
    const { container } = renderTab([entry("gmail", "Gmail"), entry("cal", "Calendar")]);
    expect(container.querySelectorAll(".agent-accordion").length).toBe(2);
    expect(screen.getByText("Gmail")).toBeTruthy();
    expect(screen.getByText("Calendar")).toBeTruthy();
  });

  it("connects a disconnected connector", () => {
    const { connectors } = renderTab([entry("gmail", "Gmail")]);

    fireEvent.click(screen.getByText("Connect"));

    expect(connectors.connect).toHaveBeenCalledWith("gmail");
  });

  it("disconnects a connected one", () => {
    const { connectors } = renderTab([entry("gmail", "Gmail", { status: "connected" })]);

    fireEvent.click(screen.getByText("Disconnect"));

    expect(connectors.disconnect).toHaveBeenCalledWith("gmail");
  });

  /** Connecting before the credentials exist just fails at the provider, so the button is
   * held shut and says why. */
  it("blocks connecting until settings are filled in", () => {
    renderTab([entry("gmail", "Gmail", { settingsConfigured: false })]);

    const button = screen.getByText("Connect") as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.title).toContain("settings");
  });

  it("shows progress on the connector being connected", () => {
    renderTab([entry("gmail", "Gmail")], { connectingId: "gmail" });

    expect((screen.getByText("Connecting…") as HTMLButtonElement).disabled).toBe(true);
  });

  /** A credentials-only entry exists to hold shared settings for its siblings — offering it
   * a Connect button would be offering to connect nothing. The type's doc comment states
   * this as an invariant, so it is asserted on both render paths: the flat row used when a
   * connector declares no settings fields, and the accordion used when it declares some. */
  it("gives a credentials-only entry no connect button, with no settings fields", () => {
    renderTab([entry("google", "Google", { credentialsOnly: true })]);

    expect(screen.queryByText("Connect")).toBeNull();
    expect(screen.queryByText("Disconnect")).toBeNull();
  });

  it("gives a credentials-only entry no connect button, with settings fields", () => {
    renderTab([
      entry("google", "Google", {
        credentialsOnly: true,
        settingsFields: [{ key: "clientId", label: "Client ID", type: "text" }],
      }),
    ]);

    expect(screen.queryByText("Connect")).toBeNull();
    expect(screen.queryByText("Disconnect")).toBeNull();
  });

  it("loads a connector's saved settings when its accordion opens", async () => {
    const getSettings = vi.fn(async () => ({ clientId: "abc" }));
    renderTab([entry("gmail", "Gmail", { settingsFields: [{ key: "clientId", label: "Client ID", type: "text" }] })], {
      getSettings,
    });

    fireEvent.click(screen.getByText("Gmail"));

    await waitFor(() => expect(getSettings).toHaveBeenCalledWith("gmail"));
  });

  it("surfaces the hook's error", () => {
    renderTab([entry("gmail", "Gmail")], { error: "Couldn't reach Google. Try again." });

    expect(screen.getByText(/Couldn't reach Google/)).toBeTruthy();
  });
});
