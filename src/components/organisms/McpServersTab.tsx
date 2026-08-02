import { useState } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";
import Toggle from "@/components/atoms/Toggle";
import DeleteConfirmModal from "@/components/molecules/DeleteConfirmModal";
import SettingsAccordion from "@/components/molecules/SettingsAccordion";
import { useMcpServers } from "@/hooks/useMcpServers";

type AddMode = "manual" | "registry";

interface McpServersTabProps {
  mcp: ReturnType<typeof useMcpServers>;
}

export default function McpServersTab({ mcp }: McpServersTabProps) {
  const { servers, error, addServer, updateServer, removeServer, getEnv, testServer, searchRegistry } = mcp;
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("manual");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [envText, setEnvText] = useState("");
  const [testResult, setTestResult] = useState<{ tools: string[] } | null>(null);
  const [testing, setTesting] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<McpSearchResult[]>([]);

  const resetForm = () => {
    setName("");
    setCommand("");
    setArgs("");
    setEnvText("");
    setTestResult(null);
    setEditingId(null);
  };

  const envToText = (env: Record<string, string>): string =>
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

  // Controlled-open, matching HttpToolsTab: env is stored encrypted and only decrypted on
  // explicit request, so the edit form has to fetch it when the row actually opens rather
  // than up front for every server in the list.
  const handleToggleServer = async (server: McpServerRow, open: boolean) => {
    if (!open) {
      resetForm();
      return;
    }
    // Only one form is on screen at a time — opening a server closes the Add form.
    setAdding(false);
    setAddMode("manual");
    setEditingId(server.id);
    setName(server.name);
    setCommand(server.command);
    setArgs((JSON.parse(server.args) as string[]).join(" "));
    setTestResult(null);
    setEnvText(envToText(await getEnv(server.id)));
  };

  const handleCancel = () => {
    resetForm();
    setAdding(false);
  };

  const parseArgs = (): string[] =>
    args
      .split(" ")
      .map((a) => a.trim())
      .filter(Boolean);

  const parseEnv = (): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const line of envText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
  };

  const handleTest = async () => {
    if (!command.trim()) return;
    setTesting(true);
    setTestResult(null);
    const result = await testServer({ name: name || command, command, args: parseArgs(), env: parseEnv() });
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = async () => {
    if (!name.trim() || !command.trim()) return;
    if (editingId) {
      await updateServer(editingId, { name, command, args: parseArgs(), env: parseEnv() });
    } else {
      await addServer({ name, command, args: parseArgs(), env: parseEnv() });
    }
    handleCancel();
  };

  const handleSearch = async () => {
    setSearching(true);
    const found = await searchRegistry(query);
    setResults(found);
    setSearching(false);
  };

  // Installed disabled by default — a registry search result's command comes from a
  // remote third party (registry.modelcontextprotocol.io), so it lands off until the
  // user consciously reviews and enables it from the main list (where the resolved
  // command is shown), rather than a one-click "Install" silently starting to run it.
  const handleInstall = async (result: McpSearchResult) => {
    const created = await addServer({ name: result.name, command: result.command, args: result.args, env: result.env });
    if (created) await updateServer(created.id, { enabled: false });
    setAdding(false);
    setResults([]);
    setQuery("");
  };

  // Shared by the Add block and every server's accordion body — the fields are identical,
  // and only one is ever on screen at a time, so they read from the same draft state.
  const manualForm = () => (
    <>
      <label className="settings-field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="My MCP Server" autoComplete="off" />
      </label>
      <label className="settings-field">
        <span>Command</span>
        <input type="text" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" autoComplete="off" />
      </label>
      <label className="settings-field">
        <span>Args (space-separated)</span>
        <input
          type="text"
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="-y @modelcontextprotocol/server-filesystem /path"
          autoComplete="off"
        />
      </label>
      <label className="settings-field">
        <span>Env (one KEY=value per line)</span>
        <textarea
          className="mcp-env-textarea"
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder="API_KEY=sk-..."
          rows={3}
        />
      </label>
      {testResult && (
        <p className="settings-hint">
          {testResult.tools.length > 0
            ? `Connected — ${testResult.tools.length} tool(s) found: ${testResult.tools.join(", ")}`
            : "Connected — no tools reported."}
        </p>
      )}
      <div className="settings-form-actions">
        <button className="settings-action-btn" onClick={handleTest} disabled={testing || !command.trim()}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button
          className="settings-action-btn settings-action-btn-primary"
          onClick={handleSave}
          disabled={!name.trim() || !command.trim()}
        >
          {editingId ? "Save changes" : "Save"}
        </button>
        <button className="settings-action-btn-sm settings-action-btn-ghost" onClick={handleCancel}>
          Cancel
        </button>
      </div>
    </>
  );

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>MCP Servers</h3>
        {!adding && (
          <button
            type="button"
            className="settings-action-btn-sm settings-action-btn-ghost"
            onClick={() => {
              resetForm();
              setAdding(true);
              setAddMode("manual");
            }}
          >
            <TablerIcon name="ti-plus" />
            <span>Add MCP Server</span>
          </button>
        )}
      </div>

      <p className="settings-hint">
        MCP servers run as local processes and can access your system with your user's permissions. Only add servers
        you trust. Attach a server to specific agents in the Agents tab — servers aren't available to every agent by
        default.
      </p>

      {/* Above the list, matching HttpToolsTab: the new server has no row to expand into
          yet, and the registry browser needs the full width the accordion body doesn't give. */}
      {adding && (
        <div className="agent-accordion-body mcp-add-form">
          <div className="settings-tabs mcp-add-mode-tabs" role="tablist">
            <button
              type="button"
              className={`settings-tab${addMode === "manual" ? " active" : ""}`}
              onClick={() => setAddMode("manual")}
            >
              Manual
            </button>
            <button
              type="button"
              className={`settings-tab${addMode === "registry" ? " active" : ""}`}
              onClick={() => setAddMode("registry")}
            >
              Browse Registry
            </button>
          </div>

          {addMode === "manual" && manualForm()}

          {addMode === "registry" && (
            <>
              <label className="settings-field">
                <span>Search the official MCP Registry</span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="e.g. filesystem, github, postgres"
                  autoComplete="off"
                />
              </label>
              <div className="settings-form-actions">
                <button className="settings-action-btn" onClick={handleSearch} disabled={searching}>
                  {searching ? "Searching…" : "Search"}
                </button>
                <button
                  className="settings-action-btn-sm settings-action-btn-ghost"
                  onClick={() => {
                    setResults([]);
                    setAdding(false);
                  }}
                >
                  Cancel
                </button>
              </div>
              {/* Result rows stay flat: these are search hits with a single Install action,
                  not editable items, so they get no accordion of their own. */}
              <div className="settings-folder-list">
                {results.map((result) => {
                  const resolvedCommand = `${result.command} ${result.args.join(" ")}`.trim();
                  return (
                    <div className="settings-folder-row" key={result.id}>
                      <TablerIcon name="ti-plug" />
                      <span
                        className="settings-folder-path"
                        title={`${result.description}\n\nWill run: ${resolvedCommand}`}
                      >
                        {result.name} — {resolvedCommand}
                      </span>
                      <button className="settings-action-btn-sm" onClick={() => handleInstall(result)}>
                        Install
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      <div className="agent-accordion-list">
        {servers.length === 0 && !adding && <p className="settings-empty">No MCP servers configured yet.</p>}
        {servers.map((server) => (
          <SettingsAccordion
            key={server.id}
            icon="ti-plug"
            title={server.name}
            open={editingId === server.id}
            onToggle={(open) => handleToggleServer(server, open)}
            headerActions={
              <>
                <Toggle
                  checked={!!server.enabled}
                  onChange={(enabled) => updateServer(server.id, { enabled })}
                  label={`Toggle ${server.name}`}
                />
                <button
                  className="settings-icon-btn"
                  aria-label={`Remove ${server.name}`}
                  onClick={() => setPendingDelete({ id: server.id, name: server.name })}
                >
                  <TablerIcon name="ti-x" />
                </button>
              </>
            }
          >
            {manualForm()}
          </SettingsAccordion>
        ))}
      </div>

      <DeleteConfirmModal
        open={pendingDelete !== null}
        itemLabel={pendingDelete?.name ?? ""}
        onConfirm={() => {
          if (pendingDelete) removeServer(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}
