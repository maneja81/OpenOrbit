import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SettingsPanel from "./SettingsPanel";
import { mergeWithDefaults } from "@/lib/settings";

// vitest runs with globals: false, so RTL cannot register its own cleanup.
afterEach(cleanup);

// jsdom has no layout, and Combobox scrolls its active row into view on mount.
Element.prototype.scrollIntoView = vi.fn();

// The four data hooks this panel uses all guard on hasAgentsAPI(), which is false under jsdom,
// so they no-op and need no mocking — only the props below.
function renderDangerZone(onReset: () => Promise<void>) {
  render(
    <SettingsPanel
      open
      initialSection="danger"
      onClose={vi.fn()}
      settings={mergeWithDefaults({})}
      savedVersion={0}
      sessionElapsedMs={0}
      onUpdate={vi.fn()}
      onReset={onReset}
      agents={[]}
      onUpdateAgent={vi.fn()}
      onCreateAgent={vi.fn()}
      onDeleteAgent={vi.fn()}
      onExportAgent={vi.fn()}
      onExportAllAgents={vi.fn()}
      onImportAgents={vi.fn()}
      onConfigAck={vi.fn()}
    />
  );
  // Mounting already-open leaves activeSection at its default: sectionOnTransition only fires
  // on the closed→open edge, which in the real app is how the panel always arrives. Navigate
  // the way a user does instead.
  // The sidebar items are role="tab", not buttons.
  fireEvent.click(screen.getByRole("tab", { name: /Danger Zone/i }));
  const input = screen.getByPlaceholderText("RESET") as HTMLInputElement;
  const button = screen.getByRole("button", { name: /Reset to Default/i });
  return { input, button };
}

describe("Danger Zone reset", () => {
  it("stays disabled until the confirmation word is typed exactly", () => {
    const { input, button } = renderDangerZone(vi.fn());
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "reset" } });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "RESET" } });
    expect(button).toBeEnabled();
  });

  it("calls onReset once when confirmed", async () => {
    const onReset = vi.fn().mockResolvedValue(undefined);
    const { input, button } = renderDangerZone(onReset);
    fireEvent.change(input, { target: { value: "RESET" } });
    fireEvent.click(button);
    await waitFor(() => expect(onReset).toHaveBeenCalledExactlyOnceWith());
  });

  describe("when the reset fails", () => {
    // settings:reset drops every app table inside a transaction and re-runs migrations. It can
    // genuinely fail — most plausibly SQLITE_BUSY, since the userData database is shared across
    // worktrees and a second running instance holds a write lock.
    const failing = () => vi.fn().mockRejectedValue(new Error("database is locked"));

    it("re-enables the button instead of leaving it on Resetting… forever", async () => {
      const { input, button } = renderDangerZone(failing());
      fireEvent.change(input, { target: { value: "RESET" } });
      fireEvent.click(button);
      await waitFor(() => expect(button).toBeEnabled());
      expect(button).toHaveTextContent(/Reset to Default/i);
    });

    it("tells the user what went wrong", async () => {
      // It used to say nothing at all — the rejection was unhandled and invisible.
      const { input, button } = renderDangerZone(failing());
      fireEvent.change(input, { target: { value: "RESET" } });
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByText(/database is locked/i)).toBeInTheDocument());
    });

    it("lets the user try again", async () => {
      const onReset = failing();
      const { input, button } = renderDangerZone(onReset);
      fireEvent.change(input, { target: { value: "RESET" } });
      fireEvent.click(button);
      await waitFor(() => expect(button).toBeEnabled());

      fireEvent.click(button);
      await waitFor(() => expect(onReset).toHaveBeenCalledTimes(2));
    });

    it("clears the previous error when retried", async () => {
      const onReset = vi.fn().mockRejectedValueOnce(new Error("database is locked")).mockResolvedValue(undefined);
      const { input, button } = renderDangerZone(onReset);
      fireEvent.change(input, { target: { value: "RESET" } });
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByText(/database is locked/i)).toBeInTheDocument());

      fireEvent.click(button);
      await waitFor(() => expect(screen.queryByText(/database is locked/i)).not.toBeInTheDocument());
    });

    it("does not report failure when the reset succeeds", async () => {
      const { input, button } = renderDangerZone(vi.fn().mockResolvedValue(undefined));
      fireEvent.change(input, { target: { value: "RESET" } });
      fireEvent.click(button);
      // Stays disabled on success — onReset reloads the window, and re-enabling would invite a
      // second click against a database mid-rebuild.
      await waitFor(() => expect(button).toBeDisabled());
      expect(screen.queryByText(/settings-error/i)).not.toBeInTheDocument();
    });
  });
});

describe("orchestrator prompt override", () => {
  function renderAgents(overrideValue: string) {
    const onUpdate = vi.fn();
    render(
      <SettingsPanel
        open
        onClose={vi.fn()}
        settings={mergeWithDefaults({ orchestratorPromptOverride: overrideValue })}
        savedVersion={0}
        sessionElapsedMs={0}
        onUpdate={onUpdate}
        onReset={vi.fn()}
        agents={[]}
        onUpdateAgent={vi.fn()}
        onCreateAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
        onExportAgent={vi.fn()}
        onExportAllAgents={vi.fn()}
        onImportAgents={vi.fn()}
        onConfigAck={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /^Agents$/i }));
    // The orchestrator's accordion is collapsed by default, so its prompt section isn't rendered
    // until the header toggle is clicked.
    const toggle = document.querySelector(".agent-accordion-header-toggle");
    if (!toggle) throw new Error("no accordion header");
    fireEvent.click(toggle);
    // Queried directly rather than through screen: the panel renders into a portal with
    // aria-modal, and once the accordion is expanded getByRole stops resolving inside it.
    const resetButton = () =>
      [...document.querySelectorAll("button")].find((b) => /reset to default/i.test(b.textContent ?? ""));
    return { onUpdate, resetButton };
  }

  it("says nothing when the prompt is the built-in one", () => {
    const { resetButton } = renderAgents("");
    expect(resetButton()).toBeUndefined();
  });

  it("says the prompt is customised, and offers a way back", () => {
    // Nothing told the user an override was active, so improvements to orchestrator.md silently
    // stopped reaching them and there was no way to undo it short of clearing the box by hand.
    const { resetButton } = renderAgents("You are a custom orchestrator.");
    expect(resetButton()).toBeDefined();
    expect(resetButton()?.textContent).toMatch(/customised/i);
  });

  it("clears the override when reset is pressed", () => {
    const { onUpdate, resetButton } = renderAgents("You are a custom orchestrator.");
    fireEvent.click(resetButton()!);
    expect(onUpdate).toHaveBeenCalledWith({ orchestratorPromptOverride: "" });
  });

  it("treats a whitespace-only override as no override", () => {
    // getOrchestratorPromptTemplate trims before deciding, so the renderer must agree —
    // otherwise the button appears for a prompt main is already ignoring.
    const { resetButton } = renderAgents("   \n  ");
    expect(resetButton()).toBeUndefined();
  });
});

describe("Privacy & Safety", () => {
  // These six decide what the app does without asking, and what it can see. They used to be
  // split between the HTTP Tools tab and General, so nobody auditing that had one place to look
  // (finding S10). The approval tests below moved here from HttpToolsTab.test.tsx with the
  // controls themselves.
  function renderSafety(settingsPatch: Record<string, unknown> = {}) {
    const onUpdate = vi.fn();
    render(
      <SettingsPanel
        open
        onClose={vi.fn()}
        settings={mergeWithDefaults(settingsPatch)}
        savedVersion={0}
        sessionElapsedMs={0}
        onUpdate={onUpdate}
        onReset={vi.fn()}
        agents={[]}
        onUpdateAgent={vi.fn()}
        onCreateAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
        onExportAgent={vi.fn()}
        onExportAllAgents={vi.fn()}
        onImportAgents={vi.fn()}
        onConfigAck={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /Privacy & Safety/i }));
    return { onUpdate };
  }

  it("is reachable from the sidebar under its own name", () => {
    renderSafety();
    expect(screen.getByRole("tab", { name: /Privacy & Safety/i })).toBeInTheDocument();
  });

  it("gathers all six controls in one place", () => {
    renderSafety();
    for (const label of [
      "Ask before POST requests",
      "Ask before PUT / PATCH requests",
      "Ask before DELETE requests",
      "How to ask for approval",
      "Toggle location access",
      "Toggle automatic remote image loading",
    ]) {
      expect(screen.getByLabelText(label), label).toBeTruthy();
    }
  });

  it("offers a toggle for each write method and none for reads", () => {
    renderSafety();
    expect(screen.queryByLabelText(/Ask before GET/)).toBeNull();
    expect(screen.getByText(/Reads \(GET, HEAD\) never ask/)).toBeTruthy();
  });

  it("ships with every write method gated by default", () => {
    renderSafety();
    for (const label of ["Ask before POST requests", "Ask before PUT / PATCH requests", "Ask before DELETE requests"]) {
      expect(screen.getByLabelText(label).getAttribute("aria-checked"), label).toBe("true");
    }
  });

  it("writes each method's policy back under its own key", () => {
    const { onUpdate } = renderSafety();
    fireEvent.click(screen.getByLabelText("Ask before DELETE requests"));
    expect(onUpdate).toHaveBeenCalledWith({ httpToolApprovalDelete: false });
  });

  it("turns a policy back on independently of the others", () => {
    const { onUpdate } = renderSafety({ httpToolApprovalPost: false });
    expect(screen.getByLabelText("Ask before POST requests").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByLabelText("Ask before POST requests"));
    expect(onUpdate).toHaveBeenCalledWith({ httpToolApprovalPost: true });
  });

  it("keeps the two privacy defaults off", () => {
    // The default is the security control for both — an install that has never heard of them
    // must not be read as consent.
    renderSafety();
    expect(screen.getByLabelText("Toggle location access").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText("Toggle automatic remote image loading").getAttribute("aria-checked")).toBe("false");
  });

  it("no longer leaves them in General", () => {
    renderSafety();
    fireEvent.click(screen.getByRole("tab", { name: /^General$/i }));
    expect(screen.queryByLabelText("Toggle location access")).toBeNull();
    expect(screen.queryByLabelText("Ask before DELETE requests")).toBeNull();
  });
});

describe("the orchestrator's enabled toggle", () => {
  function renderAgentsTab() {
    const onUpdate = vi.fn();
    render(
      <SettingsPanel
        open
        onClose={vi.fn()}
        settings={mergeWithDefaults({})}
        savedVersion={0}
        sessionElapsedMs={0}
        onUpdate={onUpdate}
        onReset={vi.fn()}
        agents={[]}
        onUpdateAgent={vi.fn()}
        onCreateAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
        onExportAgent={vi.fn()}
        onExportAllAgents={vi.fn()}
        onImportAgents={vi.fn()}
        onConfigAck={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /^Agents$/i }));
    const toggle = [...document.querySelectorAll('[role="switch"]')].find((t) =>
      /Toggle Orbit/i.test(t.getAttribute("aria-label") ?? "")
    );
    return { onUpdate, toggle };
  }

  it("is disabled, because the orchestrator is singular", () => {
    const { toggle } = renderAgentsTab();
    expect(toggle).toBeTruthy();
    expect(toggle).toBeDisabled();
  });

  it("writes nothing when clicked", () => {
    // It used to call onUpdate({ orchestratorEnabled }), which ipc/settings.ts drops via
    // LOCKED_KEYS and useSettings reconciles straight back — a live-looking write path for a
    // value that can never change.
    const { onUpdate, toggle } = renderAgentsTab();
    fireEvent.click(toggle!);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("running onboarding again", () => {
  function renderGeneral() {
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    render(
      <SettingsPanel
        open
        onClose={onClose}
        settings={mergeWithDefaults({ onboardingDone: true })}
        savedVersion={0}
        sessionElapsedMs={0}
        onUpdate={onUpdate}
        onReset={vi.fn()}
        agents={[]}
        onUpdateAgent={vi.fn()}
        onCreateAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
        onExportAgent={vi.fn()}
        onExportAllAgents={vi.fn()}
        onImportAgents={vi.fn()}
        onConfigAck={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /^General$/i }));
    const button = [...document.querySelectorAll("button")].find((b) => /^Start$/i.test(b.textContent?.trim() ?? ""));
    return { onUpdate, onClose, button };
  }

  it("offers a way back into onboarding", () => {
    // The tour has had a replay path since it shipped; onboarding's only route was a Danger Zone
    // reset, which also destroys chat history, agents, memory and the knowledge base.
    expect(renderGeneral().button).toBeTruthy();
  });

  it("clears the flag and gets out of the way", () => {
    const { onUpdate, onClose, button } = renderGeneral();
    fireEvent.click(button!);
    expect(onUpdate).toHaveBeenCalledWith({ onboardingDone: false });
    expect(onClose).toHaveBeenCalled();
  });

  it("clears nothing else", () => {
    // AgentsApp shows onboarding whenever onboardingDone is false; the stored answers stay put
    // and become the starting point.
    const { onUpdate, button } = renderGeneral();
    fireEvent.click(button!);
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ onboardingDone: false });
  });
});

describe("AI Models section", () => {
  function renderModels(settings = mergeWithDefaults({})) {
    render(
      <SettingsPanel
        open
        onClose={vi.fn()}
        settings={settings}
        savedVersion={0}
        sessionElapsedMs={0}
        onUpdate={vi.fn()}
        onReset={vi.fn()}
        agents={[]}
        onUpdateAgent={vi.fn()}
        onCreateAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
        onExportAgent={vi.fn()}
        onExportAllAgents={vi.fn()}
        onImportAgents={vi.fn()}
        onConfigAck={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /^Models$/i }));
  }

  // Credentials and model choice used to be interleaved per slot, across three accordions, with
  // the Chat provider's card a different shape from every other provider's.
  it("splits into exactly two groups — keys, then models", () => {
    renderModels();
    expect(screen.getByText("API keys")).toBeInTheDocument();
    expect(screen.getByText("Default models")).toBeInTheDocument();
    expect(screen.queryByText("Other providers")).not.toBeInTheDocument();
  });

  it("lists every provider under API keys, not just the ones that aren't Chat", () => {
    renderModels();
    // By field label rather than by provider name: the names also appear in the Chat provider
    // dropdown, and a bare getByText would match either one.
    for (const label of ["OpenRouter", "OpenAI", "Claude", "Local AI"]) {
      expect(screen.getByLabelText(`${label} API key`)).toBeInTheDocument();
      expect(screen.getByLabelText(`${label} API URL`)).toBeInTheDocument();
    }
    // Voice keeps its own credentials — it is a slot, not a registry provider.
    expect(screen.getByLabelText("Voice API URL")).toBeInTheDocument();
  });

  it("marks which provider the Chat slot is on", () => {
    renderModels();
    // Defaults infer OpenAI from an empty chatApiUrl, the same rule the migration used.
    expect(screen.getByText(/Chat provider ·/)).toBeInTheDocument();
  });

  it("puts every model field in the models group, and no key fields there", () => {
    renderModels();
    for (const label of ["Chat model", "Transcription model", "Speech (TTS) model"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // The old "Model ID" label lived in the Chat credentials card.
    expect(screen.queryByLabelText("Model ID")).not.toBeInTheDocument();
  });
});

describe("connector-connect acknowledgement", () => {
  /** Stubs every bridge call the panel makes on mount, plus connectors.list/onUpdate so a
   * disconnected→connected transition can be driven by hand via the captured onUpdate callback. */
  function installBridge(connectorStatus: "connected" | "disconnected") {
    let onUpdateCallback: (() => void) | null = null;
    const api = {
      agent: { orchestratorPrompt: vi.fn().mockResolvedValue("") },
      userInfo: { list: vi.fn().mockResolvedValue([]) },
      providers: { list: vi.fn().mockResolvedValue({ configured: [] }) },
      mcp: { list: vi.fn().mockResolvedValue([]) },
      httpTools: { listCollections: vi.fn().mockResolvedValue([]), listTools: vi.fn().mockResolvedValue([]) },
      connectors: {
        list: vi.fn().mockResolvedValue([
          {
            id: "gmail",
            name: "Gmail",
            description: "",
            icon: "ti-mail",
            status: connectorStatus,
            accountLabel: null,
            settingsFields: [],
            settingsConfigured: true,
            credentialsOnly: false,
            settingsSourceId: null,
          },
        ]),
        onUpdate: vi.fn((cb: () => void) => {
          onUpdateCallback = cb;
          return () => {};
        }),
      },
    };
    (globalThis as unknown as { window: { agentsAPI: unknown } }).window.agentsAPI = api;
    return { api, triggerUpdate: () => onUpdateCallback?.() };
  }

  afterEach(() => {
    delete (window as unknown as { agentsAPI?: unknown }).agentsAPI;
  });

  it("fires onConfigAck once with the connected agents when a connector transitions to connected", async () => {
    const { api, triggerUpdate } = installBridge("disconnected");
    const onConfigAck = vi.fn();
    const agents: AgentRow[] = [
      {
        id: "a1",
        name: "Cipher",
        icon: "ti-robot",
        tagline: "",
        description: "",
        prompt: "",
        model: "",
        provider_id: "",
        tools: "[]",
        enabled: 1,
        system: 1,
        created_at: new Date().toISOString(),
        mcp_server_ids: "[]",
        connector_ids: '["gmail"]',
        http_tool_collection_ids: "[]",
      },
    ];
    render(
      <SettingsPanel
        open
        onClose={vi.fn()}
        settings={mergeWithDefaults({})}
        savedVersion={0}
        sessionElapsedMs={0}
        onUpdate={vi.fn()}
        onReset={vi.fn()}
        agents={agents}
        onUpdateAgent={vi.fn()}
        onCreateAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
        onExportAgent={vi.fn()}
        onExportAllAgents={vi.fn()}
        onImportAgents={vi.fn()}
        onConfigAck={onConfigAck}
      />
    );

    // Baseline load: the first pass over connectorCatalog just records "disconnected", firing
    // nothing.
    await waitFor(() => expect(api.connectors.list).toHaveBeenCalled());
    expect(onConfigAck).not.toHaveBeenCalled();

    api.connectors.list.mockResolvedValue([
      {
        id: "gmail",
        name: "Gmail",
        description: "",
        icon: "ti-mail",
        status: "connected",
        accountLabel: "me@example.com",
        settingsFields: [],
        settingsConfigured: true,
        credentialsOnly: false,
        settingsSourceId: null,
      },
    ]);
    triggerUpdate();

    await waitFor(() =>
      expect(onConfigAck).toHaveBeenCalledExactlyOnceWith({
        type: "connector",
        label: "Gmail",
        agentNames: ["Cipher"],
      })
    );
  });
});

describe("Saved pill", () => {
  function baseProps(savedVersion: number) {
    return {
      open: true as const,
      onClose: vi.fn(),
      settings: mergeWithDefaults({}),
      savedVersion,
      sessionElapsedMs: 0,
      onUpdate: vi.fn(),
      onReset: vi.fn(async () => {}),
      agents: [],
      onUpdateAgent: vi.fn(),
      onCreateAgent: vi.fn(),
      onDeleteAgent: vi.fn(),
      onExportAgent: vi.fn(),
      onExportAllAgents: vi.fn(),
      onImportAgents: vi.fn(),
      onConfigAck: vi.fn(),
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing on first mount even though savedVersion already has a value", () => {
    // useSettings starts savedVersion at 0 and only bumps it on a real save — but a panel
    // that mounted after some other save already happened would otherwise see a "changed"
    // value on its very first render and misread that as its own save.
    render(<SettingsPanel {...baseProps(3)} />);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("shows Saved when savedVersion bumps after mount, and hides it after 3s", () => {
    vi.useFakeTimers();
    const { rerender } = render(<SettingsPanel {...baseProps(0)} />);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    rerender(<SettingsPanel {...baseProps(1)} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByText("Saved")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});
