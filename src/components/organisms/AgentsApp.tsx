import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import OrbitScene from "@/components/organisms/OrbitScene";
import ChatPanel, { ChatMessage } from "@/components/organisms/ChatPanel";
import SettingsPanel, { SettingsSection } from "@/components/organisms/SettingsPanel";
import KnowledgeModal from "@/components/organisms/KnowledgeModal";
import ChatHistoryModal from "@/components/organisms/ChatHistoryModal";
import HttpToolApprovalModal, { type PendingToolApproval } from "@/components/molecules/HttpToolApprovalModal";
import { approvalSettledMessage } from "@/lib/approvalSettledMessage";
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
import { USER_CONTEXT_FIELDS } from "@/lib/userContext";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";
import { AgentId, StepEvent, matchAgentSlashCommand } from "@/lib/agents";
import { buildGreeting } from "@/lib/greeting";
import { formatSessionStats, getCognitiveState } from "@/lib/orbStatus";
import { KnowledgeWidgetAnchorContext } from "@/lib/knowledgeWidgetAnchor";
import { KnowledgeFilesContext } from "@/lib/knowledgeFilesContext";
import { useKnowledgeFiles } from "@/hooks/useKnowledgeFiles";
import { useAppWideFileDrop, FileDropGhost } from "@/hooks/useAppWideFileDrop";
import { useTour } from "@/hooks/useTour";

// Step types worth persisting in a chat-log "thinking" card — the substantive record of
// what the run actually did: hand-offs and tool calls. Generic run bookkeeping
// (message_received/interpreting/responding/responded) stays out, since it carries no
// information about the work itself. Tool calls used to be excluded as "internal", but the
// live orbit-scene feed is wiped 10s after a turn (see resetStepsTimerRef below), so this
// card is the only durable answer to "which tools did it actually use?".
const THINKING_STEP_TYPES = new Set(["handoff_requested", "handoff_occurred", "tool_called", "tool_output"]);

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
  const resetStepsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [thinking, setThinking] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentId | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([{ type: "waiting", label: "Waiting for message…" }]);
  const [orchestratorResponding, setOrchestratorResponding] = useState(false);
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

  const setMessageSteps = useCallback((id: string, stepsForTurn: StepEvent[]) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, steps: stepsForTurn } : m)));
  }, []);
  const [entering, setEntering] = useState(false);

  const { settings, updateSettings, resetSettings, loaded } = useSettings();
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
    }),
    [
      settings.soundVariantSend,
      settings.soundVariantReceive,
      settings.soundVariantHandoff,
      settings.soundVariantComplete,
      settings.soundVariantStartup,
      settings.soundVariantAgentCreated,
      settings.soundVariantAgentDeleted,
    ]
  );
  const playSfx = useSoundFX(settings.soundFxEnabled, soundFxVariants);

  const handleCreateAgent = useCallback(
    async (input: Parameters<typeof createAgent>[0]) => {
      const result = await createAgent(input);
      playSfx("agentCreated");
      return result;
    },
    [createAgent, playSfx]
  );

  const handleDeleteAgent = useCallback(
    async (id: string) => {
      await deleteAgent(id);
      playSfx("agentDeleted");
    },
    [deleteAgent, playSfx]
  );
  useBackgroundMusic(settings.bgMusicEnabled, settings.bgMusicVolume);
  const knowledgeAnchorRef = useRef<HTMLDivElement | null>(null);
  const knowledgeFiles = useKnowledgeFiles();
  const { ghosts } = useAppWideFileDrop(knowledgeAnchorRef, knowledgeFiles.addFiles);
  const systemStats = useSystemStats();
  const tokenUsage = useTokenUsage("today", null);

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

  const { ringGeometry, lineGeometry } = useOrbitScene({
    containerRef,
    bgCanvasRef,
    orchestratorRef,
    agentRefs,
    activeAgent,
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
      setThinking(true);
      setOrchestratorResponding(true);

      // A new send supersedes any pending "back to waiting" reset from a prior run.
      if (resetStepsTimerRef.current) {
        clearTimeout(resetStepsTimerRef.current);
        resetStepsTimerRef.current = null;
      }

      if (!hasAgentsAPI()) {
        setTimeout(() => {
          setOrchestratorResponding(false);
          setThinking(false);
          appendMessage({ role: "assistant", text: "Agent bridge unavailable in this preview.", avatarLabel: agentLabel });
        }, 450);
        return;
      }

      const requestId = crypto.randomUUID();
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

      // Handoff subscription — lights up the correct orbit node when the orchestrator delegates.
      const unsubAgent = window.agentsAPI.agent.onStreamAgent(({ requestId: rid, agentName }) => {
        if (rid !== requestId) return;
        // Match by name (case-insensitive) against the live agent roster.
        const match = rawAgents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
        setActiveAgent(match?.id ?? null);
        playSfx("handoff");
        turnSteps = [
          ...turnSteps,
          { type: "handoff_occurred", label: `Delegating to ${agentName}`, handoffTo: agentName },
        ];
        setSteps(turnSteps);
      });

      // Step subscription — feeds the live step progress UI. Everything but requestId is
      // kept: the payload minus the routing id is exactly a StepEvent, and dropping the
      // tool/agent/timing fields here would leave the feed on its generic fallback labels.
      const unsubStep = window.agentsAPI.agent.onStreamStep(({ requestId: rid, ...step }) => {
        if (rid !== requestId) return;
        turnSteps = [...turnSteps, step];
        setSteps(turnSteps);
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
            if (thinkingSteps.length > 0) setMessageSteps(assistantMessageId, thinkingSteps);
          };

          if (source === "voice") {
            // Hold the chat-log bubble back until speech playback actually starts, so the
            // reply isn't visibly read before it's heard — text and voice now surface together.
            speakReply(finalText, revealMessage);
          } else {
            revealMessage();
          }
          // Hold the "responded" entry for 10s, then return the feed to its idle state.
          resetStepsTimerRef.current = setTimeout(() => {
            setSteps([{ type: "waiting", label: "Waiting for message…" }]);
            resetStepsTimerRef.current = null;
          }, 10000);
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
          unsubAgent();
          unsubStep();
          unsubTrace();
          setActiveAgent(null);
          setOrchestratorResponding(false);
          setThinking(false);
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

  useEffect(() => {
    return () => {
      if (resetStepsTimerRef.current) clearTimeout(resetStepsTimerRef.current);
    };
  }, []);

  // A tool marked "ask before running" pauses its agent run in the main process and waits
  // here. Queued rather than kept as a single value: one turn can interrupt on several
  // tool calls, and the SDK hands them over one at a time — dropping any would strand the
  // run until its 5-minute approval timeout declined it.
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
    const greeting = `Hi ${settings.userName || "there"}, I'm ${settings.agentName}. You can talk to me using the mic, or type in the chat below.`;
    const timer = setTimeout(() => {
      appendMessage({ role: "assistant", text: greeting, avatarLabel: settings.agentName[0]?.toUpperCase() || "A" });
      speak(greeting);
    }, 1400);
    return () => clearTimeout(timer);
    // Fires once when onboarding hands off into the main UI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entering]);

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
    hasActiveAgent: activeAgent !== null,
  });
  const sessionStats = formatSessionStats(messages.filter((m) => m.role === "user").length, sessionElapsedMs);

  return (
    <KnowledgeFilesContext.Provider value={knowledgeFiles}>
    <KnowledgeWidgetAnchorContext.Provider value={knowledgeAnchorRef}>
      <OrbitScene
        containerRef={containerRef}
        bgCanvasRef={bgCanvasRef}
        orchestratorRef={orchestratorRef}
        setAgentRef={setAgentRef}
        activeAgent={activeAgent}
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
        sessionStats={sessionStats}
      >
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
          // Locked in both display modes: the modal already blocks interaction, and the
          // inline card would otherwise leave the input live while a run is paused.
          sendDisabled={pendingApproval !== null}
          onShowFullHistory={() => setChatHistoryOpen(true)}
          autoLoadRemoteImages={settings.remoteImagesAutoLoad}
          onSend={() => handleSend()}
          onStartVoice={startVoice}
          onStopVoice={stopVoice}
        />
      </OrbitScene>
      <SettingsPanel
        open={settingsOpen}
        onClose={closeSettingsPanel}
        initialSection={settingsInitialSection}
        settings={settings}
        sessionElapsedMs={sessionElapsedMs}
        onUpdate={updateSettings}
        onReset={handleResetSettings}
        agents={rawAgents}
        onUpdateAgent={updateAgent}
        onCreateAgent={handleCreateAgent}
        onDeleteAgent={handleDeleteAgent}
        onExportAgent={exportAgent}
        onExportAllAgents={exportAllAgents}
        onImportAgents={importAgents}
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
