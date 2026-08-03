/** The fields the renderer's activity feed needs from one SDK RunItem. Every field is
 * optional because extraction is best-effort: the feed degrades to the generic label
 * rather than the run failing. */
export interface RunItemMeta {
  toolName?: string;
  agentName?: string;
  callId?: string;
}

/** An empty tool name would humanize to an empty label downstream (humanizeToolName
 * splits on "_" and filters), so blanks are dropped here rather than rendered. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Pulls the tool name, calling agent, and call id off a run item. Ducks-types rather than
 * importing every SDK item subtype, for the same reason describeRunItem in ipc/agent.ts
 * does: the shape varies by item type (function call vs handoff vs message). Held to the
 * same contract — must never throw and never affect the actual run.
 */
export function extractRunItemMeta(item: unknown): RunItemMeta {
  try {
    const anyItem = item as {
      rawItem?: { name?: unknown; callId?: unknown };
      agent?: { name?: unknown };
    };
    const meta: RunItemMeta = {};
    const toolName = nonEmptyString(anyItem?.rawItem?.name);
    if (toolName) meta.toolName = toolName;
    const agentName = nonEmptyString(anyItem?.agent?.name);
    if (agentName) meta.agentName = agentName;
    const callId = nonEmptyString(anyItem?.rawItem?.callId);
    if (callId) meta.callId = callId;
    return meta;
  } catch {
    return {};
  }
}

/** What the renderer shows a user when a tool call is waiting on their approval. Extends
 * RunItemMeta with the call's arguments, since "approve this?" is unanswerable without
 * seeing what is actually being sent. */
export interface ApprovalMeta extends RunItemMeta {
  /** The tool call's raw JSON argument string, when the SDK exposes one. */
  args?: string;
}

/**
 * Pulls the displayable details off a RunToolApprovalItem. Same never-throw, duck-typed
 * contract as extractRunItemMeta — an approval prompt missing its argument preview is a
 * degraded prompt, but a throw here would strand a run that is already paused waiting for
 * a human.
 */
export function extractApprovalMeta(item: unknown): ApprovalMeta {
  try {
    const meta: ApprovalMeta = extractRunItemMeta(item);
    const args = (item as { rawItem?: { arguments?: unknown } })?.rawItem?.arguments;
    const argsText = nonEmptyString(args);
    if (argsText) meta.args = argsText;
    return meta;
  } catch {
    return {};
  }
}
