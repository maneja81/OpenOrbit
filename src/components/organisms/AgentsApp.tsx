import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import OrbitScene from "@/components/organisms/OrbitScene";
import ChatPanel, { ChatMessage } from "@/components/organisms/ChatPanel";
import SettingsPanel, { SettingsSection } from "@/components/organisms/SettingsPanel";
import KnowledgeModal from "@/components/organisms/KnowledgeModal";
import ChatHistoryModal from "@/components/organisms/ChatHistoryModal";
import HttpToolApprovalModal, { type PendingToolApproval } from "@/components/molecules/HttpToolApprovalModal";
import { approvalSettledMessage } from "@/lib/approvalSettledMessage";
import AskUserCard, { type PendingQuestion } from "@/components/molecules/AskUserCard";
import { questionSettledMessage } from "@/lib/questionSettledMessage";
import { configAckMessage, shouldPersistConfigAck, type ConfigAckEvent } from "@/lib/configAckMessage";
import ErrorBoundary from "@/components/atoms/ErrorBoundary";

/** How long the entrance animation runs before the greeting lands. Named because the
 * onboarding-failure notice below has to queue behind it — a warning that arrives before
 * "Hi, I'm Orbit" reads as though something broke on launch. */
const GREETING_DELAY_MS = 1400;
/** Client-side bound on the LLM-generated greeting's runStream call — see its own comment for
 * why this exists instead of relying on the backend's much longer agentRunTimeoutSeconds. */
const GREETING_TIMEOUT_MS = 20_000;
// A specialist tool call held on the orbit view for at least this long once activated —
// some calls (e.g. a plain settings read) resolve in a couple of milliseconds, which would
// otherwise read as a flash rather than something that visibly "communicated".
const MIN_COMMUNICATING_VISIBLE_MS = 450;
import ToolApprovalCard from "@/components/molecules/ToolApprovalCard";
import OnboardingScreen, { type OnboardingAnswers } from "@/components/organisms/OnboardingScreen";
import { findProvider } from "@/lib/providers";
import { useOrbitScene } from "@/hooks/useOrbitScene";
import { useWindowControls } from "@/hooks/useWindowControls";
import { useGlobalTypingFocus } from "@/hooks/useGlobalTypingFocus";
import { useSettingsShortcut } from "@/hooks/useSettingsShortcut";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useVoiceShortcut } from "@/hooks/useVoiceShortcut";
import { useSettings } from "@/hooks/useSettings";
import { useLocation } from "@/hooks/useLocation";
import { useAgents } from "@/hooks/useAgents";
import { useSpeak } from "@/hooks/useSpeak";
import { useSoundFX, SoundFxEvent } from "@/hooks/useSoundFX";
import { useBackgroundMusic } from "@/hooks/useBackgroundMusic";
import { useSystemStats } from "@/hooks/useSystemStats";
import { useTokenUsage } from "@/hooks/useTokenUsage";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { isUpdateAvailable } from "@/lib/semver";
import { USER_CONTEXT_FIELDS } from "@/lib/userContext";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";
import { AgentId, StepEvent, matchAgentSlashCommand } from "@/lib/agents";
import { THINKING_STEP_TYPES } from "@/lib/activityFeed";
import { buildGreeting } from "@/lib/greeting";
import { formatSessionStats, getCognitiveState } from "@/lib/orbStatus";
import { KnowledgeWidgetAnchorContext } from "@/lib/knowledgeWidgetAnchor";
import { KnowledgeFilesContext } from "@/lib/knowledgeFilesContext";
import { useKnowledgeFiles } from "@/hooks/useKnowledgeFiles";
import { useAppWideFileDrop, FileDropGhost } from "@/hooks/useAppWideFileDrop";
import { useTour } from "@/hooks/useTour";


function FileDropGhostEl({ ghost }: { ghost: FileDropGhost }) {
  const [flying, setFlying] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFlying(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className={`file-drop-ghost${flying ? " flying" : ""}`}
      style={{
        left: ghost.startX,
        top: ghost.startY,
        transform: flying ? `translate(${ghost.endX - ghost.startX}px, ${ghost.endY - ghost.startY}px)` : "none",
      }}
    />
  );
}

export default function AgentsApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const orchestratorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const agentRefs = useRef<Record<AgentId, HTMLDivElement | null>>({});
  /** Wall-clock start of the turn currently in flight, read by the live "thinking" indicator
   * (via ChatPanel's liveStartedAt prop) to tick its own elapsed timer. handleSend's own
   * closure keeps its own `startedAt` local for computing elapsedMs — this state exists only
   * so ChatPanel can read the value during render, which a ref can't do. */
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);

  const [thinking, setThinking] = useState(false);
  // callId -> agentId for a specialist tool call Orbit itself made this turn — a Map, not a
  // single value, because Orbit can now call more than one specialist in the same turn (see
  // agents-as-tools: handoffs no longer cap it at one). Insertion order doubles as "most
  // recently activated" for the single traveling pulse-dot (see pulseLineAgent below).
  const [communicatingAgents, setCommunicatingAgents] = useState<Map<string, AgentId>>(new Map());
  // The current turn's plan, as reported via write_checklist — see ChecklistWidget. Unlike
  // communicatingAgents this isn't gated to Orbit's own top-level calls: any agent's own
  // checklist (Orbit's, or a specialist's for its own multi-step flow) should show up here.
  const [checklist, setChecklist] = useState<ChecklistItemRow[]>([]);
  const communicatingClearTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [steps, setSteps] = useState<StepEvent[]>([{ type: "waiting", label: "Waiting for message…" }]);
  const [orchestratorResponding, setOrchestratorResponding] = useState(false);
  // The requestId of the run currently in flight, if any — read by handleStop, which has no
  // other way to reach the requestId scoped inside handleSend's closure. Cleared in
  // handleSend's own .finally() alongside orchestratorResponding, so it never outlives the
  // run it names.
  const activeRequestIdRef = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection | undefined>(undefined);
  const [kbModalOpen, setKbModalOpen] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  useSettingsShortcut(useCallback(() => setSettingsOpen(true), []));
  // Lazy initialiser: Date.now() is impure, so it can't be called in the render path — this
  // way React evaluates it once on mount instead of on every render.
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: "greeting",
      role: "assistant",
      text: "Online. Tell me what needs doing.",
      avatarLabel: "A",
      createdAt: Date.now(),
    },
  ]);

  // createdAt is stamped here rather than at each call site so every message carries one
  // without twelve near-identical edits. A streaming reply is appended once and patched as
  // chunks land, so its stamp is when the reply started — which is what a chat time means.
  // Read before the updater, not inside it: updaters can be re-invoked (StrictMode, retries)
  // and a timestamp captured there would drift with each replay.
  const appendMessage = useCallback((msg: Omit<ChatMessage, "id" | "createdAt">): string => {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    setMessages((prev) => [...prev, { ...msg, id, createdAt }]);
    return id;
  }, []);

  const updateMessageText = useCallback((id: string, text: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text } : m)));
  }, []);

  const setMessageTrace = useCallback((id: string, traceId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, traceId } : m)));
  }, []);

  const setMessageSteps = useCallback((id: string, stepsForTurn: StepEvent[], elapsedMs?: number) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, steps: stepsForTurn, elapsedMs } : m)));
  }, []);
  const [entering, setEntering] = useState(false);

  const { settings, updateSettings, resetSettings, loaded, savedVersion } = useSettings();
  const closeSettingsPanel = useCallback(() => {
    setSettingsOpen(false);
    setSettingsInitialSection(undefined);
  }, []);
  const openSettingsForTour = useCallback((section?: SettingsSection) => {
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }, []);
  // Status bar's [i] button — same deep-link mechanism the tour uses, aimed at About.
  const openAbout = useCallback(() => {
    setSettingsInitialSection("about");
    setSettingsOpen(true);
  }, []);
  // Drives both the tour gate below and the render branch at the end of this component, so
  // the tour can never run against a screen that isn't showing its targets.
  const showOnboarding = !settings.onboardingDone && hasAgentsAPI();
  const { startTour } = useTour({
    tourCompleted: settings.tourCompleted,
    onboardingVisible: showOnboarding,
    loaded,
    updateSettings,
    openSettings: openSettingsForTour,
    closeSettings: closeSettingsPanel,
  });
  useLocation(settings.locationEnabled);
  const {
    agents,
    rawAgents,
    error: agentsError,
    updateAgent,
    createAgent,
    refreshAgents,
    deleteAgent,
    exportAgent,
    exportAllAgents,
    importAgents,
  } = useAgents();
  const { speak, speaking, stop: stopSpeaking } = useSpeak(settings.voiceApiKeySet);
  const soundFxVariants: Record<SoundFxEvent, number> = useMemo(
    () => ({
      send: settings.soundVariantSend,
      receive: settings.soundVariantReceive,
      handoff: settings.soundVariantHandoff,
      complete: settings.soundVariantComplete,
      startup: settings.soundVariantStartup,
      agentCreated: settings.soundVariantAgentCreated,
      agentDeleted: settings.soundVariantAgentDeleted,
      consult: settings.soundVariantConsult,
    }),
    [
      settings.soundVariantSend,
      settings.soundVariantReceive,
      settings.soundVariantHandoff,
      settings.soundVariantComplete,
      settings.soundVariantStartup,
      settings.soundVariantAgentCreated,
      settings.soundVariantAgentDeleted,
      settings.soundVariantConsult,
    ]
  );
  const playSfx = useSoundFX(settings.soundFxEnabled, soundFxVariants);

  const handleCreateAgent = useCallback(
    async (input: Parameters<typeof createAgent>[0]) => {
      const result = await createAgent(input);
      // Only on a real creation. The sound used to play unconditionally, so a failed create
      // still chimed as though it had worked.
      if (result) playSfx("agentCreated");
      return result;
    },
    [createAgent, playSfx]
  );

  const handleDeleteAgent = useCallback(
    async (id: string) => {
      const deleted = await deleteAgent(id);
      // Same reason as handleCreateAgent — a failed delete announced itself as a success.
      if (deleted) playSfx("agentDeleted");
    },
    [deleteAgent, playSfx]
  );
  useBackgroundMusic(settings.bgMusicEnabled, settings.bgMusicVolume);
  const knowledgeAnchorRef = useRef<HTMLDivElement | null>(null);
  const knowledgeFiles = useKnowledgeFiles();
  const { ghosts } = useAppWideFileDrop(knowledgeAnchorRef, knowledgeFiles.addFiles);
  const systemStats = useSystemStats();
  const tokenUsage = useTokenUsage("today", null);

  // Queued rather than appended immediately: Settings changes often arrive in a burst (add
  // three files, then enable location, then connect Gmail) and each deserves one coalesced
  // chat bubble on close, not one per change. A queue held in a ref (not state) survives across
  // the whole Settings session without re-rendering on every push.
  const configAckQueueRef = useRef<ConfigAckEvent[]>([]);

  const flushConfigAcks = useCallback(() => {
    const events = configAckQueueRef.current;
    if (events.length === 0) return;
    configAckQueueRef.current = [];
    const text = configAckMessage(events);
    appendMessage({ role: "assistant", text, avatarLabel: settings.agentName[0]?.toUpperCase() || "A" });
    // Fire-and-forget: the local bubble already showed, so a failed persist isn't worth a
    // second failure notice — see configAckMessage.ts.
    if (shouldPersistConfigAck(events) && hasAgentsAPI()) {
      void window.agentsAPI.chat.appendMessage({ role: "assistant", text });
    }
  }, [appendMessage, settings.agentName]);

  const queueConfigAck = useCallback(
    (event: ConfigAckEvent) => {
      configAckQueueRef.current.push(event);
      // Settings is closed (e.g. a file dropped from the main UI) — nothing will flush this
      // later, so show it right away instead of waiting for a Settings session that may
      // never happen.
      if (!settingsOpen) flushConfigAcks();
    },
    [settingsOpen, flushConfigAcks]
  );

  const wasSettingsOpenRef = useRef(settingsOpen);
  useEffect(() => {
    if (wasSettingsOpenRef.current && !settingsOpen) flushConfigAcks();
    wasSettingsOpenRef.current = settingsOpen;
  }, [settingsOpen, flushConfigAcks]);

  // Baseline-then-diff: the first run after onboarding just records what's already there, so
  // files seeded before this session (or during onboarding, guarded below) don't read as
  // newly added.
  const knownKnowledgeFileIdsRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!loaded || !settings.onboardingDone) return;
    const ids = new Set(knowledgeFiles.files.map((f) => f.id));
    const known = knownKnowledgeFileIdsRef.current;
    knownKnowledgeFileIdsRef.current = ids;
    if (known === null) return;
    for (const file of knowledgeFiles.files) {
      if (!known.has(file.id)) queueConfigAck({ type: "file", fileName: file.title || file.originalName });
    }
  }, [knowledgeFiles.files, loaded, settings.onboardingDone, queueConfigAck]);

  // Only the false→true edge is an ack-worthy event — toggling off says nothing new, and
  // onboarding's own initial value must not read as "just enabled".
  const knownLocationEnabledRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!loaded || !settings.onboardingDone) return;
    const known = knownLocationEnabledRef.current;
    knownLocationEnabledRef.current = settings.locationEnabled;
    if (known === null) return;
    if (!known && settings.locationEnabled) queueConfigAck({ type: "location" });
  }, [settings.locationEnabled, loaded, settings.onboardingDone, queueConfigAck]);

  // Ticks once a minute purely to force a re-render so the greeting's time-of-day band
  // (morning/afternoon/evening/night) updates for a session left open for hours, rather
  // than only refreshing whenever some unrelated state (e.g. `thinking`) happens to change.
  // Also carries how long the session has been open, for the orb's stats line — measured
  // from mount rather than a persisted timestamp, since a reload starts a new session.
  // Kept on this one interval (rather than a second one) because both consumers want the
  // same once-a-minute cadence, and the clock has to be read outside render anyway
  // (react-hooks/purity forbids Date.now() in a render pass).
  const [sessionElapsedMs, setSessionElapsedMs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setSessionElapsedMs(Date.now() - start), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Checked once, on launch, against this build's own version — not the reverse of the old
  // build-time check (see AboutTab.tsx / semver.ts), which could only ever compare a build
  // against itself and so could never actually detect a release published afterward. No
  // auto-download here, only the badge on #aboutbtn (AppControls.tsx) — see ipc/updateCheck.ts
  // for why.
  const [appVersion, setAppVersion] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    Promise.all([window.agentsAPI.appInfo.get(), window.agentsAPI.appInfo.latestRelease()])
      .then(([info, release]) => {
        if (cancelled) return;
        setAppVersion(info.packageVersion);
        setUpdateAvailable(isUpdateAvailable(release.version, info.packageVersion));
      })
      .catch(() => {
        // Version display and the update badge are both cosmetic — nothing here should
        // interrupt launch or surface an error the user can't act on.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A time-of-day greeting by the user's own name reads as more "alive" than a static
  // "{agentName} — ready". No busy suffix here: the orb's own status line and the Agent
  // Activity feed both track the run, so folding it in a third time only added noise.
  const statusText = buildGreeting(settings.userName);

  // Full reload after a Danger Zone reset guarantees every piece of in-memory state
  // (agents list, active delegation, chat, entrance animation) starts clean too —
  // rebuilding all of that by hand risks missing one and leaving stale state behind.
  const handleResetSettings = useCallback(async () => {
    await resetSettings();
    window.location.reload();
  }, [resetSettings]);

  const setAgentRef = useCallback(
    (id: AgentId) => (el: HTMLDivElement | null) => {
      agentRefs.current[id] = el;
    },
    []
  );

  // Every orb currently lit up (0, 1, or more — see communicatingAgents above).
  const communicatingAgentIds = useMemo(() => new Set(communicatingAgents.values()), [communicatingAgents]);
  // useOrbitScene's traveling pulse-dot is a single SVG element, so it follows whichever
  // specialist was activated most recently rather than trying to show every active line at
  // once — the orb/line glow itself (communicatingAgentIds above) still lights up for all of
  // them simultaneously, this only picks where the one decorative dot travels.
  const pulseLineAgent = useMemo(() => {
    const ids = [...communicatingAgents.values()];
    return ids.length > 0 ? ids[ids.length - 1] : null;
  }, [communicatingAgents]);

  const { ringGeometry, lineGeometry } = useOrbitScene({
    containerRef,
    bgCanvasRef,
    orchestratorRef,
    agentRefs,
    activeAgent: pulseLineAgent,
    agents,
    ready: loaded && settings.onboardingDone,
  });

  const { isFullscreen, minimize, close, toggleFullscreen } = useWindowControls();
  useGlobalTypingFocus(inputRef, settings.typeAnywhereEnabled);

  // Voice-originated replies also get spoken back (if enabled) — typed replies stay
  // text-only, since a spoken reply to something you typed would feel unexpected.
  // useSpeak calls the configured AI TTS model, falling back to the browser's
  // speechSynthesis if that fails (see useSpeak.ts / provider.ts for details). The
  // onStart callback mirrors real playback into the step feed (fired from useSpeak's
  // Audio/utterance event handlers, not a render effect), so the status shown to the
  // user tracks what's actually being spoken rather than a generic "thinking…" placeholder.
  // onRevealText lets a voice turn hold its chat-log bubble back until speech playback
  // actually starts — otherwise the reply text appeared as soon as the model finished
  // (well before the separate TTS network round-trip completed), so text visibly showed
  // up before anything was heard. A safety-net timeout guarantees the text still appears
  // even if playback fails silently (both the provider TTS call and the browser fallback
  // never fire onStart) rather than the reply simply never showing.
  const speakReply = useCallback(
    (text: string, onRevealText?: () => void) => {
      if (!settings.voiceOutputEnabled || !text) {
        onRevealText?.();
        return;
      }
      let revealed = false;
      const reveal = () => {
        if (revealed) return;
        revealed = true;
        onRevealText?.();
      };
      const safetyTimer = setTimeout(reveal, 4000);
      speak(text, {
        onStart: () => {
          clearTimeout(safetyTimer);
          reveal();
          setSteps((prev) => [...prev, { type: "speaking", label: `${settings.agentName} speaking…` }]);
        },
      });
    },
    [settings.voiceOutputEnabled, speak, settings.agentName]
  );

  const handleSend = useCallback(
    (text?: string, source: "text" | "voice" = "text") => {
      const input = inputRef.current;
      let value = text || input?.value.trim();
      if (!value) return;
      if (value === "/agents-create") {
        value = "I want to create a new custom agent.";
      }
      if (value === "/settings") {
        setSettingsOpen(true);
        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      if (value === "/tour") {
        startTour();
        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      if (value === "/chat-history") {
        setChatHistoryOpen(true);
        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      if (value === "/http-tools") {
        setSettingsInitialSection("http");
        setSettingsOpen(true);
        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      if (value === "/knowledgebase") {
        setKbModalOpen(true);
        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      if (value === "/add-file") {
        knowledgeFiles.pickAndAdd();
        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      if (value === "/add-folder") {
        knowledgeFiles.addFolder();
        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      if (value === "/system-stats") {
        const agentLabel = settings.agentName[0]?.toUpperCase() || "A";
        const text = systemStats
          ? `CPU: ${systemStats.cpuPct}% · RAM: ${systemStats.ramPct}% (${systemStats.ramUsedGB.toFixed(1)}/${systemStats.ramTotalGB.toFixed(1)} GB) · Disk: ${systemStats.diskPct}% (${systemStats.diskUsedGB.toFixed(1)}/${systemStats.diskTotalGB.toFixed(1)} GB)`
          : "System stats aren't available yet.";
        appendMessage({ role: "user", text: value, avatarLabel: "M" });
        appendMessage({ role: "assistant", text, avatarLabel: agentLabel });
        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      if (value === "/usage") {
        const agentLabel = settings.agentName[0]?.toUpperCase() || "A";
        const text = `Today's usage — Input: ${tokenUsage.inputTokens} · Output: ${tokenUsage.outputTokens} · Total: ${tokenUsage.totalTokens} tokens · Cost: $${tokenUsage.costUsd.toFixed(4)}`;
        appendMessage({ role: "user", text: value, avatarLabel: "M" });
        appendMessage({ role: "assistant", text, avatarLabel: agentLabel });
        if (input) {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      // Deterministic agent routing: "/<agent-slug> <message>" sends straight to that
      // agent, bypassing the orchestrator's own handoff judgment. Checked only after every
      // exact-string system command above, so an agent literally named e.g. "Settings"
      // can't shadow "/settings". `agents` (live, enabled-only) is the same roster
      // ChatInputBar derives its slash-menu entries from, so this stays in sync as agents
      // are created/deleted with no separate list to maintain.
      const directedAgent = matchAgentSlashCommand(value, agents);

      appendMessage({ role: "user", text: value, avatarLabel: "M" });
      playSfx("send");
      if (input) {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const agentLabel = settings.agentName[0]?.toUpperCase() || "A";
      const startedAt = Date.now();
      setRunStartedAt(startedAt);
      setThinking(true);
      setOrchestratorResponding(true);

      if (!hasAgentsAPI()) {
        setTimeout(() => {
          setOrchestratorResponding(false);
          setThinking(false);
          setRunStartedAt(null);
          appendMessage({ role: "assistant", text: "Agent bridge unavailable in this preview.", avatarLabel: agentLabel });
        }, 450);
        return;
      }

      const requestId = crypto.randomUUID();
      activeRequestIdRef.current = requestId;
      let streamedText = "";
      let respondingLogged = false;
      let assistantMessageId: string | null = null;
      // Set by the trace subscription below, before any chunk arrives. Kept in a local
      // rather than read back off message state so the value is available at the moment
      // the assistant bubble is created, whichever path creates it.
      let traceId: string | null = null;
      // Mirrors every setSteps call below so the finished turn's full step sequence can
      // be attached to its chat-log entry (as a collapsible "thinking" card) without
      // depending on React state timing — setSteps below drives the live orbit-scene
      // feed, this local array is the source of truth for what gets logged.
      let turnSteps: StepEvent[] = [
        { type: "message_received", label: "Message received" },
        { type: "interpreting", label: "Interpreting…" },
      ];
      setSteps(turnSteps);
      // Cleared per new turn, same lifecycle as turnSteps above — a checklist from the
      // previous message must not linger once a new one starts.
      setChecklist([]);

      // Text delta subscription — for typed turns, first chunk also flips "thinking…" to
      // live reply text. Voice turns skip the live text update entirely (the reply is
      // heard, not read) and rely on the step feed for background-status visibility
      // instead — the full transcript still appears once the final reply is ready.
      const unsubChunk = window.agentsAPI.agent.onStreamChunk(({ requestId: rid, chunk }) => {
        if (rid !== requestId) return;
        streamedText += chunk;
        setThinking(false);
        if (source !== "voice") {
          if (assistantMessageId === null) {
            assistantMessageId = appendMessage({
              role: "assistant",
              text: streamedText,
              avatarLabel: agentLabel,
              ...(traceId ? { traceId } : {}),
            });
          } else {
            updateMessageText(assistantMessageId, streamedText);
          }
        }
        if (!respondingLogged) {
          respondingLogged = true;
          playSfx("receive");
          turnSteps = [...turnSteps, { type: "responding", label: "Responding" }];
          setSteps(turnSteps);
        }
      });

      // Specialist tool name -> orbit node id, for matching a step's `toolName` back to the
      // node it belongs to (see agentAsTool/orchestratorToolName in ai/agents.ts). Built once
      // per run from the live roster snapshot already in scope.
      const toolNameToAgentId = new Map(
        rawAgents.filter((a) => a.orchestratorToolName).map((a) => [a.orchestratorToolName, a.id])
      );

      // Step subscription — feeds the live step progress UI, and lights up the orbit node
      // for whichever specialist Orbit is currently calling as a tool. This replaces the old
      // onStreamAgent-driven "handoff" highlight: Orbit no longer hands control away to a
      // specialist (SDK handoffs), it calls one as a tool and gets a result back — so that
      // event never fires anymore, and this is the live signal in its place. Only a
      // tool_called/tool_output whose `agentName` is Orbit's own name counts: a specialist's
      // own internal tool call (e.g. Cipher calling get_settings) arrives with
      // agentName="Cipher" and must not light up any node, or a nested call would
      // misattribute activity to the wrong orb.
      const unsubStep = window.agentsAPI.agent.onStreamStep(({ requestId: rid, ...step }) => {
        if (rid !== requestId) return;
        turnSteps = [...turnSteps, step];
        setSteps(turnSteps);

        // Unlike the communicatingAgents block below, this isn't gated to Orbit's own
        // calls — any agent's write_checklist call (Orbit's own plan, or a specialist's for
        // its own multi-step flow, e.g. Cipher) should refresh the widget. Triggered on
        // tool_output specifically because that's when the DB write has actually committed
        // (see ai/tools/checklistTools.ts) — fetching on tool_called would race the write.
        if (step.type === "tool_output" && step.toolName === "write_checklist" && traceId) {
          // Deliberately silent on failure, unlike useAgents.ts's mount-time fetch (which
          // surfaces via setError — a failed agent list there is indistinguishable from a
          // fresh install otherwise). This is lower stakes: the actual reply the user cares
          // about doesn't depend on it, a failed refetch just leaves the widget showing
          // whichever state it last successfully fetched (stale, not silently wrong), and
          // it can retry on the very next write_checklist call this same turn — no reason
          // to interrupt the conversation over a side widget not updating once.
          window.agentsAPI.checklist.get(traceId).then(setChecklist).catch(() => {});
        }

        const isOrbitsOwnCall = step.agentName?.toLowerCase() === settings.agentName.toLowerCase();
        if (!isOrbitsOwnCall || !step.callId) return;

        if (step.type === "tool_called") {
          const targetAgentId = toolNameToAgentId.get(step.toolName ?? "");
          if (!targetAgentId) return; // not a specialist call (e.g. save_user_info) — no orb to light
          const callId = step.callId;
          const pendingClear = communicatingClearTimersRef.current.get(callId);
          if (pendingClear) {
            clearTimeout(pendingClear);
            communicatingClearTimersRef.current.delete(callId);
          }
          setCommunicatingAgents((prev) => new Map(prev).set(callId, targetAgentId));
          playSfx("consult");
        } else if (step.type === "tool_output") {
          const callId = step.callId;
          // Held briefly rather than cleared immediately: some calls resolve in a couple of
          // milliseconds (e.g. a plain settings read), which would otherwise read as a flash
          // rather than something that visibly "communicated".
          const timer = setTimeout(() => {
            setCommunicatingAgents((prev) => {
              if (!prev.has(callId)) return prev;
              const next = new Map(prev);
              next.delete(callId);
              return next;
            });
            communicatingClearTimersRef.current.delete(callId);
          }, MIN_COMMUNICATING_VISIBLE_MS);
          communicatingClearTimersRef.current.set(callId, timer);
        }
      });

      // Trace subscription — the id linking this turn to its token_usage rows. It arrives
      // before the first chunk, so it's held in a local and applied when the assistant
      // message is created below; the message doesn't exist yet at this point.
      const unsubTrace = window.agentsAPI.agent.onStreamTrace(({ requestId: rid, traceId: tid }) => {
        if (rid !== requestId) return;
        traceId = tid;
        if (assistantMessageId !== null) setMessageTrace(assistantMessageId, tid);
      });

      window.agentsAPI.agent
        .runStream(directedAgent?.rest ?? value, requestId, directedAgent?.agent.name)
        .then((result) => {
          // finalOutput is authoritative (covers handoffs/tool calls where the streamed
          // deltas might not perfectly equal the final text) — falls back to whatever
          // streamed in if it's somehow empty.
          const finalText = result || streamedText || "(no response)";
          turnSteps = [...turnSteps, { type: "responded", label: `${settings.agentName} responded` }];
          setSteps(turnSteps);
          // The live orbit-scene feed already shows the generic bookkeeping steps
          // (message received/interpreting/responding/responded) — the persisted "thinking"
          // card in the chat log keeps only the substantive parts: tool calls and handoffs,
          // so it doesn't just duplicate what's already visible elsewhere.
          const thinkingSteps = turnSteps.filter((s) => THINKING_STEP_TYPES.has(s.type));
          // Real wall-clock elapsed time for the turn, stamped onto the finished message so
          // its collapsed toggle can say "Thought for Ns".
          const elapsedMs = Date.now() - startedAt;

          const revealMessage = () => {
            if (assistantMessageId === null) {
              // Voice turns (and any run that produced no streamed chunks) never got a
              // placeholder message above — create the final one here instead of updating.
              assistantMessageId = appendMessage({
                role: "assistant",
                text: finalText,
                avatarLabel: agentLabel,
                ...(traceId ? { traceId } : {}),
              });
            } else {
              updateMessageText(assistantMessageId, finalText);
            }
            setMessageSteps(assistantMessageId, thinkingSteps, elapsedMs);
          };

          if (source === "voice") {
            // Hold the chat-log bubble back until speech playback actually starts, so the
            // reply isn't visibly read before it's heard — text and voice now surface together.
            speakReply(finalText, revealMessage);
          } else {
            revealMessage();
          }
          // The feed stays on the turn's final state ("... responded") until the next send
          // overwrites it at the top of this handler — no timed reset back to idle. A timed
          // reset here previously wiped the just-shown tool activity out from under the user
          // a few seconds after it appeared, which read as the response disappearing rather
          // than the feed going idle.
          // Cipher's create_agent tool (and any future agent-mutating tool) writes
          // directly to the agents table from the main process — this hook's local
          // state has no other way to learn a row appeared, so resync after every run.
          refreshAgents();
        })
        .catch((err) => {
          appendMessage({
            role: "assistant",
            text: formatHumanizedError(humanizeError(err)),
            avatarLabel: agentLabel,
          });
        })
        .finally(() => {
          unsubChunk();
          unsubStep();
          unsubTrace();
          // Clears any node still lit up even if the run ended mid-call (error, approval
          // timeout) — a stale highlight would otherwise sit there until the next run.
          communicatingClearTimersRef.current.forEach((timer) => clearTimeout(timer));
          communicatingClearTimersRef.current.clear();
          setCommunicatingAgents(new Map());
          setOrchestratorResponding(false);
          setThinking(false);
          setRunStartedAt(null);
          if (activeRequestIdRef.current === requestId) activeRequestIdRef.current = null;
          playSfx("complete");
        });
    },
    [
      settings.agentName,
      speakReply,
      agents,
      rawAgents,
      playSfx,
      knowledgeFiles,
      systemStats,
      tokenUsage,
      refreshAgents,
      appendMessage,
      updateMessageText,
      setMessageSteps,
      setMessageTrace,
      startTour,
    ]
  );

  const handleStop = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    if (!requestId || !hasAgentsAPI()) return;
    window.agentsAPI.agent.stop(requestId);
  }, []);

  // A tool marked "ask before running" pauses its agent run in the main process and waits
  // here. Queued rather than kept as a single value: one turn can interrupt on several
  // tool calls, and the SDK hands them over one at a time — dropping any would strand the
  // run until its 5-minute approval timeout declined it.
  /** Set when the onboarding answers failed to persist, so the notice can be queued behind the
   * greeting rather than racing it. */
  const [onboardingFactsFailed, setOnboardingFactsFailed] = useState(false);
  /** The context answers from onboarding, read once by the entrance greeting to prompt Orbit
   * with what it already knows about the user. A ref rather than state: written once at
   * handoff and never needs to trigger a re-render itself. */
  const onboardingContextRef = useRef<Pick<OnboardingAnswers, "profession" | "responseStyle" | "technicalLevel" | "stuckStyle">>({
    profession: "",
    responseStyle: "",
    technicalLevel: "",
    stuckStyle: "",
  });
  const [approvalQueue, setApprovalQueue] = useState<PendingToolApproval[]>([]);
  useEffect(() => {
    if (!hasAgentsAPI()) return;
    return window.agentsAPI.agent.onToolApproval(({ approvalId, toolName, agentName, args, expiresAt }) => {
      // requestedAt is read here, in the IPC callback, rather than inside the state updater —
      // a clock read in an updater body is impure and StrictMode double-invokes it.
      const requestedAt = Date.now();
      setApprovalQueue((prev) => [...prev, { approvalId, toolName, agentName, args, expiresAt, requestedAt }]);
    });
  }, []);

  // Mirrors approvalQueue so the settled handler below can name the tool that went away
  // without taking the queue as a dependency — which would tear down and re-subscribe the
  // IPC listener on every approval.
  const approvalQueueRef = useRef<PendingToolApproval[]>([]);
  useEffect(() => {
    approvalQueueRef.current = approvalQueue;
  }, [approvalQueue]);

  // Main answers on the user's behalf when the 5-minute timeout expires or the run is
  // abandoned. Nothing used to tell the renderer, so the prompt stayed up with the call
  // already declined — and Approve then resolved nothing, which reads as the button being
  // broken. Drop it here and say what happened, rather than letting it vanish silently.
  useEffect(() => {
    if (!hasAgentsAPI()) return;
    return window.agentsAPI.agent.onToolApprovalSettled(({ approvalId, reason }) => {
      const settled = approvalQueueRef.current.find((item) => item.approvalId === approvalId);
      if (!settled) return;
      setApprovalQueue((prev) => prev.filter((item) => item.approvalId !== approvalId));
      appendMessage({
        role: "assistant",
        text: approvalSettledMessage(settled.toolName, reason, settled.expiresAt - settled.requestedAt),
        avatarLabel: settings.agentName[0]?.toUpperCase() || "A",
      });
    });
  }, [appendMessage, settings.agentName]);

  const pendingApproval = approvalQueue[0] ?? null;

  const respondToApproval = useCallback((approvalId: string, approved: boolean) => {
    setApprovalQueue((prev) => prev.filter((item) => item.approvalId !== approvalId));
    if (!hasAgentsAPI()) return;
    void window.agentsAPI.agent.respondToApproval(approvalId, approved);
  }, []);

  // Same queue/settle/respond shape as approvalQueue above — ask_user is a different pause
  // (a real answer, not a boolean gate) but the same "several can interrupt one turn, the
  // SDK hands them over one at a time" reasoning applies identically.
  const [questionQueue, setQuestionQueue] = useState<PendingQuestion[]>([]);
  useEffect(() => {
    if (!hasAgentsAPI()) return;
    return window.agentsAPI.agent.onQuestion(({ questionId, agentName, question, field, expiresAt }) => {
      const requestedAt = Date.now();
      setQuestionQueue((prev) => [...prev, { questionId, agentName, question, field, expiresAt, requestedAt }]);
    });
  }, []);

  const questionQueueRef = useRef<PendingQuestion[]>([]);
  useEffect(() => {
    questionQueueRef.current = questionQueue;
  }, [questionQueue]);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    return window.agentsAPI.agent.onQuestionSettled(({ questionId, reason }) => {
      const settled = questionQueueRef.current.find((item) => item.questionId === questionId);
      if (!settled) return;
      setQuestionQueue((prev) => prev.filter((item) => item.questionId !== questionId));
      appendMessage({
        role: "assistant",
        text: questionSettledMessage(settled.question, reason, settled.expiresAt - settled.requestedAt),
        avatarLabel: settings.agentName[0]?.toUpperCase() || "A",
      });
    });
  }, [appendMessage, settings.agentName]);

  const pendingQuestion = questionQueue[0] ?? null;

  const respondToQuestion = useCallback((questionId: string, answer: string) => {
    setQuestionQueue((prev) => prev.filter((item) => item.questionId !== questionId));
    if (!hasAgentsAPI()) return;
    void window.agentsAPI.agent.respondToQuestion(questionId, answer);
  }, []);

  const startupPlayedRef = useRef(false);
  useEffect(() => {
    if (startupPlayedRef.current) return;
    if (!loaded || !settings.onboardingDone) return;
    startupPlayedRef.current = true;
    playSfx("startup");
  }, [loaded, settings.onboardingDone, playSfx]);

  const { listening, transcribing, startVoice, stopVoice } = useVoiceInput({
    onFinalResult: (text) => handleSend(text, "voice"),
    onUnsupported: () =>
      appendMessage({
        role: "assistant",
        text: "Voice input isn't supported here (no microphone access available).",
        avatarLabel: "A",
      }),
    onError: (message) =>
      appendMessage({ role: "assistant", text: `Voice input error: ${message}`, avatarLabel: "A" }),
  });
  useVoiceShortcut({ enabled: settings.voiceInputEnabled, listening, startVoice, stopVoice });

  // Esc also force-stops the agent's spoken reply, independent of the voice-input Esc
  // handling above (useVoiceShortcut only cancels mic recording, not TTS playback).
  useEffect(() => {
    if (!speaking) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopSpeaking();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [speaking, stopSpeaking]);

  const handleOnboardingComplete = useCallback(
    (answers: OnboardingAnswers) => {
      onboardingContextRef.current = {
        profession: answers.profession.trim(),
        responseStyle: answers.responseStyle,
        technicalLevel: answers.technicalLevel,
        stuckStyle: answers.stuckStyle,
      };
      updateSettings({
        agentName: answers.agentName,
        userName: answers.userName,
        // Voice is seeded from the same key only when the chosen provider can actually serve
        // speech. Copying it unconditionally — which is what this used to do — configures Voice
        // against a host with no /audio endpoints at all, so the mic appears to work and then
        // fails at call time. Only OpenAI serves them today; see supportsVoice in lib/providers.
        ...(findProvider(answers.providerId)?.supportsVoice
          ? { voiceApiKey: answers.apiKey, voiceApiUrl: answers.apiUrl }
          : // Voice input is transcription, and useVoiceInput deliberately replaces the browser's
            // SpeechRecognition with the provider's /audio/transcriptions — so unlike speech
            // *output*, which falls back to the browser's own voice, there is nothing for it to
            // degrade to. Leaving the toggle on would offer a mic that can only fail. Voice output
            // stays on: useSpeak routes it to browser TTS while the slot is unconfigured.
            { voiceInputEnabled: false }),
        onboardingDone: true,
      });

      // The provider is one call rather than a handful of settings writes, because it is one
      // change: credentials, the Chat slot, and the models of every agent that follows it. Doing
      // it piecemeal is what leaves four system agents naming a model the new host has never
      // heard of. See electron/main/ai/selectProvider.ts.
      if (hasAgentsAPI()) {
        void window.agentsAPI.providers
          .selectChat({
            providerId: answers.providerId,
            apiUrl: answers.apiUrl,
            apiKey: answers.apiKey,
            model: answers.model,
          })
          .catch((error: unknown) => {
            // Non-fatal by design: the user is already through the door, and Settings → AI Models
            // is where they would fix it anyway. Swallowing it silently would be worse than the
            // log line, which is what a bug report will carry.
            window.agentsAPI.dev.log("[onboarding] selectChat failed", error);
          });
      }

      // The optional context answers go into the shared user-fact store so every agent
      // has them from the first turn. Fire-and-forget: the entrance animation below must
      // not wait on an IPC round-trip, and nothing here depends on the write landing.
      if (hasAgentsAPI()) {
        // Questions come from USER_CONTEXT_FIELDS so what's written here matches what
        // Settings → General → About you later reads and updates.
        const facts = USER_CONTEXT_FIELDS.map((field) => ({
          question: field.factQuestion,
          answer: answers[field.key],
        })).filter((fact) => fact.answer.trim().length > 0);

        if (facts.length > 0) {
          void window.agentsAPI.userInfo.seedFacts(facts).catch((error: unknown) => {
            window.agentsAPI.dev.log("[onboarding] seedFacts failed", error);
            // The user typed these answers a moment ago. Losing them silently is the worst
            // outcome: nothing on screen changes, so there is no reason to suspect anything and
            // no reason to visit the one screen where they could be re-entered. Unlike the
            // selectChat failure above — which announces itself the first time a message is
            // sent — a missing fact never surfaces on its own.
            setOnboardingFactsFailed(true);
          });
        }
      }

      setMessages([]);
      setEntering(true);
    },
    [updateSettings]
  );

  useEffect(() => {
    if (!entering) return;
    const agentLabel = settings.agentName[0]?.toUpperCase() || "A";
    // Used verbatim if the LLM call below never happens (no agent bridge) or fails/times out —
    // same wording the greeting always used, so a broken run degrades to what already shipped.
    const staticGreeting = `Hi ${settings.userName || "there"}, I'm ${settings.agentName}. You can talk to me using the mic, or type in the chat below. What would you like to start with?`;

    const timer = setTimeout(() => {
      if (!hasAgentsAPI()) {
        appendMessage({ role: "assistant", text: staticGreeting, avatarLabel: agentLabel });
        return;
      }

      const { profession, responseStyle, technicalLevel, stuckStyle } = onboardingContextRef.current;
      const knownDetails = [
        profession && `their profession: ${profession}`,
        responseStyle && `they prefer ${responseStyle.toLowerCase()} answers`,
        technicalLevel && `their technical level: ${technicalLevel.toLowerCase()}`,
        stuckStyle && `when stuck they want: ${stuckStyle.toLowerCase()}`,
      ]
        .filter(Boolean)
        .join("; ");
      const prompt = `This is the very first message of a brand new conversation, right after onboarding — the user has not said anything yet. Greet ${
        settings.userName || "the user"
      } warmly and briefly, as yourself.${
        knownDetails ? ` Weave in what you already know about them from onboarding: ${knownDetails}.` : ""
      } Mention they can talk to you using the mic or type in the chat below. End by asking what they'd like to start with. Keep it to 2-3 short sentences, plain text, no markdown.`;

      // requestId/traceId plumbing mirrors handleSend's runStream call above, trimmed to just
      // what a one-shot, non-streamed-to-UI greeting needs: the trace id (so the bubble still
      // links to its token-usage row) and the final text.
      const requestId = crypto.randomUUID();
      let traceId: string | null = null;
      const unsubTrace = window.agentsAPI.agent.onStreamTrace(({ requestId: rid, traceId: tid }) => {
        if (rid === requestId) traceId = tid;
      });

      // No AbortSignal on runStream's IPC round trip, and the backend's own run timeout is
      // agentRunTimeoutSeconds (an hour by default) — without this, a slow/hung provider
      // leaves a brand new user staring at a silent chat log for up to that long. `settled`
      // guards against the fallback firing and then the real result landing afterwards and
      // appending a second, redundant greeting.
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        appendMessage({ role: "assistant", text: staticGreeting, avatarLabel: agentLabel });
      }, GREETING_TIMEOUT_MS);

      window.agentsAPI.agent
        .runStream(prompt, requestId, undefined, false)
        .then((result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          const text = result?.trim();
          appendMessage({
            role: "assistant",
            text: text || staticGreeting,
            avatarLabel: agentLabel,
            ...(traceId ? { traceId } : {}),
          });
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          // Same fallback as no-agent-bridge above — a failed/timed-out first run must not
          // leave a brand new user staring at an empty chat.
          appendMessage({ role: "assistant", text: staticGreeting, avatarLabel: agentLabel });
        })
        .finally(() => {
          unsubTrace();
        });
    }, GREETING_DELAY_MS);
    return () => clearTimeout(timer);
    // Fires once when onboarding hands off into the main UI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entering]);

  // Queued behind the greeting rather than appended from the catch directly: the rejection
  // usually lands within milliseconds, which would put "I couldn't save your details" above
  // "Hi, I'm Orbit". Cleared as it fires so a later re-render cannot repeat it.
  useEffect(() => {
    if (!onboardingFactsFailed) return;
    const timer = setTimeout(() => {
      appendMessage({
        role: "assistant",
        text: "I couldn't save the details you just gave me, so I don't have them yet. You can add them again in Settings → General → About you.",
        avatarLabel: settings.agentName[0]?.toUpperCase() || "A",
      });
      setOnboardingFactsFailed(false);
    }, GREETING_DELAY_MS + 600);
    return () => clearTimeout(timer);
  }, [onboardingFactsFailed, appendMessage, settings.agentName]);

  if (!loaded) return null;

  // Skip onboarding only in dev:web (no window.agentsAPI, so settings can never persist
  // onboardingDone=true across a reload there) — lets us iterate on the main orbit UI
  // without re-clicking through onboarding every refresh. Electron dev/packaged builds
  // are untouched since hasAgentsAPI() is always true there.
  if (showOnboarding) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }

  const cognitiveState = getCognitiveState({
    listening,
    transcribing,
    speaking,
    thinking,
    orchestratorResponding,
    hasActiveAgent: communicatingAgents.size > 0,
  });
  const sessionStats = formatSessionStats(messages.filter((m) => m.role === "user").length, sessionElapsedMs);

  return (
    <KnowledgeFilesContext.Provider value={knowledgeFiles}>
    <KnowledgeWidgetAnchorContext.Provider value={knowledgeAnchorRef}>
      {/* Two boundaries, nested, because ChatPanel is rendered as OrbitScene's children.
          The inner one means a chat render failure costs the transcript and leaves the orbit,
          the widgets and Settings usable; the outer one catches the scene itself. Without
          either, a throw in the primary UI reached the root boundary in main.tsx and took the
          whole app down — while five secondary Settings tabs each degraded on their own. */}
      <ErrorBoundary fallbackTitle="The orbit failed to load">
      <OrbitScene
        containerRef={containerRef}
        bgCanvasRef={bgCanvasRef}
        orchestratorRef={orchestratorRef}
        setAgentRef={setAgentRef}
        communicatingAgents={communicatingAgentIds}
        checklist={checklist}
        pulseLineAgent={pulseLineAgent}
        orchestratorResponding={orchestratorResponding || speaking}
        agents={agents}
        steps={steps}
        ringGeometry={ringGeometry}
        lineGeometry={lineGeometry}
        statusText={statusText}
        onOpenSettings={() => setSettingsOpen(true)}
        onStartTour={startTour}
        onOpenAbout={openAbout}
        isFullscreen={isFullscreen}
        onMinimize={minimize}
        onClose={close}
        onToggleFullscreen={toggleFullscreen}
        agentName={settings.agentName}
        orchestratorModel={settings.orchestratorModel}
        entering={entering}
        locationEnabled={settings.locationEnabled}
        cognitiveState={cognitiveState}
        version={appVersion}
        updateAvailable={updateAvailable}
        sessionStats={sessionStats}
      >
        <ErrorBoundary fallbackTitle="The chat failed to load">
        <ChatPanel
          messages={messages}
          inputRef={inputRef}
          agentName={settings.agentName}
          listening={listening}
          transcribing={transcribing}
          voiceEnabled={settings.voiceInputEnabled}
          agents={agents}
          approvalCard={
            pendingApproval && settings.toolApprovalDisplay === "inline" ? (
              <ToolApprovalCard approval={pendingApproval} onRespond={respondToApproval} />
            ) : null
          }
          questionCard={pendingQuestion ? <AskUserCard pending={pendingQuestion} onAnswer={respondToQuestion} /> : null}
          liveStartedAt={orchestratorResponding ? runStartedAt : null}
          liveSteps={orchestratorResponding ? steps : undefined}
          // Locked in both display modes: the modal already blocks interaction, and the
          // inline card would otherwise leave the input live while a run is paused. Same
          // reasoning extends to a pending question — always an in-chat card, never a modal.
          // Also locked for the plain in-flight case (no approval/question, just Orbit still
          // replying) — sending mid-run doesn't queue, it starts a second concurrent run and
          // its step feed resets the one already in progress out from under the user.
          sendDisabled={pendingApproval !== null || pendingQuestion !== null || orchestratorResponding}
          // KI-3: question takes priority in the (impossible in practice, but not
          // type-impossible) case both are somehow pending at once — either way the
          // placeholder must never claim "approve or decline" when a question is why send
          // is blocked, since it isn't an approval gate. "responding" is lowest priority —
          // an approval/question mid-run still means that, not "still responding".
          sendDisabledReason={
            pendingQuestion !== null
              ? "question"
              : pendingApproval !== null
                ? "approval"
                : orchestratorResponding
                  ? "responding"
                  : undefined
          }
          responding={orchestratorResponding}
          onShowFullHistory={() => setChatHistoryOpen(true)}
          visibleConversationCount={settings.chatVisibleConversations}
          autoLoadRemoteImages={settings.remoteImagesAutoLoad}
          onSend={() => handleSend()}
          onStop={handleStop}
          onStartVoice={startVoice}
          onStopVoice={stopVoice}
        />
        </ErrorBoundary>
      </OrbitScene>
      </ErrorBoundary>
      <SettingsPanel
        open={settingsOpen}
        onClose={closeSettingsPanel}
        initialSection={settingsInitialSection}
        settings={settings}
        savedVersion={savedVersion}
        sessionElapsedMs={sessionElapsedMs}
        onUpdate={updateSettings}
        agentsError={agentsError}
        onReset={handleResetSettings}
        agents={rawAgents}
        onUpdateAgent={updateAgent}
        onCreateAgent={handleCreateAgent}
        onDeleteAgent={handleDeleteAgent}
        onExportAgent={exportAgent}
        onExportAllAgents={exportAllAgents}
        onImportAgents={importAgents}
        onConfigAck={queueConfigAck}
      />
      <KnowledgeModal open={kbModalOpen} onClose={() => setKbModalOpen(false)} />
      {/* Mounted conditionally rather than kept alive with open={false}: a fresh mount is
          what resets the pager to the newest page on each open. */}
      {chatHistoryOpen && (
        <ChatHistoryModal
          open
          onClose={() => setChatHistoryOpen(false)}
          autoLoadRemoteImages={settings.remoteImagesAutoLoad}
        />
      )}

      {settings.toolApprovalDisplay === "modal" && (
        <HttpToolApprovalModal approval={pendingApproval} onRespond={respondToApproval} />
      )}
      {createPortal(
        <>
          {ghosts.map((ghost) => (
            <FileDropGhostEl key={ghost.id} ghost={ghost} />
          ))}
        </>,
        document.body
      )}
    </KnowledgeWidgetAnchorContext.Provider>
    </KnowledgeFilesContext.Provider>
  );
}
