import { tool } from "@openai/agents";
import { z } from "zod";
import type { ConnectorCredentials } from "../db/connectorsStore";
import type { OAuthConfig } from "./oauthFlow";
import { buildGoogleOAuthConfig, makeEnsureFreshCredentials } from "./googleOAuth";
import { GOOGLE_ACCOUNT_CONNECTOR_ID } from "./googleAccountConnector";
import type { ConnectorDefinition } from "./registry";

export const GMAIL_CONNECTOR_ID = "gmail";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];

export function buildGmailOAuthConfig(settings: Record<string, string> | null): OAuthConfig {
  return buildGoogleOAuthConfig(settings, GMAIL_SCOPES, "Gmail");
}

export const ensureFreshCredentials = makeEnsureFreshCredentials(
  GMAIL_CONNECTOR_ID,
  GOOGLE_ACCOUNT_CONNECTOR_ID,
  buildGmailOAuthConfig,
  "Gmail"
);

/** Calls GET /gmail/v1/users/me/profile and returns the account emailAddress.
 * Shared by testGmailConnection (liveness check) and the connect flow (account label). */
async function callGmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const response = await fetch(`${GMAIL_API_BASE}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Gmail connection test failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as { emailAddress: string };
}

/** Makes a real live API call to verify credentials and returns the Gmail address as the
 * account label. Throws on any API failure — the caller decides whether that's fatal.
 * Handles token refresh automatically via ensureFreshCredentials. */
export async function testGmailConnection(credentials: ConnectorCredentials): Promise<{ label?: string }> {
  const fresh = await ensureFreshCredentials(credentials);
  const profile = await callGmailProfile(fresh.accessToken);
  return { label: profile.emailAddress };
}

function buildRawEmail(to: string, subject: string, body: string): string {
  const message = [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
    "\r\n"
  );
  return Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildGmailTools(credentials: ConnectorCredentials) {
  const sendEmailTool = tool({
    name: "gmail_send_email",
    description: "Send an email from the user's connected Gmail account.",
    parameters: z.object({
      to: z.string().describe("Recipient email address."),
      subject: z.string().describe("Email subject line."),
      body: z.string().describe("Plain-text email body."),
    }),
    execute: async ({ to, subject, body }) => {
      const fresh = await ensureFreshCredentials(credentials);
      const response = await fetch(`${GMAIL_API_BASE}/messages/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fresh.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: buildRawEmail(to, subject, body) }),
      });
      if (!response.ok) {
        throw new Error(`Gmail send failed (${response.status}): ${await response.text()}`);
      }
      const data = (await response.json()) as { id: string };
      return `Email sent to ${to} (message id ${data.id}).`;
    },
  });

  const searchMessagesTool = tool({
    name: "gmail_search_messages",
    description:
      "Search the user's connected Gmail account using Gmail's query syntax (e.g. 'from:alice subject:invoice') and get back matching message subjects/senders/snippets.",
    parameters: z.object({
      query: z.string().describe("Gmail search query, e.g. 'from:alice is:unread'."),
      maxResults: z.number().int().min(1).max(25).optional().describe("Max messages to return (default 10)."),
    }),
    execute: async ({ query, maxResults }) => {
      const fresh = await ensureFreshCredentials(credentials);
      const listUrl = new URL(`${GMAIL_API_BASE}/messages`);
      listUrl.searchParams.set("q", query);
      listUrl.searchParams.set("maxResults", String(maxResults ?? 10));
      const listResponse = await fetch(listUrl, { headers: { Authorization: `Bearer ${fresh.accessToken}` } });
      if (!listResponse.ok) {
        throw new Error(`Gmail search failed (${listResponse.status}): ${await listResponse.text()}`);
      }
      const listData = (await listResponse.json()) as { messages?: { id: string }[] };
      const messages = listData.messages ?? [];

      const details = await Promise.all(
        messages.map(async (m) => {
          const detailUrl = new URL(`${GMAIL_API_BASE}/messages/${m.id}`);
          detailUrl.searchParams.set("format", "metadata");
          detailUrl.searchParams.set("metadataHeaders", "Subject");
          detailUrl.searchParams.append("metadataHeaders", "From");
          const detailResponse = await fetch(detailUrl, { headers: { Authorization: `Bearer ${fresh.accessToken}` } });
          if (!detailResponse.ok) return null;
          const detail = (await detailResponse.json()) as {
            id: string;
            snippet?: string;
            payload?: { headers?: { name: string; value: string }[] };
          };
          const headers = detail.payload?.headers ?? [];
          return {
            id: detail.id,
            subject: headers.find((h) => h.name === "Subject")?.value ?? "",
            from: headers.find((h) => h.name === "From")?.value ?? "",
            snippet: detail.snippet ?? "",
          };
        })
      );
      return { messages: details.filter(Boolean) };
    },
  });

  return [sendEmailTool, searchMessagesTool];
}

export const gmailConnectorDefinition: ConnectorDefinition = {
  id: GMAIL_CONNECTOR_ID,
  name: "Gmail",
  description: "Send and search email through the user's connected Gmail account.",
  icon: "ti-mail",
  authType: "oauth2",
  settingsFields: [],
  settingsSourceId: GOOGLE_ACCOUNT_CONNECTOR_ID,
  buildOAuthConfig: buildGmailOAuthConfig,
  buildTools: buildGmailTools,
  testConnection: testGmailConnection,
};
