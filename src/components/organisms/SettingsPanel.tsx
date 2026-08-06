import { useEffect, useRef, useState } from "react";
import Modal from "@/components/atoms/Modal";
import Toggle from "@/components/atoms/Toggle";
import Combobox from "@/components/atoms/Combobox";
import TablerIcon from "@/components/atoms/TablerIcon";
import SettingsSidebar, { SettingsNavGroup } from "@/components/molecules/SettingsSidebar";
import AgentAccordion from "@/components/molecules/AgentAccordion";
import SettingsAccordion from "@/components/molecules/SettingsAccordion";
import AddAgentForm from "@/components/molecules/AddAgentForm";
import ApiKeyField from "@/components/molecules/ApiKeyField";
import TextField from "@/components/molecules/TextField";
import NumberField from "@/components/molecules/NumberField";
import FilesAppsTab from "@/components/organisms/FilesAppsTab";
import McpServersTab from "@/components/organisms/McpServersTab";
import ConnectorsTab from "@/components/organisms/ConnectorsTab";
import HttpToolsTab from "@/components/organisms/HttpToolsTab";
import AboutTab from "@/components/organisms/AboutTab";
import ErrorBoundary from "@/components/atoms/ErrorBoundary";
import { SETTING_BOUNDS, ToolApprovalDisplay, DEFAULT_ORCHESTRATOR_MODEL, AgentsSettings, SettingsView, VOICE_TTS_VOICE_OPTIONS, SOUND_FX_VARIANT_COUNT } from "@/lib/settings";
import { USER_CONTEXT_FIELDS } from "@/lib/userContext";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { useProviders } from "@/hooks/useProviders";
import { useMcpServers } from "@/hooks/useMcpServers";
import { useConnectors } from "@/hooks/useConnectors";
import { useHttpTools } from "@/hooks/useHttpTools";
import { useUserContext } from "@/hooks/useUserContext";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";
import { providerUrlWarning } from "@/lib/providerUrlWarning";
import { AI_PROVIDERS, findProvider, modelBelongsToProvider } from "@/lib/providers";
import { DEFAULT_SETTINGS_SECTION, sectionOnTransition } from "@/lib/settingsSection";
import { SoundFxEvent, sfxPreviewSrc } from "@/hooks/useSoundFX";
import type { ConfigAckEvent } from "@/lib/configAckMessage";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Section to show when the panel opens; defaults to "models" if omitted. */
  initialSection?: SettingsSection;
  settings: SettingsView;
  /** Bumped by useSettings once per confirmed save (this window's own edit landing, or an
   * external settings:update push — e.g. Cipher changing a setting mid-conversation). Drives
   * a transient "Saved" indicator in the header; the count itself has no other meaning. */
  savedVersion: number;
  /** Session age from AgentsApp's existing once-a-minute interval, forwarded to the About
   * section. Timed there rather than here so no component reads the clock during render. */
  sessionElapsedMs: number;
  onUpdate: (patch: Partial<AgentsSettings>) => void;
  /** Surfaced from useAgents. Agent create/update/delete/import failures used to reject into
   * nothing — this is the one place the user can see that the thing they clicked didn't work. */
  agentsError?: string | null;
  onReset: () => Promise<void>;
  agents: AgentRow[];
  onUpdateAgent: (
    id: string,
    patch: {
      name?: string;
      tagline?: string;
      description?: string;
      model?: string;
      providerId?: string;
      prompt?: string;
      enabled?: boolean;
      mcpServerIds?: string[];
      connectorIds?: string[];
      httpToolCollectionIds?: string[];
    }
  ) => Promise<void>;
  onCreateAgent: (input: {
    name: string;
    tagline?: string;
    description?: string;
    model?: string;
    prompt?: string;
  }) => Promise<unknown>;
  onDeleteAgent: (id: string) => Promise<void>;
  onExportAgent: (id: string) => Promise<{ canceled: boolean } | undefined>;
  onExportAllAgents: () => Promise<{ canceled: boolean } | undefined>;
  onImportAgents: () => Promise<AgentRow[]>;
  /** Queues one chat-ack event; the caller (AgentsApp) coalesces and flushes it. Required
   * rather than optional — a silently-dropped ack is exactly the class of bug Steps 1-3 of
   * this change fix elsewhere in the panel. */
  onConfigAck: (event: ConfigAckEvent) => void;
}

export type SettingsSection =
  | "models"
  | "agents"
  | "mcp"
  | "connectors"
  | "http"
  | "files"
  | "general"
  | "safety"
  | "sounds"
  | "danger"
  | "about";

const NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: "AI",
    items: [
      { id: "models", label: "Models", icon: "ti-cpu" },
      { id: "agents", label: "Agents", icon: "ti-robot" },
      { id: "mcp", label: "MCP Servers", icon: "ti-plug" },
      { id: "connectors", label: "Connectors", icon: "ti-plug-connected" },
      { id: "http", label: "HTTP Tools", icon: "ti-api" },
    ],
  },
  {
    label: "App",
    items: [
      { id: "general", label: "General", icon: "ti-adjustments" },
      { id: "safety", label: "Privacy & Safety", icon: "ti-shield-lock" },
      { id: "sounds", label: "App Sounds", icon: "ti-volume" },
      { id: "files", label: "Knowledge", icon: "ti-books" },
      { id: "about", label: "About", icon: "ti-info-circle" },
    ],
  },
  {
    label: "Advanced",
    items: [{ id: "danger", label: "Danger Zone", icon: "ti-alert-triangle", danger: true }],
  },
];

const SECTION_META: Record<SettingsSection, { icon: string; title: string; subtitle: string }> = {
  models: { icon: "ti-cpu", title: "AI Models", subtitle: "Providers powering chat, tools, and voice" },
  agents: { icon: "ti-robot", title: "AI Agents", subtitle: "The orchestrator and every agent it can hand off to" },
  mcp: { icon: "ti-plug", title: "MCP Servers", subtitle: "External tool servers agents can be attached to" },
  connectors: { icon: "ti-plug-connected", title: "Connectors", subtitle: "Third-party services agents can use as tools" },
  http: { icon: "ti-api", title: "HTTP Tools", subtitle: "Your own API endpoints, callable as agent tools" },
  // Section id stays "files" deliberately: it is referenced by the hardcoded SETTINGS_SECTIONS
  // list in tourSteps.test.ts and by any tour step's settingsSection, so only the label changes.
  files: { icon: "ti-books", title: "Knowledge", subtitle: "Folders and documents agents can read" },
  general: { icon: "ti-adjustments", title: "General", subtitle: "Voice, sound, and input preferences" },
  // Gathered from three different screens. What this app will do without asking was previously
  // split between the HTTP Tools tab and General, so nobody auditing it had one place to look.
  safety: {
    icon: "ti-shield-lock",
    title: "Privacy & Safety",
    subtitle: "What Orbit does without asking, and what it can see",
  },
  sounds: { icon: "ti-volume", title: "App Sounds", subtitle: "Pick a variation for each sound effect" },
  danger: { icon: "ti-alert-triangle", title: "Danger Zone", subtitle: "Irreversible actions" },
  about: { icon: "ti-info-circle", title: "About", subtitle: "Version, storage, and licenses" },
};

interface SoundEventConfig {
  event: SoundFxEvent;
  settingKey: keyof AgentsSettings & (
    | "soundVariantSend"
    | "soundVariantReceive"
    | "soundVariantHandoff"
    | "soundVariantComplete"
    | "soundVariantStartup"
    | "soundVariantAgentCreated"
    | "soundVariantAgentDeleted"
    | "soundVariantConsult"
  );
  label: string;
  hint?: string;
}

interface SoundEventGroup {
  label: string;
  events: SoundEventConfig[];
}

const SOUND_EVENT_GROUPS: SoundEventGroup[] = [
  {
    label: "Chat",
    events: [
      { event: "send", settingKey: "soundVariantSend", label: "Message sent" },
      { event: "receive", settingKey: "soundVariantReceive", label: "Message received" },
    ],
  },
  {
    label: "Agents",
    events: [
      { event: "handoff", settingKey: "soundVariantHandoff", label: "Agent handoff" },
      { event: "consult", settingKey: "soundVariantConsult", label: "Consulting a specialist" },
      { event: "complete", settingKey: "soundVariantComplete", label: "Task complete" },
      { event: "agentCreated", settingKey: "soundVariantAgentCreated", label: "Agent created" },
      { event: "agentDeleted", settingKey: "soundVariantAgentDeleted", label: "Agent deleted" },
    ],
  },
  {
    label: "App",
    events: [
      {
        event: "startup",
        settingKey: "soundVariantStartup",
        label: "App startup",
        hint: "Variant 1 is the original recorded startup clip",
      },
    ],
  },
];

const SOUND_VARIANT_OPTIONS = Array.from({ length: SOUND_FX_VARIANT_COUNT }, (_, i) => ({
  value: String(i + 1),
  label: `Variant ${i + 1}`,
}));

const APPROVAL_METHODS: {
  key: "httpToolApprovalPost" | "httpToolApprovalPutPatch" | "httpToolApprovalDelete";
  label: string;
  hint: string;
}[] = [
  { key: "httpToolApprovalPost", label: "POST", hint: "Creating something" },
  { key: "httpToolApprovalPutPatch", label: "PUT / PATCH", hint: "Updating something" },
  { key: "httpToolApprovalDelete", label: "DELETE", hint: "Removing something" },
];

const APPROVAL_DISPLAY_OPTIONS = [
  { value: "modal", label: "Pop-up dialog" },
  { value: "inline", label: "Card in the chat" },
];

const RESET_CONFIRM_WORD = "RESET";

/** Reads one of the agent row's JSON id-array columns (mcp_server_ids, connector_ids,
 * http_tool_collection_ids). Never throws — a malformed column degrades to "nothing
 * attached" rather than taking the Settings panel down, mirroring the equivalent parsers in
 * electron/main/ai/agents.ts. */
function parseIdList(raw: string): string[] {
  try {
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export default function SettingsPanel({
  open,
  onClose,
  initialSection,
  settings,
  savedVersion,
  sessionElapsedMs,
  onUpdate,
  agentsError,
  onReset,
  agents,
  onUpdateAgent,
  onCreateAgent,
  onDeleteAgent,
  onExportAgent,
  onExportAllAgents,
  onImportAgents,
  onConfigAck,
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(DEFAULT_SETTINGS_SECTION);
  // Adjust activeSection during render (not in an effect) when the panel transitions
  // from closed to open with a requested initialSection — see React docs on
  // "Adjusting state when a prop changes" for why this belongs in render, not useEffect.
  //
  // initialSection is tracked as well as `open` because the tour walks two consecutive
  // steps that both request a section (Settings → models, then Connectors) without
  // closing in between. Keying only off the closed→open edge left the second step
  // describing Connectors while the panel still showed AI Models.
  const userContext = useUserContext(open);
  const [wasOpen, setWasOpen] = useState(open);
  const [appliedSection, setAppliedSection] = useState(initialSection);
  if (open !== wasOpen || initialSection !== appliedSection) {
    const next = sectionOnTransition({
      opening: open && !wasOpen,
      open,
      requested: initialSection,
    });
    setWasOpen(open);
    setAppliedSection(initialSection);
    if (next) setActiveSection(next);
  }
  // "Saved" header pill — shown for 3s after each confirmed save. mountSavedVersion is
  // captured once (SettingsPanel stays mounted for the app's whole lifetime, hidden by
  // Modal's own open flag) so the very first render — savedVersion already having a value —
  // doesn't itself read as a save. The "turn on" half is a render-time state adjustment
  // (same pattern as wasOpen/appliedSection above) rather than an effect reacting to
  // savedVersion, since an effect that both reads a changed prop and calls setState
  // synchronously is exactly the cascading-render pattern React's own effect guidance warns
  // against; only the timeout — a real subscription to an external clock — belongs in an effect.
  const [mountSavedVersion] = useState(savedVersion);
  const [seenSavedVersion, setSeenSavedVersion] = useState(savedVersion);
  const [showSaved, setShowSaved] = useState(false);
  if (savedVersion !== seenSavedVersion) {
    setSeenSavedVersion(savedVersion);
    if (savedVersion !== mountSavedVersion) setShowSaved(true);
  }
  // Doesn't reset the 3s clock if a second save lands while the pill is still showing (the
  // effect's dependency stays `true` -> `true`) — acceptable for a low-frequency indicator
  // like this; the pill just keeps its original timer rather than extending it.
  useEffect(() => {
    if (!showSaved) return;
    const timer = setTimeout(() => setShowSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [showSaved]);

  const [testingChat, setTestingChat] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [chatTestResult, setChatTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [voiceTestResult, setVoiceTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [orchestratorPrompt, setOrchestratorPrompt] = useState("");
  const [orchestratorPromptLoading, setOrchestratorPromptLoading] = useState(true);
  const [addingAgent, setAddingAgent] = useState(false);
  const [agentActionError, setAgentActionError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  // The Chat slot's URL and key live in the providers table once the slot has been moved there,
  // so binding these fields to settings.chatApiUrl/chatApiKeySet showed a blank URL and "no key
  // saved" while the app ran fine on credentials the panel could not see.
  const providers = useProviders(open);
  const chatSlotView = providers.chatSlot(
    settings.chatProviderId,
    settings.chatApiUrl,
    settings.chatApiKeySet
  );
  const chatProvider = findProvider(chatSlotView.providerId);

  /**
   * Why an agent's pinned provider will not be used, or undefined when it is fine.
   *
   * modelForAgent falls back to the Chat slot and logs rather than throwing — one misconfigured
   * agent must not take down a run it isn't part of. The cost is that the fallback is invisible,
   * so this is the surface that makes it visible where the user set it.
   */
  const providerWarningFor = (providerId: string, model: string): string | undefined => {
    if (providerId === "") return undefined;
    const provider = findProvider(providerId);
    if (!provider) return `Unknown provider — this agent falls back to the Chat provider.`;
    const row = providers.configured.find((entry) => entry.id === providerId);
    if (!row) return `${provider.label} isn't set up yet — this agent falls back to the Chat provider.`;
    if (provider.keyRequired && !row.keySet) {
      return `${provider.label} has no API key — this agent falls back to the Chat provider.`;
    }
    if (!row.apiUrl && !provider.baseUrl) {
      return `${provider.label} has no API URL — this agent falls back to the Chat provider.`;
    }
    // Credentials are fine, so the run reaches the provider — and is refused by it. Switching to
    // a provider with no default model leaves the previous one's id in place (only the user knows
    // which model they pulled onto a local server), and until now nothing said so.
    if (!modelBelongsToProvider(providerId, model)) {
      return `"${model}" doesn't look like a ${provider.label} model — this agent will likely fail on its first run.`;
    }
    return undefined;
  };

  /** Every Chat edit goes through the one operation, so credentials, the slot and the models of
   * inheriting agents can never drift apart — see electron/main/ai/selectProvider.ts. */
  const applyChat = async (selection: { providerId: string; apiUrl?: string; apiKey?: string; model?: string }) => {
    setChatError(null);
    try {
      await providers.selectChat(selection);
    } catch (err) {
      // Surfaced rather than swallowed: selectChatProvider refuses a blank URL, a bad model id and
      // a missing key with messages written for a person to read.
      setChatError(formatHumanizedError(humanizeError(err)));
    }
  };

  const runTestChat = async () => {
    if (!hasAgentsAPI()) return;
    setTestingChat(true);
    setChatTestResult(null);
    try {
      setChatTestResult(await window.agentsAPI.settings.testChat());
    } catch (err) {
      setChatTestResult({ ok: false, detail: formatHumanizedError(humanizeError(err)) });
    } finally {
      setTestingChat(false);
    }
  };

  const runTestVoice = async () => {
    if (!hasAgentsAPI()) return;
    setTestingVoice(true);
    setVoiceTestResult(null);
    try {
      setVoiceTestResult(await window.agentsAPI.settings.testVoice());
    } catch (err) {
      setVoiceTestResult({ ok: false, detail: formatHumanizedError(humanizeError(err)) });
    } finally {
      setTestingVoice(false);
    }
  };

  // Export/import/delete all reject on failure (system-agent guard, bad JSON, disk
  // errors) — without this, those rejections would be unhandled and silently invisible
  // to the user, unlike every other renderer error surface (see AddAgentForm.tsx).
  const runAgentAction = async (action: () => Promise<unknown>) => {
    setAgentActionError(null);
    try {
      await action();
    } catch (err) {
      setAgentActionError(formatHumanizedError(humanizeError(err)));
    }
  };
  const mcp = useMcpServers();
  const mcpServers = mcp.servers;
  const connectors = useConnectors();
  const connectorCatalog = connectors.connectors;
  const httpTools = useHttpTools();
  const httpToolCollections = httpTools.collections;

  // The three data hooks mount once with the panel and never unmount (see `open`'s
  // backdrop-only gating below), so a stale error from a session before this one stays
  // on screen indefinitely unless the next open clears it.
  useEffect(() => {
    if (!open) return;
    mcp.clearError();
    connectors.clearError();
    httpTools.clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearError identities are stable useCallbacks; only the open edge should retrigger this
  }, [open]);

  // Baseline-then-diff over each connector's own status: the first run just records what's
  // already connected, so connectors set up before this session don't read as newly connected.
  // Reconnecting after a disconnect acks again — "usable again" is worth saying, not a
  // once-per-app-lifetime event. A credentialsOnly parent row has no Connect button and its
  // status never transitions, so it never fires.
  const knownConnectorStatusRef = useRef<Map<string, ConnectorCatalogEntry["status"]> | null>(null);
  useEffect(() => {
    const known = knownConnectorStatusRef.current;
    knownConnectorStatusRef.current = new Map(connectorCatalog.map((c) => [c.id, c.status]));
    if (known === null) return;
    for (const connector of connectorCatalog) {
      if (known.get(connector.id) === "connected" || connector.status !== "connected") continue;
      const agentNames = agents
        .filter((agent) => parseIdList(agent.connector_ids).includes(connector.id))
        .map((agent) => agent.name);
      if (settings.orchestratorConnectorIds.includes(connector.id)) agentNames.unshift(settings.agentName);
      onConfigAck({ type: "connector", label: connector.name, agentNames });
    }
  }, [connectorCatalog, agents, settings.orchestratorConnectorIds, settings.agentName, onConfigAck]);

  useEffect(() => {
    if (!open || !hasAgentsAPI()) return;
    let cancelled = false;
    window.agentsAPI.agent.orchestratorPrompt().then((text) => {
      if (!cancelled) {
        setOrchestratorPrompt(text);
        setOrchestratorPromptLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** Clears the override and pulls the built-in template back into the textarea. The refetch
   * matters: the panel loads the prompt once on open, so without it the box would keep showing
   * the customised text the user just discarded. */
  const resetOrchestratorPrompt = async () => {
    onUpdate({ orchestratorPromptOverride: "" });
    if (!hasAgentsAPI()) return;
    setOrchestratorPromptLoading(true);
    try {
      setOrchestratorPrompt(await window.agentsAPI.agent.orchestratorPrompt());
    } finally {
      setOrchestratorPromptLoading(false);
    }
  };

  const previewSound = (event: SoundFxEvent, variant: number) => {
    new Audio(sfxPreviewSrc(event, variant)).play().catch(() => {});
  };

  const handleReset = async () => {
    if (resetConfirmText !== RESET_CONFIRM_WORD || resetting) return;
    setResetting(true);
    setResetError(null);
    try {
      await onReset();
      // No reset of `resetting` on success: onReset reloads the window, so the button staying
      // disabled for those last moments is correct — re-enabling it would invite a second click
      // against a database mid-rebuild.
    } catch (err) {
      // settings:reset drops every app table inside a transaction and re-runs migrations. That
      // can genuinely fail — most plausibly SQLITE_BUSY, since the userData database is shared
      // across worktrees and a second running instance holds a write lock. Without this the
      // rejection was unhandled, the button sat on "Resetting…" disabled forever, and the user
      // was told nothing. Every other async action in this file already catches this way.
      setResetError(formatHumanizedError(humanizeError(err)));
      setResetting(false);
    }
  };

  const meta = SECTION_META[activeSection];

  return (
    <Modal open={open} onClose={onClose} className="modal-panel--settings" label="Settings">
      <div className="settings-window-body">
        <SettingsSidebar
          groups={NAV_GROUPS}
          activeSection={activeSection}
          onChange={(id) => setActiveSection(id as SettingsSection)}
        />

        <section className="settings-detail">
          <header className="detail-header">
            <div className="detail-title-group">
              <div className="detail-icon">
                <TablerIcon name={meta.icon} />
              </div>
              <div className="detail-title">
                <h1>{meta.title}</h1>
                <p>{meta.subtitle}</p>
              </div>
            </div>
            <div className="detail-header-actions">
              {showSaved && (
                <span className="settings-saved-pill" role="status">
                  <TablerIcon name="ti-check" />
                  Saved
                </span>
              )}
              <button className="window-close" aria-label="Close settings" onClick={onClose}>
                <TablerIcon name="ti-x" />
              </button>
            </div>
          </header>

          <div className="detail-body">
            {activeSection === "models" && (
              <div className="agent-accordion-list">
                <SettingsAccordion title="API keys" defaultOpen>
                  <p className="group-hint">
                    One key per provider. The Chat slot uses whichever provider is selected under
                    Default models, and an agent pinned to a provider in Settings → Agents uses that
                    provider's key.
                  </p>
                  <div className="group">
                    <div className="card">
                      {AI_PROVIDERS.map((provider) => {
                        // The Chat provider's credentials still go through selectChat rather than a
                        // plain save: the slot, its key and every inheriting agent's model are one
                        // change, and a half-applied one is what selectChatProvider exists to prevent.
                        const isChat = provider.id === chatSlotView.providerId;
                        const row = providers.configured.find((entry) => entry.id === provider.id);
                        const keySet = isChat ? chatSlotView.keySet : (row?.keySet ?? false);
                        const saveKey = (apiKey: string) =>
                          isChat
                            ? void applyChat({ providerId: provider.id, apiKey })
                            : void providers.save({ providerId: provider.id, apiKey });
                        return (
                          <div key={provider.id} className="row-field">
                            <span>
                              {provider.label}
                              <small>
                                {isChat ? "Chat provider · " : ""}
                                {keySet
                                  ? "Key saved"
                                  : provider.keyRequired
                                    ? "No API key yet"
                                    : "No key needed — set the URL below"}
                              </small>
                            </span>
                            <ApiKeyField
                              label={`${provider.label} API key`}
                              isSet={keySet}
                              onSave={saveKey}
                              // Removal always goes through the plain credential write, even for
                              // the Chat provider. selectChatProvider refuses a blank key on a
                              // provider that requires one — a sensible guard while *choosing* a
                              // provider, but it made Remove impossible on whichever provider was
                              // currently selected, answering the click with "OpenAI needs an API
                              // key." A slot pointed at a provider with no key is just a fresh
                              // install, and resolveProviderId already says so at run time.
                              onClear={
                                keySet ? () => void providers.save({ providerId: provider.id, apiKey: "" }) : undefined
                              }
                            />
                            <TextField
                              label={`${provider.label} API URL`}
                              value={isChat ? chatSlotView.apiUrl : (row?.apiUrl ?? "")}
                              placeholder={provider.baseUrl || "http://localhost:11434/v1"}
                              warningFor={providerUrlWarning}
                              onCommit={(apiUrl) =>
                                isChat
                                  ? void applyChat({ providerId: provider.id, apiUrl })
                                  : void providers.save({ providerId: provider.id, apiUrl })
                              }
                            />
                            {/* Only the Chat provider gets a Test button: the check resolves a
                                credential *slot*, so there is nothing to test a provider that
                                nothing is currently pointed at against. */}
                            {isChat && (
                              <div className="row-field-action">
                                <button
                                  type="button"
                                  className="settings-action-btn-sm settings-action-btn-ghost"
                                  onClick={() => runTestChat()}
                                  disabled={testingChat}
                                >
                                  <TablerIcon name="ti-plug-connected" />
                                  <span>{testingChat ? "Testing…" : "Test"}</span>
                                </button>
                                {chatTestResult && (
                                  <span
                                    className={`settings-test-status ${chatTestResult.ok ? "settings-success" : "settings-error"}`}
                                    title={chatTestResult.detail}
                                  >
                                    {chatTestResult.detail}
                                  </span>
                                )}
                              </div>
                            )}
                            {isChat && chatError && <p className="settings-error">{chatError}</p>}
                          </div>
                        );
                      })}
                      <div className="row-field">
                        <span>
                          Voice
                          <small>
                            {settings.voiceApiKeySet ? "Key saved · " : "No API key yet · "}
                            Its own key, so speech can run on a different account from Chat
                          </small>
                        </span>
                        <ApiKeyField
                          label="Voice API key"
                          isSet={settings.voiceApiKeySet}
                          onSave={(key) => onUpdate({ voiceApiKey: key })}
                        />
                        <TextField
                          label="Voice API URL"
                          value={settings.voiceApiUrl}
                          placeholder="https://api.openai.com/v1"
                          warningFor={providerUrlWarning}
                          onCommit={(voiceApiUrl) => onUpdate({ voiceApiUrl })}
                        />
                        <div className="row-field-action">
                          <button
                            type="button"
                            className="settings-action-btn-sm settings-action-btn-ghost"
                            onClick={() => runTestVoice()}
                            disabled={testingVoice}
                          >
                            <TablerIcon name="ti-plug-connected" />
                            <span>{testingVoice ? "Testing…" : "Test"}</span>
                          </button>
                          {voiceTestResult && (
                            <span
                              className={`settings-test-status ${voiceTestResult.ok ? "settings-success" : "settings-error"}`}
                              title={voiceTestResult.detail}
                            >
                              {voiceTestResult.detail}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </SettingsAccordion>

                <SettingsAccordion title="Default models" defaultOpen>
                  <p className="group-hint">
                    Which model each part of the app reaches for. An agent can name its own in
                    Settings → Agents; every agent that doesn't follows the chat model here.
                  </p>
                  <div className="group">
                    <div className="card">
                      <label className="row-field">
                        <span>
                          Chat provider
                          <small>Switching also moves every agent that follows this slot</small>
                        </span>
                        <Combobox
                          value={chatSlotView.providerId}
                          options={AI_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.label }))}
                          onChange={(providerId) => void applyChat({ providerId })}
                          ariaLabel="Chat provider"
                        />
                      </label>
                      <TextField
                        label="Chat model"
                        hint="Powers the orchestrator and every agent's chat and tool calls"
                        value={settings.orchestratorModel}
                        placeholder={chatProvider?.defaultChatModel || DEFAULT_ORCHESTRATOR_MODEL}
                        onCommit={(model) => void applyChat({ providerId: chatSlotView.providerId, model })}
                      />
                      {/* Also rendered here, not only beside the credentials. Both controls that
                          can produce a chatError — the provider dropdown above and the model field
                          — live in this card, and an explanation for a rejected pick that appears
                          in a different accordion reads as unrelated. */}
                      {chatError && <p className="settings-error">{chatError}</p>}
                      <TextField
                        label="Transcription model"
                        hint="Turns what you say into text"
                        value={settings.voiceTranscriptionModel}
                        placeholder="whisper-1"
                        onCommit={(voiceTranscriptionModel) => onUpdate({ voiceTranscriptionModel })}
                      />
                      <TextField
                        label="Speech (TTS) model"
                        hint="Reads replies out loud"
                        value={settings.voiceTtsModel}
                        placeholder="gpt-4o-mini-tts"
                        onCommit={(voiceTtsModel) => onUpdate({ voiceTtsModel })}
                      />
                      <label className="row-field">
                        <span>Speech (TTS) voice</span>
                        <Combobox
                          value={settings.voiceTtsVoice}
                          options={VOICE_TTS_VOICE_OPTIONS.map((voice) => ({ value: voice, label: voice }))}
                          onChange={(voice) => onUpdate({ voiceTtsVoice: voice })}
                          ariaLabel="Speech (TTS) voice"
                        />
                      </label>
                    </div>
                  </div>
                </SettingsAccordion>
              </div>
            )}

            {activeSection === "agents" && (
              <section className="settings-section">
                <div className="settings-section-header">
                  <div className="settings-section-header-title">
                    <h3>Agents</h3>
                    {!addingAgent && (
                      <button
                        type="button"
                        className="settings-action-btn-sm settings-action-btn-ghost"
                        onClick={() => setAddingAgent(true)}
                      >
                        <TablerIcon name="ti-plus" />
                        <span>New</span>
                      </button>
                    )}
                  </div>
                  <div className="settings-section-header-actions">
                    <button
                      type="button"
                      className="settings-action-btn-sm settings-action-btn-ghost"
                      onClick={() => runAgentAction(onExportAllAgents)}
                    >
                      <TablerIcon name="ti-download" />
                      <span>Export All</span>
                    </button>
                    <button
                      type="button"
                      className="settings-action-btn-sm settings-action-btn-ghost"
                      onClick={() => runAgentAction(onImportAgents)}
                    >
                      <TablerIcon name="ti-upload" />
                      <span>Import Agent</span>
                    </button>
                  </div>
                </div>
                {/* Every other data tab renders its hook's error this way (McpServersTab:365).
                    Agents had no error to render because useAgents never produced one. */}
                {agentsError && <p className="settings-error">{agentsError}</p>}
                <div className="agent-accordion-list">
                  <AgentAccordion
                    icon="ti-sparkles"
                    name={settings.agentName}
                    description={settings.agentDescription}
                    prompt={orchestratorPrompt}
                    promptLoading={orchestratorPromptLoading}
                    enabled={settings.orchestratorEnabled}
                    // No onChangeEnabled: the orchestrator is singular and cannot be turned off.
                    // ipc/settings.ts drops orchestratorEnabled via LOCKED_KEYS, so the handler
                    // that used to be here was silently discarded and reconciled straight back —
                    // a live-looking write path for a value that can never change.
                    enabledLocked
                    onChangeName={(name) => onUpdate({ agentName: name })}
                    onChangeDescription={(description) => onUpdate({ agentDescription: description })}
                    onChangePrompt={(prompt) => {
                      setOrchestratorPrompt(prompt);
                      onUpdate({ orchestratorPromptOverride: prompt });
                    }}
                    onResetPrompt={
                      settings.orchestratorPromptOverride.trim().length > 0
                        ? () => void resetOrchestratorPrompt()
                        : undefined
                    }
                    availableMcpServers={mcpServers}
                    mcpServerIds={settings.orchestratorMcpServerIds}
                    onChangeMcpServerIds={(mcpServerIds) => onUpdate({ orchestratorMcpServerIds: mcpServerIds })}
                    availableConnectors={connectorCatalog}
                    connectorIds={settings.orchestratorConnectorIds}
                    onChangeConnectorIds={(connectorIds) => onUpdate({ orchestratorConnectorIds: connectorIds })}
                    availableHttpToolCollections={httpToolCollections}
                    httpToolCollectionIds={settings.orchestratorHttpToolCollectionIds}
                    onChangeHttpToolCollectionIds={(ids) => onUpdate({ orchestratorHttpToolCollectionIds: ids })}
                  />
                  {agents.map((agent) => (
                    <AgentAccordion
                      key={agent.id}
                      icon={agent.icon}
                      name={agent.name}
                      tagline={agent.tagline}
                      description={agent.description}
                      model={agent.model}
                      prompt={agent.prompt}
                      enabled={!!agent.enabled}
                      enabledLocked={!!agent.system}
                      onChangeName={(name) => onUpdateAgent(agent.id, { name })}
                      onChangeTagline={(tagline) => onUpdateAgent(agent.id, { tagline })}
                      onChangeDescription={(description) => onUpdateAgent(agent.id, { description })}
                      onChangeModel={(model) => onUpdateAgent(agent.id, { model })}
                      providerId={agent.provider_id}
                      onChangeProviderId={(providerId) => {
                        // The model has to move with the provider, for the same reason it does on
                        // the Chat slot: pinning an agent to Claude while it still names
                        // gpt-4.1-mini just 404s. Only when the new provider actually has a
                        // default — a local server has none, because only the user knows which
                        // model they have pulled, so its model is left alone for them to set.
                        const nextModel = findProvider(providerId)?.defaultChatModel;
                        void onUpdateAgent(agent.id, {
                          providerId,
                          ...(nextModel ? { model: nextModel } : {}),
                        });
                      }}
                      providerWarning={providerWarningFor(agent.provider_id, agent.model)}
                      // What a blank field would resolve to, so "leave it empty" is a stated
                      // option rather than something the user has to discover. Mirrors
                      // resolveAgentModel in electron/main/ai/agents.ts — including the empty
                      // case, where that function refuses rather than filling one in, and the
                      // accordion has to say "required" instead of naming a fallback.
                      modelPlaceholder={
                        agent.provider_id === ""
                          ? settings.orchestratorModel
                          : (findProvider(agent.provider_id)?.defaultChatModel ?? settings.orchestratorModel)
                      }
                      onChangePrompt={(prompt) => onUpdateAgent(agent.id, { prompt })}
                      onChangeEnabled={(enabled) => onUpdateAgent(agent.id, { enabled })}
                      availableMcpServers={mcpServers}
                      mcpServerIds={parseIdList(agent.mcp_server_ids)}
                      onChangeMcpServerIds={(mcpServerIds) => onUpdateAgent(agent.id, { mcpServerIds })}
                      availableConnectors={connectorCatalog}
                      connectorIds={parseIdList(agent.connector_ids)}
                      onChangeConnectorIds={(connectorIds) => onUpdateAgent(agent.id, { connectorIds })}
                      availableHttpToolCollections={httpToolCollections}
                      httpToolCollectionIds={parseIdList(agent.http_tool_collection_ids)}
                      onChangeHttpToolCollectionIds={(httpToolCollectionIds) =>
                        onUpdateAgent(agent.id, { httpToolCollectionIds })
                      }
                      onExport={agent.system ? undefined : () => runAgentAction(() => onExportAgent(agent.id))}
                      onDelete={agent.system ? undefined : () => runAgentAction(() => onDeleteAgent(agent.id))}
                    />
                  ))}
                  {addingAgent && (
                    <AddAgentForm
                      defaultModel={settings.orchestratorModel}
                      onCreate={onCreateAgent}
                      onCancel={() => setAddingAgent(false)}
                    />
                  )}
                </div>
                {agentActionError && <p className="settings-error">{agentActionError}</p>}
              </section>
            )}

            {activeSection === "mcp" && (
              <ErrorBoundary fallbackTitle="MCP servers failed to load">
                <McpServersTab mcp={mcp} />
              </ErrorBoundary>
            )}

            {activeSection === "connectors" && (
              <ErrorBoundary fallbackTitle="Connectors failed to load">
                <ConnectorsTab connectors={connectors} />
              </ErrorBoundary>
            )}

            {activeSection === "http" && (
              <ErrorBoundary fallbackTitle="HTTP tools failed to load">
                <HttpToolsTab httpTools={httpTools} settings={settings} />
              </ErrorBoundary>
            )}

            {activeSection === "files" && (
              <ErrorBoundary fallbackTitle="Files failed to load">
                <FilesAppsTab />
              </ErrorBoundary>
            )}

            {activeSection === "about" && (
              <ErrorBoundary fallbackTitle="About failed to load">
                <AboutTab sessionElapsedMs={sessionElapsedMs} />
              </ErrorBoundary>
            )}

            {activeSection === "general" && (
              <div className="group">
                {/* The answers onboarding collects, kept editable afterwards. Your name is a
                    plain setting; the rest live in the cross-agent user-fact store and reach
                    every agent's prompt, so they are saved through useUserContext. */}
                <div className="card" id="settings-about-you">
                  <TextField
                    label="What should I call you?"
                    value={settings.userName}
                    placeholder="Your name"
                    onCommit={(userName) => onUpdate({ userName })}
                  />
                  {USER_CONTEXT_FIELDS.map((field) => (
                    <label className="row-field" key={field.key}>
                      <span>{field.label}</span>
                      {field.options ? (
                        <Combobox
                          value={userContext.values[field.key]}
                          options={[
                            { value: "", label: "Not set" },
                            ...field.options.map((option) => ({ value: option, label: option })),
                          ]}
                          onChange={(value) => void userContext.setValue(field.key, value)}
                          ariaLabel={field.label}
                        />
                      ) : (
                        <input
                          type="text"
                          value={userContext.values[field.key]}
                          onChange={(e) => void userContext.setValue(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          autoComplete="off"
                        />
                      )}
                    </label>
                  ))}
                  <div className="row">
                    <span className="row-label">
                      Run onboarding again
                      <small>Walks through the setup questions. Nothing is cleared — your answers are the starting point</small>
                    </span>
                    <button
                      type="button"
                      className="settings-action-btn-sm settings-action-btn-ghost"
                      onClick={() => {
                        // The tour has had a replay path since it shipped; onboarding never did,
                        // so the only way back through it was a Danger Zone reset — which also
                        // destroys chat history, agents, memory and the knowledge base.
                        // Clearing the flag is all it takes: AgentsApp shows onboarding whenever
                        // onboardingDone is false. Closing the panel gets it out of the way.
                        onUpdate({ onboardingDone: false });
                        onClose();
                      }}
                    >
                      <TablerIcon name="ti-refresh" />
                      <span>Start</span>
                    </button>
                  </div>
                </div>
                <div className="card">
                  <div className="row">
                    <span className="row-label">Voice input</span>
                    <Toggle
                      checked={settings.voiceInputEnabled}
                      onChange={(checked) => onUpdate({ voiceInputEnabled: checked })}
                      label="Toggle voice input"
                    />
                  </div>
                  <div className="row">
                    <span className="row-label">
                      Voice output<small>Speak replies to voice messages</small>
                    </span>
                    <Toggle
                      checked={settings.voiceOutputEnabled}
                      onChange={(checked) => onUpdate({ voiceOutputEnabled: checked })}
                      label="Toggle voice output"
                    />
                  </div>
                  <div className="row">
                    <span className="row-label">
                      Sound effects<small>Subtle audio cues</small>
                    </span>
                    <Toggle
                      checked={settings.soundFxEnabled}
                      onChange={(checked) => onUpdate({ soundFxEnabled: checked })}
                      label="Toggle sound effects"
                    />
                  </div>
                  <div className="row">
                    <span className="row-label">Background music</span>
                    <Toggle
                      checked={settings.bgMusicEnabled}
                      onChange={(checked) => onUpdate({ bgMusicEnabled: checked })}
                      label="Toggle background music"
                    />
                  </div>
                  {settings.bgMusicEnabled && (
                    <NumberField
                      label="Background music volume"
                      value={settings.bgMusicVolume}
                      bound={SETTING_BOUNDS.bgMusicVolume}
                      onCommit={(bgMusicVolume) => onUpdate({ bgMusicVolume })}
                    />
                  )}
                  <div className="row">
                    <span className="row-label">Type anywhere to focus chat</span>
                    <Toggle
                      checked={settings.typeAnywhereEnabled}
                      onChange={(checked) => onUpdate({ typeAnywhereEnabled: checked })}
                      label="Toggle type-anywhere focus"
                    />
                  </div>
                </div>

                <div className="card">
                  <NumberField
                    label="Agent run timeout (seconds)"
                    value={settings.agentRunTimeoutSeconds}
                    bound={SETTING_BOUNDS.agentRunTimeoutSeconds}
                    onCommit={(agentRunTimeoutSeconds) => onUpdate({ agentRunTimeoutSeconds })}
                  />
                  <NumberField
                    label="Chat history sent to the orchestrator (messages)"
                    hint="A bigger window keeps more of a long conversation in view, and costs more per run"
                    value={settings.chatHistoryMessageLimit}
                    bound={SETTING_BOUNDS.chatHistoryMessageLimit}
                    onCommit={(chatHistoryMessageLimit) => onUpdate({ chatHistoryMessageLimit })}
                  />
                  <NumberField
                    label="Conversations shown in chat"
                    hint="Older conversations stay one click away in Chat History — this only controls what's visible on screen"
                    value={settings.chatVisibleConversations}
                    bound={SETTING_BOUNDS.chatVisibleConversations}
                    onCommit={(chatVisibleConversations) => onUpdate({ chatVisibleConversations })}
                  />
                  <NumberField
                    label="System Status refresh interval (ms)"
                    value={settings.systemStatsPollIntervalMs}
                    bound={SETTING_BOUNDS.systemStatsPollIntervalMs}
                    onCommit={(systemStatsPollIntervalMs) => onUpdate({ systemStatsPollIntervalMs })}
                  />
                </div>
              </div>
            )}


            {activeSection === "safety" && (
              <div className="group">
                <div className="group-label">
                  <span>Approval</span>
                </div>
                {/* One global posture rather than a switch on every endpoint: "ask before
                    anything is deleted" is a decision about how you want to work, not a property
                    of one URL. */}
                <p className="group-hint">
                  Pause and ask before an HTTP tool sends a request. Reads (GET, HEAD) never ask.
                </p>
                <div className="card">
                  {APPROVAL_METHODS.map(({ key, label, hint }) => (
                    <div className="row" key={key}>
                      <span className="row-label">
                        {label}
                        <small>{hint}</small>
                      </span>
                      <Toggle
                        checked={settings[key]}
                        onChange={(checked) => onUpdate({ [key]: checked })}
                        label={`Ask before ${label} requests`}
                      />
                    </div>
                  ))}
                  <div className="row">
                    <span className="row-label">
                      Ask me with
                      <small>A pop-up is harder to miss; a card keeps the orbit view clear</small>
                    </span>
                    <Combobox
                      value={settings.toolApprovalDisplay}
                      options={APPROVAL_DISPLAY_OPTIONS}
                      onChange={(value) => onUpdate({ toolApprovalDisplay: value as ToolApprovalDisplay })}
                      ariaLabel="How to ask for approval"
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeSection === "safety" && (
              <div className="group">
                <div className="group-label">
                  <span>What Orbit can see</span>
                </div>
                <div className="card">
                  <div className="row">
                    <span className="row-label">
                      Location access<small>Let agents look up where you are</small>
                    </span>
                    <Toggle
                      checked={settings.locationEnabled}
                      onChange={(checked) => onUpdate({ locationEnabled: checked })}
                      label="Toggle location access"
                    />
                  </div>
                  <div className="row">
                    <span className="row-label">
                      Load remote images automatically
                      <small>
                        Off is safer: a reply can be steered by a web page or email it read, and an
                        image that loads on sight sends a request before you have read it
                      </small>
                    </span>
                    <Toggle
                      checked={settings.remoteImagesAutoLoad}
                      onChange={(checked) => onUpdate({ remoteImagesAutoLoad: checked })}
                      label="Toggle automatic remote image loading"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeSection === "sounds" && (
              <>
                {SOUND_EVENT_GROUPS.map((group) => (
                  <div className="group" key={group.label}>
                    <div className="card">
                      {group.events.map(({ event, settingKey, label, hint }) => (
                        <div className="row" key={event}>
                          <span className="row-label">
                            {label}
                            {hint && <small>{hint}</small>}
                          </span>
                          <div className="sound-fx-picker">
                            <button
                              type="button"
                              className="btn btn-icon-only"
                              onClick={() => previewSound(event, settings[settingKey])}
                              aria-label={`Preview ${label}`}
                            >
                              <TablerIcon name="ti-player-play" />
                            </button>
                            <Combobox
                              value={String(settings[settingKey])}
                              options={SOUND_VARIANT_OPTIONS}
                              onChange={(value) => onUpdate({ [settingKey]: Number(value) })}
                              ariaLabel={`${label} variant`}
                              size="sm"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            {activeSection === "danger" && (
              <div className="group">
                <div className="group-label">
                  <span>Reset Everything</span>
                </div>
                <div className="card danger-card">
                  <div className="row-field">
                    <p>
                      Wipes the entire database — settings, agents, chat history, memory, knowledge base, and token
                      usage — and rebuilds it from scratch, just like a brand-new install. Takes you back through
                      onboarding. This cannot be undone.
                    </p>
                    <span>
                      Type <strong>{RESET_CONFIRM_WORD}</strong> to confirm
                    </span>
                    <input
                      type="text"
                      value={resetConfirmText}
                      onChange={(e) => setResetConfirmText(e.target.value)}
                      placeholder={RESET_CONFIRM_WORD}
                      autoComplete="off"
                      disabled={resetting}
                    />
                    {resetError && <p className="settings-error">{resetError}</p>}
                    <button
                      className="danger-btn"
                      disabled={resetConfirmText !== RESET_CONFIRM_WORD || resetting}
                      onClick={handleReset}
                    >
                      {resetting ? "Resetting…" : "Reset to Default"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
