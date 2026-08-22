import { RefObject, KeyboardEvent, FormEvent, useMemo, useState } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";
import IconButton from "@/components/atoms/IconButton";
import SlashCommandMenu, { SlashMenuItem } from "@/components/molecules/SlashCommandMenu";
import { useAppLauncher } from "@/hooks/useAppLauncher";
import { slugifyAgentName } from "@/lib/agents";

export interface DirectableAgent {
  id: string;
  name: string;
  icon: string;
  tagline?: string;
  /** SQLite boolean convention (0/1), matching AgentRow.system — 1 for the four built-in
   * agents (Cipher, Atlas, Explorer, Chrono), 0 for anything the user created. Used to group
   * the @ agent-mention menu into "System" / "Custom". */
  system: number;
}

interface ChatInputBarProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  agentName: string;
  listening: boolean;
  transcribing: boolean;
  voiceEnabled: boolean;
  /** Every enabled agent (system + custom) the message could be directed at — rendered
   * as extra slash commands (e.g. typing "/cipher") that address that agent by name. */
  agents: DirectableAgent[];
  /** Blocks sending — and the rest of the bar's controls — while a tool approval or an
   * ask_user question is outstanding, or while a run is already in flight. A second turn
   * sent mid-run doesn't queue, it starts a concurrent run against the same chat and its
   * step feed clobbers the one already in progress. */
  sendDisabled?: boolean;
  /** KI-3: which kind of pause is blocking send, so the placeholder can say the right
   * thing — "approve or decline" is wrong (and was shown, misleadingly) while an ask_user
   * card is actually what's waiting for input. Ignored when sendDisabled is false. */
  sendDisabledReason?: "approval" | "question" | "responding";
  /** True for the whole span of an in-flight run, including its approval/question pauses —
   * swaps the send button for a Stop button so a run can be cancelled mid-response instead
   * of only ever waited out. */
  responding?: boolean;
  onSend: () => void;
  onStop: () => void;
  onStartVoice: () => void;
  onStopVoice: () => void;
}

const LINE_HEIGHT_PX = 22;
const MAX_LINES = 5;
const INPUT_VERTICAL_PADDING_PX = 28;
const MAX_INPUT_HEIGHT_PX = LINE_HEIGHT_PX * MAX_LINES + INPUT_VERTICAL_PADDING_PX;
const MAX_APP_RESULTS = 8;

const COMMANDS: SlashMenuItem[] = [
  { id: "open-app", icon: "ti-apps", label: "/open-app", sublabel: "Open an app on your computer" },
  { id: "agents-create", icon: "ti-robot", label: "/agents-create", sublabel: "Create a new agent" },
  { id: "settings", icon: "ti-settings", label: "/settings", sublabel: "Open settings" },
  { id: "knowledgebase", icon: "ti-books", label: "/knowledgebase", sublabel: "Open the knowledge base" },
  { id: "http-tools", icon: "ti-api", label: "/http-tools", sublabel: "Set up API endpoints as agent tools" },
  { id: "chat-history", icon: "ti-history", label: "/chat-history", sublabel: "Browse past messages and costs" },
  { id: "add-file", icon: "ti-file-plus", label: "/add-file", sublabel: "Add a file to the knowledge base" },
  { id: "add-folder", icon: "ti-folder-plus", label: "/add-folder", sublabel: "Attach a folder to the knowledge base" },
  { id: "system-stats", icon: "ti-adjustments", label: "/system-stats", sublabel: "Show current CPU/memory usage" },
  { id: "usage", icon: "ti-sparkles", label: "/usage", sublabel: "Show token usage summary" },
  { id: "tour", icon: "ti-route", label: "/tour", sublabel: "Replay the feature tour" },
];

export default function ChatInputBar({
  inputRef,
  agentName,
  listening,
  transcribing,
  voiceEnabled,
  agents,
  sendDisabled,
  sendDisabledReason,
  responding,
  onSend,
  onStop,
  onStartVoice,
  onStopVoice,
}: ChatInputBarProps) {
  const [hasText, setHasText] = useState(false);
  // Whether the chip can still act on the current value. Escape closes the menu without
  // clearing the input, so a bare "/" is left behind — keying this off hasText alone would
  // leave the chip dead until the field was cleared by hand.
  const [canOpenCommands, setCanOpenCommands] = useState(true);
  // Same predicate shape as canOpenCommands, mirrored for "@" — the two are mutually
  // exclusive by construction since a value starts with at most one of "/"/"@".
  const [canOpenAgents, setCanOpenAgents] = useState(true);
  const [slashMode, setSlashMode] = useState<"commands" | "apps" | "agents" | null>(null);
  const [slashQuery, setSlashQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { apps, launch } = useAppLauncher();

  // One command per directable agent (e.g. "/cipher") — selecting it inserts "Cipher, "
  // rather than a literal slash action, since the orchestrator already reliably hands
  // off based on a plain name mention in the message text (no new @mention syntax needed).
  const agentCommands: SlashMenuItem[] = useMemo(
    () =>
      agents.map((a) => ({
        id: `agent-${a.id}`,
        icon: a.icon,
        label: `/${slugifyAgentName(a.name)}`,
        sublabel: a.tagline ? `Direct this message to ${a.name} — ${a.tagline}` : `Direct this message to ${a.name}`,
        insertText: `${a.name}, `,
      })),
    [agents]
  );

  const allCommands = useMemo(() => [...COMMANDS, ...agentCommands], [agentCommands]);

  // Feeds the @ agent-mention menu — same insert-text shape as agentCommands above (plain
  // name mention, no @ sigil stored), but keyed by plain name instead of a /slug and tagged
  // with a group so the menu can render "System" / "Custom" headers.
  const directableAgentItems: SlashMenuItem[] = useMemo(
    () =>
      agents.map((a) => ({
        id: `mention-${a.id}`,
        icon: a.icon,
        label: a.name,
        sublabel: a.tagline,
        insertText: `${a.name}, `,
        group: a.system ? "System" : "Custom",
      })),
    [agents]
  );

  const commandItems = useMemo(
    () => allCommands.filter((c) => c.label.slice(1).toLowerCase().startsWith(slashQuery.toLowerCase())),
    [allCommands, slashQuery]
  );

  const appItems: SlashMenuItem[] = useMemo(
    () =>
      apps
        .filter((a) => a.name.toLowerCase().includes(slashQuery.toLowerCase()))
        .slice(0, MAX_APP_RESULTS)
        .map((a) => ({ id: a.id, icon: "ti-app-window", label: a.name })),
    [apps, slashQuery]
  );

  // System agents first, then Custom — directableAgentItems inherits DB insertion order from
  // `agents`, which has no explicit sort by `system`, so the grouping must sort explicitly or
  // the two groups could interleave and produce more than one header per group.
  const agentItems = useMemo(
    () =>
      directableAgentItems
        .filter((a) => a.label.toLowerCase().startsWith(slashQuery.toLowerCase()))
        .sort((a, b) => (a.group === b.group ? 0 : a.group === "System" ? -1 : 1)),
    [directableAgentItems, slashQuery]
  );

  const activeItems =
    slashMode === "apps"
      ? appItems
      : slashMode === "commands"
        ? commandItems
        : slashMode === "agents"
          ? agentItems
          : [];

  const resize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
    // KI-20: .input-top centers the field against the mic/send buttons by default — the
    // state the bar sits in almost all the time — and only bottom-aligns (.multi-line) once
    // the field has actually grown past one line, so the buttons stay pinned to the bottom
    // row as it grows rather than floating to a moving vertical center. Toggled here (not
    // React state) to match resize()'s own imperative, no-extra-render style; el.scrollHeight
    // right after the resize above is exactly one line's worth (LINE_HEIGHT_PX + the field's
    // own vertical padding) whenever the value hasn't wrapped, regardless of character count.
    el.closest(".input-top")?.classList.toggle("multi-line", el.scrollHeight > LINE_HEIGHT_PX + INPUT_VERTICAL_PADDING_PX);
  };

  const closeSlashMenu = () => {
    setSlashMode(null);
    setSlashQuery("");
    setSelectedIndex(0);
  };

  const parseSlashState = (value: string) => {
    const openAppMatch = value.match(/^\/open-app(?:\s+(.*))?$/i);
    if (openAppMatch) {
      setSlashMode("apps");
      setSlashQuery(openAppMatch[1] ?? "");
      setSelectedIndex(0);
      return;
    }
    if (value.startsWith("@") && !value.includes(" ")) {
      setSlashMode("agents");
      setSlashQuery(value.slice(1));
      setSelectedIndex(0);
      return;
    }
    if (value.startsWith("/") && !value.includes(" ")) {
      setSlashMode("commands");
      setSlashQuery(value.slice(1));
      setSelectedIndex(0);
      return;
    }
    closeSlashMenu();
  };

  const onInput = (e: FormEvent<HTMLTextAreaElement>) => {
    const value = e.currentTarget.value;
    setHasText(value.trim().length > 0);
    setCanOpenCommands(value.trim().length === 0 || value.startsWith("/"));
    setCanOpenAgents(value.trim().length === 0 || value.startsWith("@"));
    parseSlashState(value);
    resize();
  };

  const setInputValue = (value: string) => {
    const el = inputRef.current;
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };

  const selectSlashItem = (item: SlashMenuItem) => {
    if (slashMode === "commands") {
      setInputValue(item.insertText ?? `/${item.id} `);
      return;
    }
    if (slashMode === "agents") {
      setInputValue(item.insertText ?? `${item.label}, `);
      return;
    }
    if (slashMode === "apps") {
      launch(item.id);
      setInputValue("");
      setHasText(false);
      closeSlashMenu();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMode && activeItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % activeItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + activeItems.length) % activeItems.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        selectSlashItem(activeItems[selectedIndex]);
        return;
      }
    }
    if (e.key === "Escape" && slashMode) {
      closeSlashMenu();
      return;
    }
    // No app matched the typed query — swallow Enter rather than falling through to the
    // generic send path below, which would otherwise leak the literal "/open-app <query>"
    // text to the LLM as a normal chat message with no indication the command failed.
    if (slashMode === "apps" && activeItems.length === 0 && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Enter is swallowed rather than sent while an approval is pending — the button is
      // disabled, and the keyboard path has to agree with it.
      if (sendDisabled) return;
      onSend();
      setHasText(false);
      setCanOpenCommands(true);
      setCanOpenAgents(true);
      closeSlashMenu();
      resize();
    }
  };

  const handleSendClick = () => {
    if (sendDisabled) return;
    onSend();
    setHasText(false);
    setCanOpenCommands(true);
    setCanOpenAgents(true);
    closeSlashMenu();
    resize();
  };

  // The toolbar chip is a discovery shortcut for the same "/" prefix the keyboard path uses —
  // it reuses setInputValue so parseSlashState opens the menu off the synthetic input event,
  // rather than driving slashMode directly and giving the menu a second source of truth.
  // Re-sending an existing "/…" value is what lets the chip reopen a menu closed by Escape.
  // Disabled for anything else: parseSlashState only recognises "/" at the start of the
  // value, so inserting one mid-message would do nothing and replacing it would discard it.
  const openCommandMenu = () => {
    if (!canOpenCommands) return;
    const current = inputRef.current?.value ?? "";
    setInputValue(current.startsWith("/") ? current : "/");
  };

  // Same shortcut pattern as openCommandMenu, seeding "@" instead of "/".
  const openAgentMenu = () => {
    if (!canOpenAgents) return;
    const current = inputRef.current?.value ?? "";
    setInputValue(current.startsWith("@") ? current : "@");
  };

  return (
    <div id="bar">
      <div id="inp-wrap">
        {slashMode && (
          <SlashCommandMenu
            items={activeItems}
            selectedIndex={selectedIndex}
            emptyText={slashMode === "apps" ? "No matching apps found" : "Nothing found…"}
            onSelect={selectSlashItem}
            onHover={setSelectedIndex}
          />
        )}
        {/* Two-zone card: textarea + actions on top, toolbar below. The slash menu stays a
            sibling of the card rather than a child — the card clips its own corners with
            overflow:hidden, which would cut the menu off. */}
        <div className="input-card">
          <div className="input-top">
            <textarea
              id="inp"
              ref={inputRef}
              rows={1}
              placeholder={
                sendDisabled
                  ? sendDisabledReason === "question"
                    ? "Answer or cancel the question above to continue…"
                    : sendDisabledReason === "responding"
                      ? `Waiting for ${agentName} to finish…`
                      : "Approve or decline the request above to continue…"
                  : `Message ${agentName}… or / for commands`
              }
              autoComplete="off"
              disabled={sendDisabled}
              onInput={onInput}
              onKeyDown={onKeyDown}
            />
            <div id="inp-actions">
              {listening && (
                <div id="vwave" className="show">
                  <div className="vb" />
                  <div className="vb" />
                  <div className="vb" />
                  <div className="vb" />
                  <div className="vb" />
                </div>
              )}
              {voiceEnabled && (
                <IconButton
                  id="vbtn"
                  className={listening ? "listening" : transcribing ? "transcribing" : ""}
                  aria-label={transcribing ? "Transcribing…" : listening ? "Stop recording" : "Start recording"}
                  disabled={transcribing || sendDisabled}
                  onClick={listening ? onStopVoice : onStartVoice}
                >
                  <TablerIcon name={transcribing ? "ti-loader-2" : "ti-microphone"} />
                </IconButton>
              )}
              {responding ? (
                <IconButton id="sbtn" aria-label={`Stop ${agentName}`} onClick={onStop}>
                  <TablerIcon name="ti-player-stop" />
                </IconButton>
              ) : (
                hasText && (
                  <IconButton
                    id="sbtn"
                    aria-label={sendDisabled ? "Waiting for your approval" : "Send"}
                    disabled={sendDisabled}
                    onClick={handleSendClick}
                  >
                    <TablerIcon name="ti-arrow-up" />
                  </IconButton>
                )
              )}
            </div>
          </div>
          <div className="input-toolbar">
            <IconButton
              className="tb-chip"
              aria-label="Show slash commands"
              disabled={!canOpenCommands || sendDisabled}
              onClick={openCommandMenu}
            >
              <TablerIcon name="ti-terminal-2" />
              <span>Commands</span>
            </IconButton>
            <IconButton
              className="tb-chip"
              aria-label="Show agent mentions"
              disabled={!canOpenAgents || sendDisabled}
              onClick={openAgentMenu}
            >
              <TablerIcon name="ti-at" />
              <span>Agents</span>
            </IconButton>
          </div>
        </div>
        <p className="hint">{agentName} can make mistakes, please validate responses.</p>
      </div>
    </div>
  );
}
