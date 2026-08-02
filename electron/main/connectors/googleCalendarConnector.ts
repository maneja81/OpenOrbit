import { tool } from "@openai/agents";
import { z } from "zod";
import type { ConnectorCredentials } from "../db/connectorsStore";
import type { OAuthConfig } from "./oauthFlow";
import { buildGoogleOAuthConfig, makeEnsureFreshCredentials } from "./googleOAuth";
import { GOOGLE_ACCOUNT_CONNECTOR_ID } from "./googleAccountConnector";
import type { ConnectorDefinition } from "./registry";

export const GOOGLE_CALENDAR_CONNECTOR_ID = "google-calendar";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export function buildCalendarOAuthConfig(settings: Record<string, string> | null): OAuthConfig {
  return buildGoogleOAuthConfig(settings, CALENDAR_SCOPES, "Google Calendar");
}

export const ensureFreshCalendarCredentials = makeEnsureFreshCredentials(
  GOOGLE_CALENDAR_CONNECTOR_ID,
  GOOGLE_ACCOUNT_CONNECTOR_ID,
  buildCalendarOAuthConfig,
  "Google Calendar"
);

/** Calls GET /calendar/v3/users/me/calendarList and returns the first calendar's id as the
 * account label. Shared by testCalendarConnection (liveness check) and the connect flow. */
async function callCalendarList(accessToken: string): Promise<{ items: { id: string }[] }> {
  const response = await fetch(`${CALENDAR_API_BASE}/users/me/calendarList?maxResults=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google Calendar connection test failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as { items: { id: string }[] };
}

/** Makes a real live API call to verify credentials and returns the first calendar id as the
 * account label. Throws on any API failure — the caller decides whether that's fatal.
 * Handles token refresh automatically via ensureFreshCalendarCredentials. */
export async function testCalendarConnection(credentials: ConnectorCredentials): Promise<{ label?: string }> {
  const fresh = await ensureFreshCalendarCredentials(credentials);
  const data = await callCalendarList(fresh.accessToken);
  return { label: data.items[0]?.id };
}

function buildCalendarTools(credentials: ConnectorCredentials) {
  const listCalendarsTool = tool({
    name: "google_calendar_list_calendars",
    description: "List the calendars in the user's connected Google Calendar account.",
    parameters: z.object({}),
    execute: async () => {
      const fresh = await ensureFreshCalendarCredentials(credentials);
      const response = await fetch(`${CALENDAR_API_BASE}/users/me/calendarList`, {
        headers: { Authorization: `Bearer ${fresh.accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`Google Calendar list calendars failed (${response.status}): ${await response.text()}`);
      }
      const data = (await response.json()) as {
        items?: { id: string; summary: string; primary?: boolean }[];
      };
      return {
        calendars: (data.items ?? []).map((c) => ({ id: c.id, summary: c.summary, primary: c.primary ?? false })),
      };
    },
  });

  const listEventsTool = tool({
    name: "google_calendar_list_events",
    description: "List events on a calendar in the user's connected Google Calendar account.",
    parameters: z.object({
      calendarId: z.string().default("primary").describe("Calendar id to list events from (default 'primary')."),
      timeMin: z.string().optional().describe("ISO8601 lower bound on event start time."),
      timeMax: z.string().optional().describe("ISO8601 upper bound on event start time."),
      maxResults: z.number().int().min(1).max(50).default(10).describe("Max events to return (default 10)."),
      query: z.string().optional().describe("Free text search terms."),
    }),
    execute: async ({ calendarId, timeMin, timeMax, maxResults, query }) => {
      const fresh = await ensureFreshCalendarCredentials(credentials);
      const url = new URL(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
      if (timeMin) url.searchParams.set("timeMin", timeMin);
      if (timeMax) url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("maxResults", String(maxResults));
      if (query) url.searchParams.set("q", query);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${fresh.accessToken}` } });
      if (!response.ok) {
        throw new Error(`Google Calendar list events failed (${response.status}): ${await response.text()}`);
      }
      const data = (await response.json()) as {
        items?: {
          id: string;
          summary?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
          description?: string;
          location?: string;
          attendees?: { email: string }[];
        }[];
      };
      const events = (data.items ?? []).map((e) => ({
        id: e.id,
        summary: e.summary ?? "",
        start: e.start?.dateTime ?? e.start?.date ?? "",
        end: e.end?.dateTime ?? e.end?.date ?? "",
        description: e.description ?? "",
        location: e.location ?? "",
        attendees: (e.attendees ?? []).map((a) => a.email),
      }));
      return { events };
    },
  });

  const createEventTool = tool({
    name: "google_calendar_create_event",
    description: "Create an event on a calendar in the user's connected Google Calendar account.",
    parameters: z.object({
      calendarId: z.string().default("primary").describe("Calendar id to create the event on (default 'primary')."),
      summary: z.string().describe("Event title."),
      startDateTime: z.string().describe("Event start time, ISO8601."),
      endDateTime: z.string().describe("Event end time, ISO8601."),
      description: z.string().optional().describe("Event description."),
      attendeeEmails: z.array(z.string()).optional().describe("Email addresses to invite."),
    }),
    execute: async ({ calendarId, summary, startDateTime, endDateTime, description, attendeeEmails }) => {
      const fresh = await ensureFreshCalendarCredentials(credentials);
      const response = await fetch(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${fresh.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary,
            description,
            start: { dateTime: startDateTime },
            end: { dateTime: endDateTime },
            attendees: attendeeEmails?.map((email) => ({ email })),
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Google Calendar create event failed (${response.status}): ${await response.text()}`);
      }
      const data = (await response.json()) as { id: string; htmlLink: string };
      return { id: data.id, htmlLink: data.htmlLink };
    },
  });

  return [listCalendarsTool, listEventsTool, createEventTool];
}

export const googleCalendarConnectorDefinition: ConnectorDefinition = {
  id: GOOGLE_CALENDAR_CONNECTOR_ID,
  name: "Google Calendar",
  description: "List, search, and create events on the user's connected Google Calendar account.",
  icon: "ti-calendar",
  authType: "oauth2",
  settingsFields: [],
  settingsSourceId: GOOGLE_ACCOUNT_CONNECTOR_ID,
  buildOAuthConfig: buildCalendarOAuthConfig,
  buildTools: buildCalendarTools,
  testConnection: testCalendarConnection,
};
