/** A single settings/config change worth telling the user about in chat. Mirrors
 * `approvalSettledMessage.ts`'s shape: a pure `event(s) → string` formatter, no side effects. */
export type ConfigAckEvent =
  | { type: "file"; fileName: string }
  | { type: "location" }
  | { type: "connector"; label: string; agentNames: string[] };

const MAX_LISTED_EVENTS = 3;

function describe(event: ConfigAckEvent): string {
  switch (event.type) {
    case "file":
      return `I've got ${event.fileName}`;
    case "location":
      return "location is now enabled";
    case "connector": {
      // Zero agentNames means the connector isn't attached to anything yet — say so without
      // a dangling "with" clause that names nobody.
      const withAgents = event.agentNames.length > 0 ? ` with ${event.agentNames.join(", ")}` : "";
      return `${event.label} is now available${withAgents}`;
    }
  }
}

function joinPhrases(phrases: string[]): string {
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

/**
 * What to tell the user in chat after one or more config changes settle.
 *
 * Returns "" for an empty batch — the caller skips appending rather than posting a blank
 * bubble. A batch over MAX_LISTED_EVENTS is capped so a bulk file drop doesn't produce a
 * sentence naming twenty files; the remainder is summarized as a count instead.
 */
export function configAckMessage(events: ConfigAckEvent[]): string {
  if (events.length === 0) return "";
  const shown = events.slice(0, MAX_LISTED_EVENTS);
  const overflow = events.length - shown.length;
  const phrases = shown.map(describe);
  if (overflow > 0) phrases.push(`${overflow} more change${overflow === 1 ? "" : "s"}`);
  return `${joinPhrases(phrases)}. How can I help?`;
}

/**
 * Whether a batch of acks is worth persisting to chat history, not just showing live.
 *
 * A file or connector change is something the user will want to see again on reload — it
 * altered what the agent can do. A location-only batch is transient context, not worth
 * cluttering history the way `approvalSettledMessage` notices already are not persisted.
 */
export function shouldPersistConfigAck(events: ConfigAckEvent[]): boolean {
  return events.some((event) => event.type === "file" || event.type === "connector");
}
