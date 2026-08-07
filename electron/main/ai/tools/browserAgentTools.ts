/**
 * Pilot's tools — controls a real, visible browser via browserSession.ts. Read/navigation
 * tools (navigate, snapshot, scroll, read page text, go back) run immediately; anything that
 * mutates a live page (click, type) pauses for the user's approval via the SDK's own
 * needsApproval interruption, same mechanism as agents.ts's updateAgentTool/
 * attachConnectorToAgentTool.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import {
  navigate,
  snapshot,
  clickRef,
  typeRef,
  scroll,
  readPageText,
  goBack,
  closeBrowserSession,
} from "../browserSession";

export const browserNavigateTool = tool({
  name: "browser_navigate",
  description:
    "Navigate the browser to a URL and return its title and final URL. Opens Pilot's browser window if it isn't already open. Call browser_snapshot afterward to see what's on the page.",
  parameters: z.object({
    // Plain z.string(), not z.string().url() — same OpenRouter/Azure schema-rejection
    // reasoning as fetchWebContentTool's url field.
    url: z.string().describe("The URL to navigate to, including the http:// or https:// scheme."),
  }),
  execute: async ({ url }) => navigate(url),
});

export const browserSnapshotTool = tool({
  name: "browser_snapshot",
  description:
    "Read the current page as an accessibility tree with short ref ids (e.g. [ref=e14]). Always call this before browser_click or browser_type — those tools take a ref from the most recent snapshot, never a guessed one. Call it again after any action that might have changed the page, so refs stay current.",
  parameters: z.object({}),
  execute: async () => snapshot(),
});

export const browserClickTool = tool({
  name: "browser_click",
  description:
    "Click an element by its ref from the most recent browser_snapshot (e.g. \"e14\"). Never invent a ref — call browser_snapshot first if you don't have a current one. Pauses for the user's explicit approval before it runs.",
  parameters: z.object({
    ref: z.string().describe("The element ref from the most recent browser_snapshot, e.g. \"e14\"."),
  }),
  needsApproval: async () => true,
  execute: async ({ ref }) => clickRef(ref),
});

export const browserTypeTool = tool({
  name: "browser_type",
  description:
    "Type text into an element by its ref from the most recent browser_snapshot, optionally pressing Enter to submit. Never invent a ref — call browser_snapshot first if you don't have a current one. Pauses for the user's explicit approval before it runs.",
  parameters: z.object({
    ref: z.string().describe("The element ref from the most recent browser_snapshot, e.g. \"e14\"."),
    text: z.string().describe("The text to type."),
    submit: z.boolean().optional().describe("Press Enter after typing (defaults to false)."),
  }),
  needsApproval: async () => true,
  execute: async ({ ref, text, submit }) => typeRef(ref, text, submit ?? false),
});

export const browserScrollTool = tool({
  name: "browser_scroll",
  description: "Scroll the current page up or down.",
  parameters: z.object({
    direction: z.enum(["up", "down"]),
    amount: z.number().int().positive().optional().describe("Pixels to scroll (defaults to 800)."),
  }),
  execute: async ({ direction, amount }) => scroll(direction, amount),
});

export const browserReadPageTextTool = tool({
  name: "browser_read_page_text",
  description:
    "Read the current page's full visible text content (for copying/scraping information), separate from browser_snapshot's interactive-element view.",
  parameters: z.object({}),
  execute: async () => readPageText(),
});

export const browserGoBackTool = tool({
  name: "browser_go_back",
  description: "Navigate the browser back to the previous page in its history.",
  parameters: z.object({}),
  execute: async () => goBack(),
});

export const browserCloseSessionTool = tool({
  name: "browser_close_session",
  description: "Close Pilot's browser window. It reopens automatically the next time a browser tool is used.",
  parameters: z.object({}),
  execute: async () => {
    await closeBrowserSession();
    return "Browser session closed.";
  },
});
