import type { Tool } from "@openai/agents";
import type { ConnectorCredentials } from "../db/connectorsStore";
import type { OAuthConfig } from "./oauthFlow";
import { googleAccountConnectorDefinition } from "./googleAccountConnector";
import { gmailConnectorDefinition } from "./gmailConnector";
import { googleCalendarConnectorDefinition } from "./googleCalendarConnector";
import { googleDriveConnectorDefinition } from "./googleDriveConnector";
import { googleContactsConnectorDefinition } from "./googleContactsConnector";

/** One user-configurable field a connector needs (OAuth client id/secret, or any other
 * value a connector type requires) — rendered generically as a labeled input by the
 * Settings → Connectors UI, no per-connector UI code needed.
 *
 * type "readonly": a non-editable display field whose value comes from `defaultValue`
 * rather than the DB — used for informational fields like the OAuth redirect URI that
 * the user needs to copy into their provider's dashboard. Never saved to or read from
 * the connectors table. */
export interface ConnectorSettingsField {
  key: string;
  label: string;
  type: "text" | "password" | "readonly";
  required?: boolean;
  /** Static display value for type "readonly" fields. Shown in the UI as a copyable
   * read-only row; never persisted. */
  defaultValue?: string;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
  /** Tabler webfont glyph class (e.g. "ti-mail") — this app has no per-service image icon
   * system (see 0-cowork/reference/connectors' 296 SVG/PNG set, deliberately not pulled
   * in); every icon reference app-wide is a Tabler class string. */
  icon: string;
  /** "oauth2" connectors use the PKCE loopback OAuth flow (runOAuthFlow).
   * "apikey" connectors skip OAuth entirely — the user enters credentials directly in
   * Settings fields and buildCredentialsFromSettings maps them to ConnectorCredentials. */
  authType: "oauth2" | "apikey";
  /** Fields this connector needs the user to fill in before it can connect. Persisted
   * per-connector in the `connectors` table (see connectorsStore.getDecryptedSettings).
   * Fields with type "readonly" are display-only and are never saved. */
  settingsFields: ConnectorSettingsField[];
  /** If set, settings (and the settingsConfigured existence check) are read/written under
   * this id instead of the connector's own `id` — used by connectors that share one set of
   * OAuth credentials with sibling connectors (e.g. every Google connector points at
   * "google-account" so the user enters clientId/secret once). Credentials, status, and
   * tools remain keyed on the connector's own `id` regardless — only settings storage
   * redirects. */
  settingsSourceId?: string;
  /** True for an entry that exists only to hold shared settings for sibling connectors —
   * it has no OAuth flow or tools of its own and must never show a Connect/Disconnect
   * button (enforced in ConnectorsTab.tsx). */
  credentialsOnly?: boolean;
  /** Builds this connector's OAuth config from its own saved settings (client id/secret) —
   * a function rather than a static object since the client id/secret aren't known until
   * the user has entered them in Settings, and are passed in rather than read globally so
   * connectors don't need to know about the app-wide settings store.
   * Required for authType "oauth2"; unused for "apikey". */
  buildOAuthConfig?: (settings: Record<string, string> | null) => OAuthConfig;
  /** Builds the real @openai/agents tool() objects an agent gets once this connector is
   * attached, given this connector's live (possibly just-refreshed) credentials. */
  buildTools: (credentials: ConnectorCredentials) => Tool[];
  /** Makes a real live API call to verify the connector's credentials and returns the
   * user-facing account label (e.g. the Gmail address) if available. Throws on failure.
   * Used by connectors:test for a genuine liveness check, and called right after OAuth
   * by connectors:connect to capture the account label in one round-trip.
   * Optional — connectors that don't implement this fall back to a buildTools() check. */
  testConnection?: (credentials: ConnectorCredentials) => Promise<{ label?: string }>;
  /** Maps user-entered settings fields to ConnectorCredentials — required for authType
   * "apikey" connectors. The API key (or equivalent token) goes into `accessToken` so
   * the rest of the credential machinery (tool injection, expiry checks) works uniformly.
   * Not used by "oauth2" connectors. */
  buildCredentialsFromSettings?: (settings: Record<string, string>) => ConnectorCredentials;
}

/** Static connector catalog. Adding a new connector is: one new file exporting a
 * ConnectorDefinition (modeled on gmailConnector.ts) + one entry here — no other layer
 * (DB, IPC, agent wiring, Settings UI) needs to change per-connector. */
export const CONNECTOR_REGISTRY: ConnectorDefinition[] = [
  googleAccountConnectorDefinition,
  gmailConnectorDefinition,
  googleCalendarConnectorDefinition,
  googleDriveConnectorDefinition,
  googleContactsConnectorDefinition,
];

export function getConnectorDefinition(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_REGISTRY.find((c) => c.id === id);
}
