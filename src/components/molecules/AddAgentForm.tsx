import { useState } from "react";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";
import { DEFAULT_ORCHESTRATOR_MODEL } from "@/lib/settings";

interface AddAgentFormProps {
  defaultModel: string;
  onCreate: (input: {
    name: string;
    tagline?: string;
    description?: string;
    model?: string;
    prompt?: string;
  }) => Promise<unknown>;
  onCancel: () => void;
}

export default function AddAgentForm({ defaultModel, onCreate, onCancel }: AddAgentFormProps) {
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ name: trimmedName, tagline, description, model, prompt });
      setName("");
      setTagline("");
      setDescription("");
      setModel(defaultModel);
      setPrompt("");
      onCancel();
    } catch (err) {
      setError(formatHumanizedError(humanizeError(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="agent-accordion add-agent-form">
      <div className="agent-accordion-body">
        <label className="settings-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Scout"
            autoComplete="off"
            autoFocus
          />
        </label>
        <label className="settings-field">
          <span>Tagline (2–3 words)</span>
          <input
            type="text"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="e.g. Web research"
            maxLength={40}
            autoComplete="off"
          />
        </label>
        <label className="settings-field">
          <span>Description</span>
          <textarea
            className="agent-accordion-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent do?"
            rows={3}
          />
        </label>
        <label className="settings-field">
          <span>Model ID</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_ORCHESTRATOR_MODEL}
            autoComplete="off"
          />
        </label>
        <label className="settings-field">
          <span>Prompt (Markdown)</span>
          <textarea
            className="agent-accordion-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            placeholder="Describe this agent's role…"
          />
        </label>
        {error && <p className="add-agent-form-error">{error}</p>}
        <div className="add-agent-form-actions">
          <button type="button" className="add-agent-form-cancel" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="add-agent-form-submit"
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
          >
            {submitting ? "Adding…" : "Add Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
