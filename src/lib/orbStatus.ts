export interface CognitiveStateFlags {
  listening: boolean;
  transcribing: boolean;
  speaking: boolean;
  thinking: boolean;
  orchestratorResponding: boolean;
  hasActiveAgent: boolean;
}

/** The word shown under the orb's name. Ordered most-salient-first: voice states outrank
 * text states because the user can hear them happening, and `routing` outranks `composing`
 * since a hand-off in flight is more informative than "a reply is being written". Falls
 * back to "orchestrator" at idle, which is what the orb read before it went live. */
export function getCognitiveState(flags: CognitiveStateFlags): string {
  if (flags.listening) return "listening";
  if (flags.transcribing) return "processing";
  if (flags.speaking) return "speaking";
  if (flags.thinking) return "thinking";
  if (flags.orchestratorResponding) return flags.hasActiveAgent ? "routing" : "composing";
  return "orchestrator";
}

/** "3 messages · 12m" — either half is dropped when it has nothing to say (no messages
 * sent yet, or under a minute elapsed), so a fresh session renders "" rather than a
 * line of zeroes. */
export function formatSessionStats(userMsgCount: number, elapsedMs: number): string {
  const mins = Math.floor(elapsedMs / 60_000);
  const hrs = Math.floor(mins / 60);
  const parts = [
    userMsgCount > 0 ? `${userMsgCount} ${userMsgCount === 1 ? "message" : "messages"}` : null,
    hrs > 0 ? `${hrs}h ${mins % 60}m` : mins > 0 ? `${mins}m` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
