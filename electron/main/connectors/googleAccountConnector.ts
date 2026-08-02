import { googleSettingsFields } from "./googleOAuth";
import type { ConnectorDefinition } from "./registry";

export const GOOGLE_ACCOUNT_CONNECTOR_ID = "google-account";

/** Holds the OAuth Client ID/Secret shared by every Google connector (Gmail, Calendar,
 * Drive, Contacts) — entered once here rather than once per service. Not itself
 * connectable: no OAuth flow, no tools, `credentialsOnly: true` so ConnectorsTab.tsx never
 * renders a Connect button for it. Each Google connector's `settingsSourceId` points here. */
export const googleAccountConnectorDefinition: ConnectorDefinition = {
  id: GOOGLE_ACCOUNT_CONNECTOR_ID,
  name: "Google Account",
  description: "Shared OAuth Client ID/Secret used by every Google connector below (Gmail, Calendar, Drive, Contacts).",
  icon: "ti-brand-google",
  authType: "apikey",
  settingsFields: googleSettingsFields,
  credentialsOnly: true,
  buildTools: () => [],
};
