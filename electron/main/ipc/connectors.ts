import { ipcMain } from "electron";
import {
  listConnectors,
  disconnectConnector,
  getDecryptedCredentials,
  getDecryptedSettings,
  saveConnectorSettings,
  saveConnectorCredentials,
} from "../db/connectorsStore";
import { CONNECTOR_REGISTRY, getConnectorDefinition, type ConnectorSettingsField } from "../connectors/registry";
import { runOAuthFlow } from "../connectors/oauthFlow";
import { devLog } from "../devLog";

export type { ConnectorRow } from "../db/connectorsStore";

export interface ConnectorCatalogEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: "connected" | "disconnected";
  accountLabel: string | null;
  settingsFields: ConnectorSettingsField[];
  /** True once any settings have been saved for this connector — a non-secret existence
   * check (no decryption) so Connect can be gated on "configured" without breaking the
   * "decrypt only right before use" rule the rest of this module follows. Reflects the
   * connector's settingsSourceId when set, since that's where its settings actually live. */
  settingsConfigured: boolean;
  /** True for an entry that only holds shared settings for sibling connectors — the
   * renderer must not show a Connect/Disconnect button for it. */
  credentialsOnly: boolean;
  /** Id of the entry this connector shares its settings with (ConnectorDefinition's
   * settingsSourceId), or null when it owns its own settings. Surfaced so the renderer can
   * group siblings under their shared-credentials parent instead of listing every Google
   * service at the top level. */
  settingsSourceId: string | null;
}

function buildCatalog(): ConnectorCatalogEntry[] {
  const connected = new Map(listConnectors().map((row) => [row.id, row]));
  return CONNECTOR_REGISTRY.map((def) => {
    const row = connected.get(def.id);
    const settingsRow = connected.get(def.settingsSourceId ?? def.id);
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      icon: def.icon,
      status: row?.status ?? "disconnected",
      accountLabel: row?.account_label ?? null,
      settingsFields: def.settingsFields,
      settingsConfigured: !!settingsRow?.has_settings,
      credentialsOnly: !!def.credentialsOnly,
      settingsSourceId: def.settingsSourceId ?? null,
    };
  });
}

export function registerConnectorHandlers() {
  ipcMain.handle("connectors:list", (): ConnectorCatalogEntry[] => buildCatalog());

  ipcMain.handle("connectors:connect", async (_event, id: string): Promise<ConnectorCatalogEntry[]> => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("connectors:connect requires a non-empty connector id");
    }
    const definition = getConnectorDefinition(id);
    if (!definition) {
      throw new Error(`Unknown connector: ${id}`);
    }

    if (definition.authType === "apikey") {
      // API-key connectors: build credentials from stored settings, no OAuth round-trip.
      if (!definition.buildCredentialsFromSettings) {
        throw new Error(
          `Connector "${id}" is authType "apikey" but has no buildCredentialsFromSettings — this is a connector implementation bug.`
        );
      }
      const settings = getDecryptedSettings(definition.settingsSourceId ?? id);
      if (!settings) {
        throw new Error(`Connector "${id}" has no saved settings — fill in the API key first.`);
      }
      const credentials = definition.buildCredentialsFromSettings(settings);
      let accountLabel: string | undefined;
      if (definition.testConnection) {
        const result = await definition.testConnection(credentials);
        accountLabel = result.label;
      }
      saveConnectorCredentials(definition.id, definition.id, credentials, accountLabel);
      devLog(`[connectors:connect] ${definition.id} connected (apikey)`);
      return buildCatalog();
    }

    // oauth2 path
    if (!definition.buildOAuthConfig) {
      throw new Error(
        `Connector "${id}" is authType "oauth2" but has no buildOAuthConfig — this is a connector implementation bug.`
      );
    }
    const config = definition.buildOAuthConfig(getDecryptedSettings(definition.settingsSourceId ?? id));
    const tokens = await runOAuthFlow(config);
    const credentials = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    };
    // Capture the account label (e.g. Gmail address) in the same round-trip as connect.
    // Non-fatal: label capture is best-effort; a failure here doesn't undo the connection.
    let accountLabel: string | undefined;
    if (definition.testConnection) {
      try {
        const result = await definition.testConnection(credentials);
        accountLabel = result.label;
      } catch {
        // intentionally swallowed — connection succeeded, label is just a nice-to-have
      }
    }
    saveConnectorCredentials(definition.id, definition.id, credentials, accountLabel);
    devLog(`[connectors:connect] ${definition.id} connected`);
    return buildCatalog();
  });

  ipcMain.handle("connectors:disconnect", (_event, id: string): ConnectorCatalogEntry[] => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("connectors:disconnect requires a non-empty connector id");
    }
    disconnectConnector(id);
    return buildCatalog();
  });

  // One-off validation of an already-stored credential, no OAuth round-trip and nothing
  // persisted beyond what connect already stored — mirrors testMcpServer's
  // "verify without committing anything new" precedent.
  ipcMain.handle("connectors:test", async (_event, id: string): Promise<{ ok: boolean; error?: string }> => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("connectors:test requires a non-empty connector id");
    }
    const definition = getConnectorDefinition(id);
    if (!definition) {
      throw new Error(`Unknown connector: ${id}`);
    }
    const credentials = getDecryptedCredentials(id);
    if (!credentials) {
      return { ok: false, error: "Not connected." };
    }
    try {
      if (definition.testConnection) {
        // Real live API call — verifies the token is accepted by the remote service.
        await definition.testConnection(credentials);
      } else {
        // Fallback: build tool objects in-process (no network, better than nothing).
        definition.buildTools(credentials);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("connectors:getSettings", (_event, id: string): Record<string, string> => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("connectors:getSettings requires a non-empty connector id");
    }
    const definition = getConnectorDefinition(id);
    if (!definition) {
      throw new Error(`Unknown connector: ${id}`);
    }
    return getDecryptedSettings(definition.settingsSourceId ?? id) ?? {};
  });

  ipcMain.handle(
    "connectors:saveSettings",
    (_event, id: string, settings: Record<string, string>): ConnectorCatalogEntry[] => {
      if (typeof id !== "string" || id.length === 0) {
        throw new Error("connectors:saveSettings requires a non-empty connector id");
      }
      const definition = getConnectorDefinition(id);
      if (!definition) {
        throw new Error(`Unknown connector: ${id}`);
      }
      if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
        throw new Error("connectors:saveSettings requires a plain object of settings");
      }
      const allKeys = new Set(definition.settingsFields.map((f) => f.key));
      // readonly fields are display-only and must never be persisted
      const mutableKeys = new Set(
        definition.settingsFields.filter((f) => f.type !== "readonly").map((f) => f.key)
      );
      for (const [key, value] of Object.entries(settings)) {
        if (!allKeys.has(key)) {
          throw new Error(`Unknown setting "${key}" for connector ${id}`);
        }
        if (typeof value !== "string") {
          throw new Error(`Setting "${key}" must be a string`);
        }
      }
      const mutableSettings = Object.fromEntries(
        Object.entries(settings).filter(([key]) => mutableKeys.has(key))
      );
      const settingsId = definition.settingsSourceId ?? definition.id;
      saveConnectorSettings(settingsId, settingsId, mutableSettings);
      return buildCatalog();
    }
  );
}
