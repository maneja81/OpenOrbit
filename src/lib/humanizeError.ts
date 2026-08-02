export interface HumanizedError {
  title: string;
  message: string;
  nextSteps: string[];
}

const VALIDATION_PATTERNS = [/requires/i, /must be/i, /is required/i];

const BRIDGE_UNAVAILABLE_PATTERNS = [/bridge unavailable/i, /window\.agentsAPI/i];

/**
 * Electron wraps every rejected `ipcRenderer.invoke` as
 * `Error invoking remote method '<channel>': <ErrorName>: <message>`.
 *
 * That wrapper defeated the categories below, which is worse than it looks. `Access denied:` is
 * thrown by ipc/filesystem.ts and so always arrives wrapped — the startsWith check never matched,
 * and the user got the generic "Something went wrong" instead of the one message that tells them
 * what to actually do about it. Nearly every error this function sees comes over IPC.
 *
 * The plain `Error:` left behind is dropped too, since it says nothing. A named class
 * (`SqliteError:`) is kept — that one is worth showing.
 */
const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/;
const PLAIN_ERROR_PREFIX = /^Error:\s*/;

function unwrap(message: string): string {
  return message.replace(IPC_WRAPPER, "").replace(PLAIN_ERROR_PREFIX, "").trim();
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return unwrap(error.message);
  if (typeof error === "string") return unwrap(error);
  try {
    return unwrap(String(error));
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

/** Joins a HumanizedError into one string for surfaces that only render plain text.
 *
 * The message is punctuated before the next steps are appended — most come from a thrown Error
 * and end without any, which ran the two together: "database is locked Try again". */
export function formatHumanizedError(h: HumanizedError): string {
  if (h.nextSteps.length === 0) return `${h.title}: ${h.message}`;
  const message = /[.!?]$/.test(h.message.trim()) ? h.message.trim() : `${h.message.trim()}.`;
  return `${h.title}: ${message} ${h.nextSteps.join(" ")}`;
}
