import { ReactNode, useState } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";
import SettingsAccordion from "@/components/molecules/SettingsAccordion";
import { formatGroupStatus, groupConnectors } from "@/lib/connectorGroups";
import { useConnectors } from "@/hooks/useConnectors";

interface ConnectorsTabProps {
  connectors: ReturnType<typeof useConnectors>;
}

export default function ConnectorsTab({ connectors }: ConnectorsTabProps) {
  const { connectors: catalog, connectingId, error, connect, disconnect, getSettings, saveSettings } = connectors;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleEdit = async (connector: ConnectorCatalogEntry) => {
    setEditingId(connector.id);
    setSettingsValues(await getSettings(connector.id));
  };

  const handleToggle = (connector: ConnectorCatalogEntry, open: boolean) => {
    if (open) {
      handleEdit(connector);
    } else {
      setEditingId(null);
      setSettingsValues({});
    }
  };

  const handleSave = async (id: string) => {
    setSaving(true);
    await saveSettings(id, settingsValues);
    setSaving(false);
    setEditingId(null);
    setSettingsValues({});
  };

  const statusLabel = (connector: ConnectorCatalogEntry): string =>
    connector.status === "connected" && connector.accountLabel ? ` — ${connector.accountLabel}` : "";

  const connectButton = (connector: ConnectorCatalogEntry): ReactNode =>
    connector.status === "connected" ? (
      <button
        className="settings-action-btn-sm"
        onClick={() => disconnect(connector.id)}
      >
        Disconnect
      </button>
    ) : (
      <button
        className="settings-action-btn-sm settings-action-btn-primary"
        onClick={() => connect(connector.id)}
        disabled={connectingId === connector.id || !connector.settingsConfigured}
        title={!connector.settingsConfigured ? "Fill in this connector's settings before connecting" : undefined}
      >
        {connectingId === connector.id ? "Connecting…" : "Connect"}
      </button>
    );

  const settingsForm = (connector: ConnectorCatalogEntry): ReactNode => (
    <>
      {connector.settingsFields.map((field) => {
        if (field.type === "readonly") {
          return (
            <label className="settings-field" key={field.key}>
              <span>{field.label}</span>
              <div className="settings-field-readonly-row">
                <input type="text" readOnly value={field.defaultValue ?? ""} className="settings-field-readonly" />
                <button
                  type="button"
                  className="settings-action-btn-sm"
                  onClick={() => navigator.clipboard.writeText(field.defaultValue ?? "")}
                >
                  Copy
                </button>
              </div>
            </label>
          );
        }
        return (
          <label className="settings-field" key={field.key}>
            <span>{field.label}</span>
            <input
              type={field.type}
              value={settingsValues[field.key] ?? ""}
              onChange={(e) => setSettingsValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              autoComplete="off"
            />
          </label>
        );
      })}
      {!connector.settingsConfigured && (
        <p className="settings-hint">Required settings must be filled in before you can connect.</p>
      )}
      <div className="settings-form-actions">
        <button
          className="settings-action-btn settings-action-btn-primary"
          onClick={() => handleSave(connector.id)}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          className="settings-action-btn-sm settings-action-btn-ghost"
          onClick={() => {
            setEditingId(null);
            setSettingsValues({});
          }}
        >
          Cancel
        </button>
      </div>
    </>
  );

  const renderConnector = (connector: ConnectorCatalogEntry): ReactNode => {
    if (connector.settingsFields.length === 0) {
      return (
        <div className="agent-accordion" key={connector.id}>
          <div className="agent-accordion-header">
            <span className="agent-accordion-header-toggle" style={{ cursor: "default" }}>
              <TablerIcon name={connector.icon} className="agent-accordion-icon" />
              <span className="agent-accordion-name" title={connector.description}>
                {connector.name}
                {statusLabel(connector)}
              </span>
            </span>
            <span className="agent-accordion-spacer" />
            {/* Same credentialsOnly guard as the two paths below. An entry that only holds
                shared settings for its siblings has nothing to connect to — the type's own
                doc comment states no Connect/Disconnect button should be shown for it, and
                this path was the one place that didn't honour it. Not reachable today
                (google-account, the only such connector, has settings fields so it takes
                the accordion path), so this keeps a documented invariant true rather than
                fixing a live defect. */}
            {connector.credentialsOnly ? null : connectButton(connector)}
          </div>
        </div>
      );
    }

    return (
      <SettingsAccordion
        key={connector.id}
        icon={connector.icon}
        title={`${connector.name}${statusLabel(connector)}`}
        headerActions={connector.credentialsOnly ? undefined : connectButton(connector)}
        open={editingId === connector.id}
        onToggle={(open) => handleToggle(connector, open)}
      >
        {settingsForm(connector)}
      </SettingsAccordion>
    );
  };

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>Connectors</h3>
      </div>

      <p className="settings-hint">
        Connect a third-party service so agents can use it as a tool (e.g. sending email through Gmail). Attach a
        connected service to specific agents in the Agents tab — services aren't available to every agent by
        default.
      </p>

      <div className="agent-accordion-list">
        {catalog.length === 0 && <p className="settings-empty">No connectors available.</p>}
        {groupConnectors(catalog).map((item) => {
          if (item.kind === "single") return renderConnector(item.connector);

          // Services that share this parent's credentials live inside its body rather than
          // as top-level rows — the collapsed header carries their connected count.
          const { parent, children } = item;
          return (
            <SettingsAccordion
              key={parent.id}
              icon={parent.icon}
              title={`${parent.name} — ${formatGroupStatus(children)}`}
              headerActions={parent.credentialsOnly ? undefined : connectButton(parent)}
              open={editingId === parent.id}
              onToggle={(open) => handleToggle(parent, open)}
            >
              {parent.settingsFields.length > 0 && settingsForm(parent)}
              <div className="connector-service-list">
                {children.map((child) => (
                  <div className="connector-service-row" key={child.id}>
                    <span className="connector-service-label">
                      <TablerIcon name={child.icon} />
                      <span className="connector-service-name" title={child.description}>
                        {child.name}
                        {statusLabel(child)}
                      </span>
                    </span>
                    {connectButton(child)}
                  </div>
                ))}
              </div>
            </SettingsAccordion>
          );
        })}
      </div>

      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}
