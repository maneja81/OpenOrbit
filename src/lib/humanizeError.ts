export interface HumanizedError {
  title: string;
  message: string;
  nextSteps: string[];
}

const VALIDATION_PATTERNS = [/requires/i, /must be/i, /is required/i];

const BRIDGE_UNAVAILABLE_PATTERNS = [/bridge unavailable/i, /window\.agentsAPI/i];

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return String(error);
  } catch {
    return "Unknown error";
  }
}

/** Converts any thrown value into a human-tone title/message/next-steps triple.
 * Never throws — unrecognized input always falls through to the generic category. */
export function humanizeError(error: unknown): HumanizedError {
  const msg = rawMessage(error);

  if (msg.startsWith("Access denied:")) {
    return {
      title: "Access denied",
      message: "That location isn't in a folder Orbit is allowed to access.",
      nextSteps: ["Add the folder under Settings > Folders, then try again."],
    };
  }

  if (BRIDGE_UNAVAILABLE_PATTERNS.some((p) => p.test(msg))) {
    return {
      title: "App isn't fully loaded",
      message: "OpenOrbit's native bridge isn't ready yet, so this action can't run.",
      nextSteps: ["Wait a moment and try again, or restart the app if it persists."],
    };
  }

  if (VALIDATION_PATTERNS.some((p) => p.test(msg))) {
    return {
      title: "Something's missing",
      message: msg,
      nextSteps: ["Check the input and try again."],
    };
  }

  if (/timed out/i.test(msg)) {
    return {
      title: "Request timed out",
      message: msg,
      nextSteps: ["Check the URL is reachable and try again."],
    };
  }

  return {
    title: "Something went wrong",
    message: msg,
    nextSteps: ["Try again, and let us know if it keeps happening."],
  };
}

/** Joins a HumanizedError into one string for surfaces that only render plain text. */
export function formatHumanizedError(h: HumanizedError): string {
  const steps = h.nextSteps.length > 0 ? ` ${h.nextSteps.join(" ")}` : "";
  return `${h.title}: ${h.message}${steps}`;
}
