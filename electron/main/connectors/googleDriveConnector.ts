import { tool } from "@openai/agents";
import { z } from "zod";
import type { ConnectorCredentials } from "../db/connectorsStore";
import type { OAuthConfig } from "./oauthFlow";
import { buildGoogleOAuthConfig, makeEnsureFreshCredentials } from "./googleOAuth";
import { GOOGLE_ACCOUNT_CONNECTOR_ID } from "./googleAccountConnector";
import type { ConnectorDefinition } from "./registry";

export const GOOGLE_DRIVE_CONNECTOR_ID = "google-drive";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

const MAX_CONTENT_CHARS = 50_000;

export function buildDriveOAuthConfig(settings: Record<string, string> | null): OAuthConfig {
  return buildGoogleOAuthConfig(settings, DRIVE_SCOPES, "Google Drive");
}

export const ensureFreshDriveCredentials = makeEnsureFreshCredentials(
  GOOGLE_DRIVE_CONNECTOR_ID,
  GOOGLE_ACCOUNT_CONNECTOR_ID,
  buildDriveOAuthConfig,
  "Google Drive"
);

/** Calls GET /drive/v3/about?fields=user and returns the account's email as the label.
 * Shared by testDriveConnection (liveness check) and the connect flow. */
async function callDriveAbout(accessToken: string): Promise<{ user: { emailAddress: string } }> {
  const response = await fetch(`${DRIVE_API_BASE}/about?fields=user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google Drive connection test failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as { user: { emailAddress: string } };
}

/** Makes a real live API call to verify credentials and returns the account email as the
 * label. Throws on any API failure — the caller decides whether that's fatal. Handles
 * token refresh automatically via ensureFreshDriveCredentials. */
export async function testDriveConnection(credentials: ConnectorCredentials): Promise<{ label?: string }> {
  const fresh = await ensureFreshDriveCredentials(credentials);
  const data = await callDriveAbout(fresh.accessToken);
  return { label: data.user.emailAddress };
}

function buildDriveTools(credentials: ConnectorCredentials) {
  const searchFilesTool = tool({
    name: "google_drive_search_files",
    description: "Search files in the user's connected Google Drive using Drive query syntax.",
    parameters: z.object({
      query: z.string().describe("Drive query syntax, e.g. \"name contains 'report' and mimeType = 'application/pdf'\"."),
      maxResults: z.number().int().min(1).max(50).default(10).describe("Max files to return (default 10)."),
    }),
    execute: async ({ query, maxResults }) => {
      const fresh = await ensureFreshDriveCredentials(credentials);
      const url = new URL(`${DRIVE_API_BASE}/files`);
      url.searchParams.set("q", query);
      url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,size)");
      url.searchParams.set("pageSize", String(maxResults));
      const response = await fetch(url, { headers: { Authorization: `Bearer ${fresh.accessToken}` } });
      if (!response.ok) {
        throw new Error(`Google Drive search failed (${response.status}): ${await response.text()}`);
      }
      const data = (await response.json()) as {
        files?: { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string }[];
      };
      return { files: data.files ?? [] };
    },
  });

  const readFileTool = tool({
    name: "google_drive_read_file",
    description:
      "Read a file's text content from the user's connected Google Drive. Google Docs/Sheets/Slides are exported as plain text; other text-based files are downloaded directly. Binary files (images, PDFs, etc.) cannot be read this way.",
    parameters: z.object({
      fileId: z.string().describe("The Drive file id to read."),
    }),
    execute: async ({ fileId }) => {
      const fresh = await ensureFreshDriveCredentials(credentials);

      const metaResponse = await fetch(
        `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=mimeType,name`,
        { headers: { Authorization: `Bearer ${fresh.accessToken}` } }
      );
      if (!metaResponse.ok) {
        throw new Error(`Google Drive read file failed (${metaResponse.status}): ${await metaResponse.text()}`);
      }
      const meta = (await metaResponse.json()) as { mimeType: string; name: string };

      const isGoogleNative = meta.mimeType.startsWith("application/vnd.google-apps");
      const downloadUrl = isGoogleNative
        ? `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`
        : `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;

      const contentResponse = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${fresh.accessToken}` } });
      if (!contentResponse.ok) {
        if (!isGoogleNative && contentResponse.status === 400) {
          throw new Error(`This file type cannot be read as text (mimeType: ${meta.mimeType}).`);
        }
        throw new Error(`Google Drive read file failed (${contentResponse.status}): ${await contentResponse.text()}`);
      }
      const fullContent = await contentResponse.text();
      const truncated = fullContent.length > MAX_CONTENT_CHARS;
      const content = truncated ? fullContent.slice(0, MAX_CONTENT_CHARS) : fullContent;
      return { content, mimeType: meta.mimeType, truncated };
    },
  });

  const createFileTool = tool({
    name: "google_drive_create_file",
    description: "Create a new text file in the user's connected Google Drive.",
    parameters: z.object({
      name: z.string().describe("File name."),
      content: z.string().describe("Plain-text file content."),
      folderId: z.string().optional().describe("Parent folder id — defaults to Drive root."),
    }),
    execute: async ({ name, content, folderId }) => {
      const fresh = await ensureFreshDriveCredentials(credentials);
      const metadata = { name, parents: folderId ? [folderId] : undefined };
      const boundary = "drive_upload_boundary";
      const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `${content}\r\n` +
        `--${boundary}--`;

      const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webViewLink`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fresh.accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      });
      if (!response.ok) {
        throw new Error(`Google Drive create file failed (${response.status}): ${await response.text()}`);
      }
      const data = (await response.json()) as { id: string; name: string; webViewLink: string };
      return { id: data.id, name: data.name, webViewLink: data.webViewLink };
    },
  });

  return [searchFilesTool, readFileTool, createFileTool];
}

export const googleDriveConnectorDefinition: ConnectorDefinition = {
  id: GOOGLE_DRIVE_CONNECTOR_ID,
  name: "Google Drive",
  description: "Search, read, and create files in the user's connected Google Drive account.",
  icon: "ti-brand-google-drive",
  authType: "oauth2",
  settingsFields: [],
  settingsSourceId: GOOGLE_ACCOUNT_CONNECTOR_ID,
  buildOAuthConfig: buildDriveOAuthConfig,
  buildTools: buildDriveTools,
  testConnection: testDriveConnection,
};
