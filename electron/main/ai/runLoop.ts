/**
 * Shared approval-interruption loop, extracted so the same semantics apply whether an agent
 * is run at the top level (electron/main/ipc/agent.ts, interactive) or nested inside another
 * agent's tool call (a specialist invoked via agentAsTool in ai/agents.ts) or headless
 * (electron/main/tasks/scheduler.ts). A `needsApproval` tool (Cipher's update_agent,
 * Chrono's create_task/update_task, any agent's approval-gated HTTP tool) stops a run with
 * `result.interruptions` populated — this loop is the one place that resolves those and
 * resumes, so every caller gets identical behavior instead of three hand-copied loops that
 * could quietly drift apart. The @openai/agents SDK's own `Agent.asTool()` does not resolve
 * (or expose) interruptions from its nested run at all — it just awaits the run to
 * completion and returns text — which is exactly the gap this file exists to close.
 */

/** The subset of a (possibly resumed) run result this loop actually needs — structural
 * rather than the SDK's concrete RunResult/StreamedRunResult types, since callers may be
 * looking at either depending on whether they stream. */
export interface ApprovableRunResult {
  interruptions?: unknown[];
  state: {
    // `any` rather than `unknown` deliberately: the SDK's real approve/reject take a concrete
    // `RunToolApprovalItem`, which is narrower than `unknown` — a structural type expecting
    // "accepts anything" isn't assignable from a function that only accepts that one type.
    // This interface exists to describe the shape generically across streaming/non-streaming
    // result types, not to police what an interruption item actually is.
    approve: (item: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
    reject: (item: any, details?: { message?: string }) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

/**
 * Runs `runOnce` against `initialInput`, then against `result.state` again for as many
 * rounds as the run keeps pausing on tool-approval interruptions, resolving each one via
 * `requestApproval`. Returns the first result with no outstanding interruptions, or `null`
 * if `isAborted` reports true at any point (a run that lost a timeout race, or a request
 * that was abandoned) — mirroring the existing `timedOut` short-circuit in ipc/agent.ts so
 * a caller can bail out without double-logging or resuming a run nobody is waiting on.
 *
 * `runOnce` is left to the caller (streaming + step-forwarding at the top level and for
 * nested specialist calls; a plain non-streaming `run()` for the headless scheduler) rather
 * than owned here, since those two shapes have nothing in common besides "produces an
 * ApprovableRunResult".
 */
export async function resolveApprovalsAndRun<TResult extends ApprovableRunResult>(
  runOnce: (input: unknown) => Promise<TResult>,
  initialInput: unknown,
  requestApproval: (item: unknown) => Promise<boolean>,
  isAborted?: () => boolean
): Promise<TResult | null> {
  let result = await runOnce(initialInput);
  for (;;) {
    if (isAborted?.()) return null;
    const interruptions = result.interruptions ?? [];
    if (interruptions.length === 0) return result;

    for (const interruption of interruptions) {
      const approved = await requestApproval(interruption);
      if (isAborted?.()) return null;
      if (approved) {
        result.state.approve(interruption);
      } else {
        result.state.reject(interruption, { message: "The user declined this call." });
      }
    }
    result = await runOnce(result.state);
  }
}
