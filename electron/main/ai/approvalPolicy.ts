/** Which family of HTTP methods a request belongs to, for approval purposes. "read" covers
 * GET/HEAD and anything unrecognised — an unknown verb is treated as the least dangerous
 * option it could be, because the alternative is prompting on every call of a method we
 * simply failed to classify. */
export type ApprovalMethodGroup = "post" | "putPatch" | "delete" | "read";

/** The user's global answer to "what should pause and ask me?". Deliberately not stored
 * per collection or per endpoint: this is a posture ("ask before anything is deleted"),
 * not a property of one URL. */
export interface ApprovalPolicy {
  post: boolean;
  putPatch: boolean;
  delete: boolean;
}

export function methodGroup(method: string): ApprovalMethodGroup {
  switch (method.trim().toUpperCase()) {
    case "POST":
      return "post";
    case "PUT":
    case "PATCH":
      return "putPatch";
    case "DELETE":
      return "delete";
    default:
      return "read";
  }
}

/**
 * Whether a call with this method should pause and ask the user first.
 *
 * Reads never ask — a GET that quietly triggers something destructive is possible, but
 * prompting on every read to catch it would train the user to click through prompts, which
 * costs more safety than it buys.
 */
export function requiresApproval(method: string, policy: ApprovalPolicy): boolean {
  const group = methodGroup(method);
  if (group === "read") return false;
  return policy[group];
}
