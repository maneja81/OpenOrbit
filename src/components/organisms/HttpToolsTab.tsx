import { useState } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";
import Toggle from "@/components/atoms/Toggle";
import { AgentsSettings } from "@/lib/settings";
import SettingsAccordion from "@/components/molecules/SettingsAccordion";
import DeleteConfirmModal from "@/components/molecules/DeleteConfirmModal";
import HttpToolForm from "@/components/molecules/HttpToolForm";
import {
  coerceSampleArgs,
  formatToolCountLabel,
  willAskApproval,
  headersToText,
  isWriteMethod,
  parseHeaders,
  EMPTY_TOOL_DRAFT,
  type HttpToolDraft,
} from "@/lib/httpToolsFormat";
import { useHttpTools } from "@/hooks/useHttpTools";

interface HttpToolsTabProps {
  httpTools: ReturnType<typeof useHttpTools>;
  /** Only read, never written: the approval controls moved to Privacy & Safety, but the
   * per-endpoint "Asks first" badges below are genuinely context for the tools themselves. */
  settings: AgentsSettings;
}

interface CollectionDraft {
  name: string;
  description: string;
  baseUrl: string;
  headersText: string;
  allowPrivateHosts: boolean;
}

const EMPTY_COLLECTION_DRAFT: CollectionDraft = {
  name: "",
  description: "",
  baseUrl: "",
  headersText: "",
  allowPrivateHosts: false,
};

export default function HttpToolsTab({ httpTools, settings }: HttpToolsTabProps) {
  const approvalPolicy = {
    post: settings.httpToolApprovalPost,
    putPatch: settings.httpToolApprovalPutPatch,
    delete: settings.httpToolApprovalDelete,
  };
  const {
    collections,
    toolsForCollection,
    error,
    addCollection,
    updateCollection,
    removeCollection,
    addTool,
    updateTool,
    removeTool,
    getCollectionHeaders,
    getToolHeaders,
    testTool,
  } = httpTools;

  const [openId, setOpenId] = useState<string | null>(null);
  const [addingCollection, setAddingCollection] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState<CollectionDraft>(EMPTY_COLLECTION_DRAFT);
  const [savingCollection, setSavingCollection] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ kind: "collection" | "tool"; id: string; label: string } | null>(
    null
  );

  const [toolDraft, setToolDraft] = useState<HttpToolDraft | null>(null);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [draftCollectionId, setDraftCollectionId] = useState<string | null>(null);
  const [savingTool, setSavingTool] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<HttpToolTestResult | null>(null);

  const resetToolForm = () => {
    setToolDraft(null);
    setEditingToolId(null);
    setDraftCollectionId(null);
    setTestResult(null);
  };

  const handleToggleCollection = async (collection: HttpToolCollectionRow, open: boolean) => {
    resetToolForm();
    if (!open) {
      setOpenId(null);
      return;
    }
    setOpenId(collection.id);
    // Headers are stored encrypted and only decrypted on explicit request, so the edit form
    // has to fetch them when the row actually opens.
    setCollectionDraft({
      name: collection.name,
      description: collection.description,
      baseUrl: collection.base_url,
      headersText: headersToText(await getCollectionHeaders(collection.id)),
      allowPrivateHosts: collection.allow_private_hosts === 1,
    });
  };

  const handleSaveCollection = async (id: string | null) => {
    if (!collectionDraft.name.trim() || !collectionDraft.baseUrl.trim()) return;
    setSavingCollection(true);
    const payload = {
      name: collectionDraft.name,
      description: collectionDraft.description,
      baseUrl: collectionDraft.baseUrl,
      headers: parseHeaders(collectionDraft.headersText),
      allowPrivateHosts: collectionDraft.allowPrivateHosts,
    };
    if (id) {
      await updateCollection(id, payload);
    } else {
      await addCollection(payload);
      setAddingCollection(false);
      setCollectionDraft(EMPTY_COLLECTION_DRAFT);
    }
    setSavingCollection(false);
  };

  const handleEditTool = async (tool: HttpToolRow) => {
    setEditingToolId(tool.id);
    setDraftCollectionId(tool.collection_id);
    setTestResult(null);
    setToolDraft({
      name: tool.name,
      description: tool.description,
      method: tool.method,
      path: tool.path,
      headers: await getToolHeaders(tool.id),
      bodyTemplate: tool.body_template,
      params: JSON.parse(tool.params) as HttpToolParam[],
    });
  };

  const handleSaveTool = async (collectionId: string) => {
    if (!toolDraft || !toolDraft.name.trim()) return;
    setSavingTool(true);
    if (editingToolId) {
      await updateTool(editingToolId, toolDraft);
    } else {
      await addTool({ collectionId, ...toolDraft });
    }
    setSavingTool(false);
    resetToolForm();
  };

  const handleTestTool = async (collection: HttpToolCollectionRow, sampleArgs: Record<string, string>) => {
    if (!toolDraft) return;
    setTesting(true);
    setTestResult(null);
    // Sends the draft values plus the collection's saved headers, so Test exercises the
    // same request the agent would make — including auth — without saving anything.
    const result = await testTool({
      baseUrl: collection.base_url,
      path: toolDraft.path,
      method: toolDraft.method,
      params: toolDraft.params,
      args: coerceSampleArgs(toolDraft.params, sampleArgs),
      headers: { ...(await getCollectionHeaders(collection.id)), ...toolDraft.headers },
      bodyTemplate: toolDraft.bodyTemplate,
      allowPrivateHosts: collection.allow_private_hosts === 1,
    });
    setTestResult(result);
    setTesting(false);
  };

  const collectionForm = (id: string | null) => (
    <>
      <label className="settings-field">
        <span>Name</span>
        <input
          type="text"
          value={collectionDraft.name}
          onChange={(e) => setCollectionDraft((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="JSONPlaceholder"
          autoComplete="off"
        />
      </label>
      <label className="settings-field">
        <span>Description</span>
        <input
          type="text"
          value={collectionDraft.description}
          onChange={(e) => setCollectionDraft((prev) => ({ ...prev, description: e.target.value }))}
          placeholder="What this API is for"
          autoComplete="off"
        />
      </label>
      <label className="settings-field">
        <span>Base URL</span>
        <input
          type="text"
          value={collectionDraft.baseUrl}
          onChange={(e) => setCollectionDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
          placeholder="https://jsonplaceholder.typicode.com"
          autoComplete="off"
        />
      </label>
      <label className="settings-field">
        <span>Shared headers (one KEY=value per line)</span>
        <textarea
          className="mcp-env-textarea"
          value={collectionDraft.headersText}
          onChange={(e) => setCollectionDraft((prev) => ({ ...prev, headersText: e.target.value }))}
          placeholder="Authorization=Bearer sk-…"
          rows={2}
        />
        <small className="settings-hint">Stored encrypted, and sent with every endpoint in this collection.</small>
      </label>
      {/* Wrapped in .group > .card because every .row rule in globals.css is scoped
          `.group .card .row` — a bare .row gets no layout at all and collapses onto its
          own toggle. */}
      <div className="group">
        <div className="card">
          <div className="row">
            <span className="row-label">
              Allow local/private addresses
              <small>Off by default — needed only for an API on localhost or your own network</small>
            </span>
            <Toggle
              checked={collectionDraft.allowPrivateHosts}
              onChange={(allowPrivateHosts) => setCollectionDraft((prev) => ({ ...prev, allowPrivateHosts }))}
              label="Toggle local address access"
            />
          </div>
        </div>
      </div>
      <div className="settings-form-actions">
        <button
          className="settings-action-btn settings-action-btn-primary"
          onClick={() => handleSaveCollection(id)}
          disabled={savingCollection || !collectionDraft.name.trim() || !collectionDraft.baseUrl.trim()}
        >
          {savingCollection ? "Saving…" : id ? "Save changes" : "Add API"}
        </button>
        {!id && (
          <button
            className="settings-action-btn-sm settings-action-btn-ghost"
            onClick={() => {
              setAddingCollection(false);
              setCollectionDraft(EMPTY_COLLECTION_DRAFT);
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </>
  );

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>HTTP Tools</h3>
        {!addingCollection && (
          <button
            type="button"
            className="settings-action-btn-sm settings-action-btn-ghost"
            onClick={() => {
              setCollectionDraft(EMPTY_COLLECTION_DRAFT);
              setAddingCollection(true);
            }}
          >
            <TablerIcon name="ti-plus" />
            <span>Add API</span>
          </button>
        )}
      </div>

      <p className="settings-hint">
        Turn any HTTP or HTTPS endpoint into a tool your agents can call. Group endpoints under the API they belong to
        so they share one base URL and one set of auth headers. Attach an API to specific agents in the Agents tab —
        they aren't available to every agent by default.
      </p>

      {/* The approval controls themselves live in Settings → Privacy & Safety, with the other
          decisions about what this app does without asking. They used to sit here, which meant
          the app's whole "ask before writing" posture was only findable by opening a tab that
          reads as "configure my own API endpoints" (finding S10). The badges below still show
          which endpoints will pause, because that is genuinely context for the tools. */}
      <p className="group-hint">
        Requests marked <strong>Asks first</strong> pause for your approval. Change what pauses in
        Settings → Privacy &amp; Safety. Reads (GET, HEAD) never ask.
      </p>

      {addingCollection && <div className="agent-accordion-body http-collection-form">{collectionForm(null)}</div>}

      <div className="agent-accordion-list">
        {collections.length === 0 && !addingCollection && (
          <p className="settings-empty">No HTTP tools yet. Add an API to get started.</p>
        )}
        {collections.map((collection) => {
          const tools = toolsForCollection(collection.id);
          return (
            <SettingsAccordion
              key={collection.id}
              icon="ti-api"
              title={`${collection.name} — ${formatToolCountLabel(tools, approvalPolicy)}`}
              open={openId === collection.id}
              onToggle={(open) => handleToggleCollection(collection, open)}
              headerActions={
                <>
                  <Toggle
                    checked={collection.enabled === 1}
                    onChange={(enabled) => updateCollection(collection.id, { enabled })}
                    label={`Toggle ${collection.name}`}
                  />
                  <button
                    className="settings-icon-btn"
                    aria-label={`Remove ${collection.name}`}
                    onClick={() => setPendingDelete({ kind: "collection", id: collection.id, label: collection.name })}
                  >
                    <TablerIcon name="ti-x" />
                  </button>
                </>
              }
            >
              {collectionForm(collection.id)}

              <div className="settings-field">
                <span>Endpoints</span>
                {tools.length === 0 && <p className="settings-empty">No endpoints yet.</p>}
                <div className="settings-folder-list">
                  {tools.map((tool) => (
                    <div className="settings-folder-row" key={tool.id}>
                      <span className={`http-method-badge${isWriteMethod(tool.method) ? " write" : ""}`}>
                        {tool.method}
                      </span>
                      <span className="settings-folder-path" title={`${tool.tool_name} — ${tool.description}`}>
                        {tool.name} <span className="http-tool-path-hint">{tool.path || "/"}</span>
                      </span>
                      {willAskApproval(tool.method, approvalPolicy) && (
                        <span className="http-confirm-badge" title="You are asked to approve each call">
                          <TablerIcon name="ti-shield-check" />
                        </span>
                      )}
                      <Toggle
                        checked={tool.enabled === 1}
                        onChange={(enabled) => updateTool(tool.id, { enabled })}
                        label={`Toggle ${tool.name}`}
                      />
                      <button
                        className="settings-icon-btn"
                        aria-label={`Edit ${tool.name}`}
                        onClick={() => handleEditTool(tool)}
                      >
                        <TablerIcon name="ti-pencil" />
                      </button>
                      <button
                        className="settings-icon-btn"
                        aria-label={`Remove ${tool.name}`}
                        onClick={() => setPendingDelete({ kind: "tool", id: tool.id, label: tool.name })}
                      >
                        <TablerIcon name="ti-x" />
                      </button>
                    </div>
                  ))}
                </div>

                {toolDraft && draftCollectionId === collection.id ? (
                  <HttpToolForm
                    draft={toolDraft}
                    approvalNote={
                      willAskApproval(toolDraft.method, approvalPolicy)
                        ? `You'll be asked to approve each ${toolDraft.method} call — change that under Approval above.`
                        : `${toolDraft.method} calls run without asking — change that under Approval above.`
                    }
                    onChange={setToolDraft}
                    onSave={() => handleSaveTool(collection.id)}
                    onCancel={resetToolForm}
                    onTest={(sampleArgs) => handleTestTool(collection, sampleArgs)}
                    testing={testing}
                    testResult={testResult}
                    saving={savingTool}
                    editing={editingToolId !== null}
                  />
                ) : (
                  <button
                    type="button"
                    className="settings-action-btn-sm settings-action-btn-ghost"
                    onClick={() => {
                      setToolDraft(EMPTY_TOOL_DRAFT);
                      setEditingToolId(null);
                      setDraftCollectionId(collection.id);
                      setTestResult(null);
                    }}
                  >
                    <TablerIcon name="ti-plus" />
                    <span>Add endpoint</span>
                  </button>
                )}
              </div>
            </SettingsAccordion>
          );
        })}
      </div>

      <DeleteConfirmModal
        open={pendingDelete !== null}
        itemLabel={pendingDelete?.label ?? ""}
        onConfirm={() => {
          if (pendingDelete?.kind === "collection") removeCollection(pendingDelete.id);
          if (pendingDelete?.kind === "tool") removeTool(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}
