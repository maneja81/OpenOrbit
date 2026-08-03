import type { SettingsSection } from "@/components/organisms/SettingsPanel";

export interface TourStep {
  element: string;
  title: string;
  description: string;
  /** Section to switch Settings to before this step highlights, if the step targets something inside Settings. */
  settingsSection?: SettingsSection;
}

/**
 * Ordered by discoverability, not implementation order. Every `element` must be a stable
 * `id` selector (see CLAUDE.md Tour Conventions) — `skipMissingElement: true` in useTour
 * means a broken selector fails silently, so tourSteps.test.ts guards the id contract.
 *
 * Six targets are conditional and rely on that skip behavior:
 *  - #vbtn                — only rendered when voice is enabled (ChatInputBar)
 *  - #ag-configAgent      — only rendered while the Cipher system agent is enabled (useAgents)
 *  - #agent-activity-feed — inside the Agent Activity & Usage widget, so it disappears while
 *                           that card is collapsed (StepFeed also renders nothing with no steps)
 *  - #message-cost        — only exists once a reply with logged token usage is on screen, so
 *                           it is absent for a brand-new user who hasn't sent anything yet.
 *                           Kept in the tour for the returning-user case (the tour can be
 *                           replayed from Settings), where a costed reply is present.
 *  - #code-block-copy     — only exists once a reply containing a fenced code block is in the
 *                           live log. Assigned by ChatPanel, not ChatBubble, so the history
 *                           modal rendering the same component over the panel can't duplicate
 *                           the id.
 *  - #chat-history-link   — the log keeps the last 10 messages, so this only appears once the
 *                           conversation is longer than that (ChatPanel). Same returning-user
 *                           reasoning as #message-cost. It sits in the always-visible chat
 *                           area, not inside a panel, so it is conditional rather than
 *                           unreachable — the rule it must not break is the one below.
 *
 * A target must exist without the tour opening anything for it. driver.js picks the next
 * step by scanning ahead with a skip predicate and never fires onHighlightStarted for a step
 * it skips — so a step cannot open its own container. That is why the Settings steps
 * re-target #setbtn (always present) and switch tabs behind it, rather than pointing inside
 * the panel. A step aimed inside a modal is silently unreachable; tourSteps.test.ts guards it.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    element: "#orchestrator",
    title: "Meet your agent",
    description:
      "This is your AI orchestrator. Talk to them by chat or voice — the line under the name tracks what they're doing right now.",
  },
  {
    element: "#ag-configAgent",
    title: "Your specialist agents",
    description:
      "Each orbiting node is a specialist. Your orchestrator hands work to whichever one fits the request, and you can add your own.",
  },
  {
    element: "#chat",
    title: "Chat panel",
    description: "Type a message and press Enter to send. Shift+Enter adds a new line.",
  },
  {
    element: "#chat-history-link",
    title: "Older messages",
    description:
      "The log keeps the last ten messages so the orbit stays visible. Everything before that is one click away, with what each reply cost.",
  },
  {
    element: "#inp",
    title: "Slash commands",
    description:
      "Type / and scroll the menu — there are more commands than fit on screen, and each explains itself on the right. Open apps, browse past chats and costs, or manage knowledge. Type @ to mention one agent directly.",
  },
  {
    element: "#vbtn",
    title: "Voice input",
    description: "Press the mic to speak instead of type. Your message is transcribed and answered in real time.",
  },
  {
    element: "#widget-token-usage",
    title: "Activity & usage",
    description:
      "Track tokens and cost by day, week, or month — and watch each agent action appear live at the bottom while a run is in progress.",
  },
  {
    element: "#agent-activity-feed",
    title: "Live agent activity",
    description:
      "Every hand-off and tool call your agents actually make lands here as it happens, with how long each one took.",
  },
  {
    element: "#message-cost",
    title: "What each reply cost",
    description:
      "Every answer shows the tokens it used and what it cost, counted from the real model calls behind that turn.",
  },
  {
    element: "#code-block-copy",
    title: "Copy code",
    description:
      "Code in a reply gets its own block with the language and a copy button, so you can lift it straight into an editor.",
  },
  {
    element: "#widget-system-status",
    title: "System status",
    description: "Live CPU, memory, and disk readings, so you always know what your machine is doing.",
  },
  {
    element: "#widget-knowledge",
    title: "Knowledge base",
    description:
      "Drop in files, attach folders from your computer, or save a web page. Agents read only what you add here, and folders stay where they are — nothing is copied.",
  },
  {
    element: "#widget-tasks",
    title: "Tasks & reminders",
    description: "Scheduled tasks and reminders live here — review, pause, or delete them any time.",
  },
  {
    element: "#setbtn",
    title: "Settings",
    description: "Customize your agent's name, model, voice, and sounds.",
    settingsSection: "models",
  },
  {
    // Same #setbtn re-targeting as the step above. The orbs introduce the agents; this is
    // where they are actually configured, renamed, added and removed.
    element: "#setbtn",
    title: "Configure your agents",
    description:
      "Add your own agents or reshape the built-in ones — each gets its own model, instructions, and set of tools it may use.",
    settingsSection: "agents",
  },
  {
    // Deliberately re-targets #setbtn: same button, different settingsSection, so the
    // panel visibly switches tabs rather than the highlight jumping elsewhere.
    element: "#setbtn",
    title: "About you",
    description:
      "Change your name and the preferences onboarding asked about — your agents use these to pitch every answer.",
    settingsSection: "general",
  },
  {
    element: "#setbtn",
    title: "Connect your tools",
    description: "Link Gmail, Google Calendar, and more from the Connectors tab in Settings.",
    settingsSection: "connectors",
  },
  {
    // Same #setbtn re-targeting as the steps above. Sits next to Connectors because both
    // answer "where do my agents get more tools from".
    element: "#setbtn",
    title: "Attach tool servers",
    description:
      "MCP servers give your agents whole toolkits at once. Attach one, pick which agents may use it, and its tools appear alongside the built-ins.",
    settingsSection: "mcp",
  },
  {
    // Same #setbtn re-targeting as the steps above — a step cannot open its own container.
    element: "#setbtn",
    title: "Turn APIs into tools",
    description:
      "Point your agents at any HTTP API. Give an endpoint a name and parameters, and they can call it — with your approval first, for anything that writes.",
    settingsSection: "http",
  },
  {
    // Same #setbtn re-targeting as the steps above. The widget step covers adding things; this
    // covers the review-and-revoke side, which only exists in Settings.
    element: "#setbtn",
    title: "Review agent access",
    description:
      "The Knowledge tab lists every folder and document your agents can read, and takes access away again in one click.",
    settingsSection: "files",
  },
  {
    // Last of the #setbtn steps — cosmetic rather than functional, so it comes after
    // everything that changes what the agents can actually do.
    element: "#setbtn",
    title: "Pick your sounds",
    description: "Every sound the app makes has a few variations. Try them and keep the set you like, or turn them off.",
    settingsSection: "sounds",
  },
  {
    // Targets the status-bar button rather than the panel, so no settingsSection is needed —
    // the button itself is what the user needs to find.
    element: "#aboutbtn",
    title: "Version and licenses",
    description: "Check the app version, storage use, and third-party licenses any time.",
  },
  {
    // Stays last: it tells the user how to get back here, which only lands once they have
    // seen what "here" is.
    element: "#tourbtn",
    title: "Replay this tour",
    description: "Tap the question mark any time to see this again — or type /tour in chat.",
  },
];
