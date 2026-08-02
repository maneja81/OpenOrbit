import { useState } from "react";
import Combobox from "@/components/atoms/Combobox";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";
import { AI_PROVIDERS, findProvider } from "@/lib/providers";
import { DEFAULT_ORCHESTRATOR_MODEL } from "@/lib/settings";

interface AddAgentFormProps {
  defaultModel: string;
  onCreate: (input: {
    name: string;
    tagline?: string;
    description?: string;
    model?: string;
    providerId?: string;
    prompt?: string;
  }) => Promise<unknown>;
  onCancel: () => void;
}

export default function AddAgentForm({ defaultModel, onCreate, onCancel }: AddAgentFormProps) {
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [providerId, setProviderId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Moving the provider moves the model with it, the same way the accordion does for an agent
   * that already exists — otherwise the field still holds the Chat slot's id, which the newly
   * chosen provider has never heard of. A provider with no default of its own (`local`) leaves
   * the field alone for the user to fill. */
  const changeProvider = (nextProviderId: string) => {
    setProviderId(nextProviderId);
    const nextModel = nextProviderId === "" ? defaultModel : findProvider(nextProviderId)?.defaultChatModel;
    if (nextModel) setModel(nextModel);
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ name: trimmedName, tagline, description, model, providerId, prompt });
      setName("");
      setTagline("");
      setDescription("");
      setModel(defaultModel);
      setProviderId("");
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
          <span>Provider</span>
          <Combobox
            value={providerId}
            // "" first and always present: following the Chat slot is what an agent gets when
            // nobody chooses, and the only way back once one has been picked.
            options={[
              { value: "", label: "Same as Chat" },
              ...AI_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.label })),
            ]}
            onChange={changeProvider}
            ariaLabel="Provider for the new agent"
            size="sm"
          />
        </label>
        <label className="settings-field">
          <span>
            <span>Model ID</span>
            <small>Leave blank to use {findProvider(providerId)?.defaultChatModel || defaultModel}</small>
          </span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={findProvider(providerId)?.defaultChatModel || defaultModel || DEFAULT_ORCHESTRATOR_MODEL}
            aria-label="Model ID"
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
