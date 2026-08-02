import { useEffect, useRef, useState } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";
import Toggle from "@/components/atoms/Toggle";
import TagMultiSelect from "@/components/atoms/TagMultiSelect";
import DeleteConfirmModal from "@/components/molecules/DeleteConfirmModal";
import { DEFAULT_ORCHESTRATOR_MODEL } from "@/lib/settings";

interface AgentAccordionProps {
  icon: string;
  name: string;
  tagline?: string;
  description?: string;
  // Absent for the orchestrator row — its model now lives in Settings → AI Models → Chat,
  // since it's the same credential/model slot every agent's chat calls share by default.
  model?: string;
  prompt: string;
  promptLoading?: boolean;
  enabled: boolean;
  enabledLocked?: boolean;
  promptDisabled?: boolean;
  onChangeName: (name: string) => void;
  onChangeTagline?: (tagline: string) => void;
  onChangeDescription?: (description: string) => void;
  onChangeModel?: (model: string) => void;
  onChangePrompt?: (prompt: string) => void;
  onChangeEnabled: (enabled: boolean) => void;
  defaultOpen?: boolean;
  availableMcpServers?: McpServerRow[];
  mcpServerIds?: string[];
  onChangeMcpServerIds?: (ids: string[]) => void;
  availableConnectors?: ConnectorCatalogEntry[];
  connectorIds?: string[];
  onChangeConnectorIds?: (ids: string[]) => void;
  availableHttpToolCollections?: HttpToolCollectionRow[];
  httpToolCollectionIds?: string[];
  onChangeHttpToolCollectionIds?: (ids: string[]) => void;
  // Only passed for custom (non-system) agents — their absence is what hides the
  // export/delete buttons for the orchestrator and system agent rows.
  onExport?: () => void;
  onDelete?: () => void;
}

export default function AgentAccordion({
  icon,
  name,
  tagline,
  description,
  model,
  prompt,
  promptLoading,
  enabled,
  enabledLocked,
  promptDisabled,
  onChangeName,
  onChangeTagline,
  onChangeDescription,
  onChangeModel,
  onChangePrompt,
  onChangeEnabled,
  defaultOpen = false,
  availableMcpServers,
  mcpServerIds,
  onChangeMcpServerIds,
  availableConnectors,
  connectorIds,
  onChangeConnectorIds,
  availableHttpToolCollections,
  httpToolCollectionIds,
  onChangeHttpToolCollectionIds,
  onExport,
  onDelete,
}: AgentAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Name/tagline/description/model are buffered locally and only committed on blur —
  // binding the input directly to the prop meant every keystroke round-tripped through
  // the async save before the field could show the next character (the "dropping keys" bug).
  const [nameDraft, setNameDraft] = useState(name);
  const [taglineDraft, setTaglineDraft] = useState(tagline ?? "");
  const [descriptionDraft, setDescriptionDraft] = useState(description ?? "");
  const [modelDraft, setModelDraft] = useState(model ?? "");
  const [promptDraft, setPromptDraft] = useState(prompt);
  const nameFocused = useRef(false);
  const taglineFocused = useRef(false);
  const descriptionFocused = useRef(false);
  const modelFocused = useRef(false);
  const promptFocused = useRef(false);

  useEffect(() => {
    if (!nameFocused.current) setNameDraft(name);
  }, [name]);
  useEffect(() => {
    if (!taglineFocused.current) setTaglineDraft(tagline ?? "");
  }, [tagline]);
  useEffect(() => {
    if (!descriptionFocused.current) setDescriptionDraft(description ?? "");
  }, [description]);
  useEffect(() => {
    if (!modelFocused.current) setModelDraft(model ?? "");
  }, [model]);
  useEffect(() => {
    if (!promptFocused.current) setPromptDraft(prompt);
  }, [prompt]);

  return (
    <div className={`agent-accordion${enabled ? "" : " disabled"}`}>
      <div className="agent-accordion-header">
        <button
          className="agent-accordion-header-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <TablerIcon name="ti-chevron-right" className={`agent-accordion-chevron${open ? " open" : ""}`} />
          <TablerIcon name={icon} className="agent-accordion-icon" />
          <span className="agent-accordion-name">{name}</span>
        </button>
        <span className="agent-accordion-spacer" />
        <Toggle
          checked={enabled}
          onChange={onChangeEnabled}
          label={`Toggle ${name}`}
          disabled={enabledLocked}
        />
      </div>

      {onDelete && (
        <DeleteConfirmModal
          open={confirmingDelete}
          itemLabel={name}
          onConfirm={() => {
            setConfirmingDelete(false);
            onDelete();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      {open && (
        <div className="agent-accordion-body">
          {(onExport || onDelete) && (
            <div className="agent-accordion-actions">
              {onExport && (
                <button type="button" className="settings-action-btn-sm" onClick={onExport}>
                  <TablerIcon name="ti-download" />
                  Export
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  className="settings-action-btn-sm settings-action-btn-ghost"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <TablerIcon name="ti-trash" />
                  Delete
                </button>
              )}
            </div>
          )}
          <label className="settings-field">
            <span>Name</span>
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onFocus={() => (nameFocused.current = true)}
              onBlur={() => {
                nameFocused.current = false;
                if (nameDraft !== name) onChangeName(nameDraft);
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              autoComplete="off"
            />
          </label>
          {onChangeTagline !== undefined && (
            <label className="settings-field">
              <span>Tagline (2–3 words)</span>
              <input
                type="text"
                value={taglineDraft}
                onChange={(e) => setTaglineDraft(e.target.value)}
                onFocus={() => (taglineFocused.current = true)}
                onBlur={() => {
                  taglineFocused.current = false;
                  if (taglineDraft !== (tagline ?? "")) onChangeTagline(taglineDraft);
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                placeholder="e.g. App configuration"
                maxLength={40}
                autoComplete="off"
              />
            </label>
          )}
          {onChangeDescription !== undefined && (
            <label className="settings-field">
              <span>Description</span>
              <textarea
                className="agent-accordion-description"
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                onFocus={() => (descriptionFocused.current = true)}
                onBlur={() => {
                  descriptionFocused.current = false;
                  if (descriptionDraft !== (description ?? "")) onChangeDescription(descriptionDraft);
                }}
                placeholder="What does this agent do?"
                rows={3}
              />
            </label>
          )}
          {onChangeModel !== undefined && (
            <label className="settings-field">
              <span>Model ID</span>
              <input
                type="text"
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onFocus={() => (modelFocused.current = true)}
                onBlur={() => {
                  modelFocused.current = false;
                  if (modelDraft !== (model ?? "")) onChangeModel(modelDraft);
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                placeholder={DEFAULT_ORCHESTRATOR_MODEL}
                autoComplete="off"
              />
            </label>
          )}
          <label className="settings-field">
            <span>Prompt (Markdown){promptDisabled ? " — locked" : ""}</span>
            <textarea
              className="agent-accordion-prompt"
              value={promptLoading ? "Loading…" : promptDraft}
              onChange={(e) => onChangePrompt && setPromptDraft(e.target.value)}
              onFocus={() => (promptFocused.current = true)}
              onBlur={() => {
                promptFocused.current = false;
                if (onChangePrompt && promptDraft !== prompt) onChangePrompt(promptDraft);
              }}
              disabled={promptDisabled || promptLoading}
              readOnly={promptDisabled || !onChangePrompt}
              rows={8}
            />
          </label>
          {onChangeMcpServerIds !== undefined && (
            <div className="settings-field">
              <span>MCP Servers (tools available to this agent)</span>
              {(!availableMcpServers || availableMcpServers.length === 0) && (
                <p className="settings-empty">No MCP servers configured yet — add one in the MCP tab.</p>
              )}
              {availableMcpServers?.map((server) => {
                const checked = (mcpServerIds ?? []).includes(server.id);
                return (
                  <label key={server.id} className="mcp-server-checkbox-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const current = mcpServerIds ?? [];
                        const next = e.target.checked
                          ? [...current, server.id]
                          : current.filter((id) => id !== server.id);
                        onChangeMcpServerIds(next);
                      }}
                    />
                    <span>{server.name}</span>
                  </label>
                );
              })}
            </div>
          )}
          {onChangeConnectorIds !== undefined &&
            (() => {
              // Only connectors that are actually connected (credentials verified via
              // OAuth) and have their settings configured are offered here — an
              // unconnected catalog entry can't be attached to an agent, so it's left
              // out of the picker entirely rather than shown disabled.
              const readyConnectors = (availableConnectors ?? []).filter(
                (connector) => connector.status === "connected" && connector.settingsConfigured
              );
              return (
                <div className="settings-field">
                  <span>Connectors (services available to this agent)</span>
                  {readyConnectors.length === 0 && (
                    <p className="settings-empty">
                      No connectors ready yet — connect and configure one in the Connectors tab.
                    </p>
                  )}
                  {readyConnectors.length > 0 && (
                    <TagMultiSelect
                      values={connectorIds ?? []}
                      options={readyConnectors.map((connector) => ({ value: connector.id, label: connector.name }))}
                      onChange={onChangeConnectorIds}
                      ariaLabel="Add connector"
                      addLabel="Add connector"
                    />
                  )}
                </div>
              );
            })()}
          {onChangeHttpToolCollectionIds !== undefined &&
            (() => {
              // Only enabled collections are offered — a disabled one contributes no tools
              // at run time (see buildHttpToolsForCollectionIds), so attaching it would be
              // a silent no-op rather than a capability.
              const readyCollections = (availableHttpToolCollections ?? []).filter(
                (collection) => collection.enabled === 1
              );
              return (
                <div className="settings-field">
                  <span>HTTP Tools (APIs available to this agent)</span>
                  {readyCollections.length === 0 && (
                    <p className="settings-empty">
                      No APIs ready yet — add one in the HTTP Tools tab.
                    </p>
                  )}
                  {readyCollections.length > 0 && (
                    <TagMultiSelect
                      values={httpToolCollectionIds ?? []}
                      options={readyCollections.map((collection) => ({
                        value: collection.id,
                        label: collection.name,
                      }))}
                      onChange={onChangeHttpToolCollectionIds}
                      ariaLabel="Add API"
                      addLabel="Add API"
                    />
                  )}
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
}
