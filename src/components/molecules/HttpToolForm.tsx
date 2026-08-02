import { useState } from "react";
import Combobox from "@/components/atoms/Combobox";
import HttpToolParamsEditor from "@/components/molecules/HttpToolParamsEditor";
import { headersToText, isWriteMethod, parseHeaders, type HttpToolDraft } from "@/lib/httpToolsFormat";

const METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => ({ value: m, label: m }));

interface HttpToolFormProps {
  draft: HttpToolDraft;
  /** Sentence describing what the global Approval policy does to this endpoint's method,
   * computed by the tab that owns the policy. */
  approvalNote: string;
  onChange: (draft: HttpToolDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onTest: (sampleArgs: Record<string, string>) => void;
  testing: boolean;
  testResult: HttpToolTestResult | null;
  saving: boolean;
  editing: boolean;
}

export default function HttpToolForm({
  draft,
  approvalNote,
  onChange,
  onSave,
  onCancel,
  onTest,
  testing,
  testResult,
  saving,
  editing,
}: HttpToolFormProps) {
  // Sample values are for the Test button only — never persisted, so they live here rather
  // than on the draft the caller saves.
  const [sampleArgs, setSampleArgs] = useState<Record<string, string>>({});
  const [headersText, setHeadersText] = useState(headersToText(draft.headers));

  const set = (patch: Partial<HttpToolDraft>) => onChange({ ...draft, ...patch });

  const commitHeaders = (text: string) => {
    setHeadersText(text);
    set({ headers: parseHeaders(text) });
  };

  return (
    <div className="http-tool-form">
      <label className="settings-field">
        <span>Endpoint name</span>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Get Post"
          autoComplete="off"
        />
      </label>

      <label className="settings-field">
        <span>What it does (the agent reads this)</span>
        <input
          type="text"
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Fetch a single post by its id."
          autoComplete="off"
        />
      </label>

      <div className="http-tool-form-row">
        <label className="settings-field http-tool-method">
          <span>Method</span>
          <Combobox value={draft.method} options={METHOD_OPTIONS} onChange={(method) => set({ method })} ariaLabel="Method" />
        </label>
        <label className="settings-field http-tool-path">
          <span>Path (appended to the base URL)</span>
          <input
            type="text"
            value={draft.path}
            onChange={(e) => set({ path: e.target.value })}
            placeholder="/posts/{{id}}"
            autoComplete="off"
          />
        </label>
      </div>

      <HttpToolParamsEditor params={draft.params} onChange={(params) => set({ params })} />

      {draft.method !== "GET" && draft.method !== "HEAD" && (
        <label className="settings-field">
          <span>Body template (optional — JSON, {"{{param}}"} unquoted)</span>
          <textarea
            className="mcp-env-textarea"
            value={draft.bodyTemplate}
            onChange={(e) => set({ bodyTemplate: e.target.value })}
            placeholder={'{"title": {{title}}, "userId": {{userId}}}'}
            rows={3}
          />
          <small className="settings-hint">
            Leave empty to send every Body parameter as a flat JSON object. Placeholders are filled in with correctly
            typed, escaped values, so write them without quotes.
          </small>
        </label>
      )}

      <label className="settings-field">
        <span>Extra headers for this endpoint (one KEY=value per line)</span>
        <textarea
          className="mcp-env-textarea"
          value={headersText}
          onChange={(e) => commitHeaders(e.target.value)}
          placeholder="Accept=application/json"
          rows={2}
        />
      </label>

      {/* Whether this endpoint pauses for approval is not an endpoint setting — it follows
          the global Approval policy at the top of this tab, by method. Stated here so the
          absence of a per-endpoint toggle doesn't read as an oversight. */}
      {isWriteMethod(draft.method) && (
        <p className="settings-hint">
          {approvalNote}
        </p>
      )}

      {draft.params.length > 0 && (
        <div className="settings-field">
          <span>Sample values (used only by Test — never saved)</span>
          {draft.params.map((param) => (
            <label className="settings-field" key={param.name || param.description}>
              <span>{param.name || "(unnamed)"}</span>
              <input
                type="text"
                value={sampleArgs[param.name] ?? ""}
                onChange={(e) => setSampleArgs((prev) => ({ ...prev, [param.name]: e.target.value }))}
                placeholder={param.type === "number" ? "1" : param.type === "boolean" ? "true" : "value"}
                autoComplete="off"
              />
            </label>
          ))}
        </div>
      )}

      {testResult && (
        <p className={`settings-hint ${testResult.ok ? "settings-success" : "settings-error"}`}>
          {testResult.error
            ? `Failed: ${testResult.error}`
            : `${testResult.status} ${testResult.statusText ?? ""} — ${(testResult.body ?? "").slice(0, 300)}`}
        </p>
      )}

      <div className="settings-form-actions">
        <button className="settings-action-btn" onClick={() => onTest(sampleArgs)} disabled={testing}>
          {testing ? "Testing…" : "Test"}
        </button>
        <button
          className="settings-action-btn settings-action-btn-primary"
          onClick={onSave}
          disabled={saving || !draft.name.trim()}
        >
          {editing ? "Save changes" : "Add endpoint"}
        </button>
        <button className="settings-action-btn-sm settings-action-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
