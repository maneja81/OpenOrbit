import Combobox from "@/components/atoms/Combobox";
import TablerIcon from "@/components/atoms/TablerIcon";

const TYPE_OPTIONS = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
] as const;

const LOCATION_OPTIONS = [
  { value: "path", label: "Path" },
  { value: "query", label: "Query" },
  { value: "header", label: "Header" },
  { value: "body", label: "Body" },
] as const;

interface HttpToolParamsEditorProps {
  params: HttpToolParam[];
  onChange: (params: HttpToolParam[]) => void;
}

/** Editor for the inputs an HTTP tool declares. These become the model-facing tool
 * signature (see toolParamsSchema in electron/main/ai/httpToolRequest.ts), so the name and
 * description here are what the agent reads when deciding what to send. */
export default function HttpToolParamsEditor({ params, onChange }: HttpToolParamsEditorProps) {
  const update = (index: number, patch: Partial<HttpToolParam>) => {
    onChange(params.map((param, i) => (i === index ? { ...param, ...patch } : param)));
  };

  const add = () => {
    onChange([...params, { name: "", description: "", type: "string", required: true, location: "query" }]);
  };

  const remove = (index: number) => {
    onChange(params.filter((_, i) => i !== index));
  };

  return (
    <div className="settings-field">
      <span>Parameters (what the agent can fill in)</span>
      {params.length === 0 && (
        <p className="settings-empty">
          No parameters — this endpoint always calls the same URL. Add one to let the agent pass a value.
        </p>
      )}
      {params.map((param, index) => (
        <div className="http-param-row" key={index}>
          <div className="http-param-row-main">
            <input
              type="text"
              className="http-param-name"
              value={param.name}
              onChange={(e) => update(index, { name: e.target.value })}
              placeholder="id"
              aria-label={`Parameter ${index + 1} name`}
              autoComplete="off"
            />
            <Combobox
              value={param.type}
              options={TYPE_OPTIONS}
              onChange={(type) => update(index, { type: type as HttpToolParam["type"] })}
              ariaLabel={`Parameter ${index + 1} type`}
              size="sm"
            />
            <Combobox
              value={param.location}
              options={LOCATION_OPTIONS}
              onChange={(location) => update(index, { location: location as HttpToolParam["location"] })}
              ariaLabel={`Parameter ${index + 1} location`}
              size="sm"
            />
            <label className="http-param-required">
              <input
                type="checkbox"
                checked={param.required}
                onChange={(e) => update(index, { required: e.target.checked })}
              />
              <span>Required</span>
            </label>
            <button
              type="button"
              className="settings-icon-btn"
              aria-label={`Remove parameter ${param.name || index + 1}`}
              onClick={() => remove(index)}
            >
              <TablerIcon name="ti-x" />
            </button>
          </div>
          <input
            type="text"
            className="http-param-description"
            value={param.description}
            onChange={(e) => update(index, { description: e.target.value })}
            placeholder="What this value is — the agent reads this to decide what to send"
            aria-label={`Parameter ${index + 1} description`}
            autoComplete="off"
          />
        </div>
      ))}
      <button type="button" className="settings-action-btn-sm settings-action-btn-ghost" onClick={add}>
        <TablerIcon name="ti-plus" />
        <span>Add parameter</span>
      </button>
    </div>
  );
}
