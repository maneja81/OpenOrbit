import {
  saveConnectorCredentials,
  getDecryptedSettings,
  type ConnectorCredentials,
} from "../db/connectorsStore";
import { refreshAccessToken, type OAuthConfig } from "./oauthFlow";
import { devLog } from "../devLog";
import type { ConnectorSettingsField } from "./registry";

// Expire 60s early so a token that's valid-but-about-to-expire never gets used for a
// request that then fails mid-flight.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export const googleSettingsFields: ConnectorSettingsField[] = [
  { key: "clientId", label: "OAuth Client ID", type: "text", required: true },
  { key: "clientSecret", label: "OAuth Client Secret", type: "password" },
  {
    key: "redirectUri",
    label: "Google Redirect URI",
    type: "readonly",
    defaultValue: "http://127.0.0.1",
  },
];

export function buildGoogleOAuthConfig(
  settings: Record<string, string> | null,
  scopes: string[],
  serviceName: string
): OAuthConfig {
  const clientId = settings?.clientId ?? "";
  if (!clientId) {
    throw new Error(
      `Google OAuth client ID isn't set — add it in Settings → Connectors before connecting ${serviceName}.`
    );
  }
  return {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes,
    clientId,
    clientSecret: settings?.clientSecret || undefined,
  };
}

/** Factory building an `ensureFreshCredentials` for a specific Google-based connector.
 * Refreshes the access token if it's expired (or about to), re-persisting the result so
 * the next call doesn't need to refresh again. Returns the credentials guaranteed usable
 * right now. No existing precedent in this codebase for an expiry-aware refresh-before-use
 * check — MCP/settings secrets are static values, not short-lived tokens.
 *
 * `connectorId` and `settingsSourceId` are deliberately separate: credentials (tokens) are
 * always stored under the connector's own id, but the clientId/secret needed to refresh
 * them may live under a different, shared id (see googleAccountConnector.ts) — same
 * settingsSourceId indirection the ipc/connectors.ts handlers use. */
export function makeEnsureFreshCredentials(
  connectorId: string,
  settingsSourceId: string,
  buildConfig: (settings: Record<string, string> | null) => OAuthConfig,
  serviceName: string
) {
  return async function ensureFreshCredentials(
    credentials: ConnectorCredentials
  ): Promise<ConnectorCredentials> {
    const isExpired =
      credentials.expiresAt !== undefined && Date.now() > credentials.expiresAt - EXPIRY_SAFETY_MARGIN_MS;
    if (!isExpired) return credentials;
    if (!credentials.refreshToken) {
      throw new Error(
        `${serviceName}'s access token expired and no refresh token is available — reconnect ${serviceName} in Settings.`
      );
    }
    devLog(`[googleOAuth] access token expired for ${connectorId}, refreshing`);
    const settings = getDecryptedSettings(settingsSourceId);
    const refreshed = await refreshAccessToken(buildConfig(settings), credentials.refreshToken);
    const next: ConnectorCredentials = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? credentials.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope ?? credentials.scope,
    };
    saveConnectorCredentials(connectorId, connectorId, next);
    return next;
  };
}
