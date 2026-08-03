/**
 * Explorer's tools — web search and page reading, backed by a local `open-websearch`
 * daemon (electron/main/ai/webSearchDaemon.ts). No API keys; the daemon scrapes public
 * search engines directly over loopback HTTP. See docs/http-api.md in the
 * open-websearch package for the response envelope these calls unwrap.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { callDaemon } from "../webSearchDaemon";

export const webSearchTool = tool({
  name: "web_search",
  description:
    "Search the public web for a short query (2-6 words work best) and get back a list of results (title, url, description). Use fetch_web_content afterward to read a specific result's full page text. Run multiple short, varied searches rather than one long query.",
  parameters: z.object({
    query: z.string().min(1).max(300).describe("A short search query, 2-6 words."),
    limit: z.number().int().min(1).max(50).optional().describe("Max results to return (default 10)."),
  }),
  execute: async ({ query, limit }) => {
    return callDaemon<{ results: unknown[] }>("/search", { query, limit });
  },
});

export const fetchWebContentTool = tool({
  name: "fetch_web_content",
  description:
    "Fetch a specific URL (e.g. one returned by web_search) and extract its readable text content. Use this to read the actual content of a page rather than relying on the search snippet alone.",
  parameters: z.object({
    // Plain z.string(), not z.string().url(): the .url() format annotation emits a
    // JSON Schema `format: "uri"` that some OpenRouter providers (e.g. Azure) reject
    // as an invalid function-parameter schema. The daemon itself validates the URL
    // server-side and returns a clear error if it's malformed, so nothing is lost.
    url: z.string().describe("The URL to fetch, including the http:// or https:// scheme."),
  }),
  execute: async ({ url }) => {
    return callDaemon<{ url: string; content: string }>("/fetch-web", { url });
  },
});
