import { useState } from "react";
import Combobox from "@/components/atoms/Combobox";
import IconButton from "@/components/atoms/IconButton";
import TablerIcon from "@/components/atoms/TablerIcon";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";
import { AI_PROVIDERS, findProvider } from "@/lib/providers";
import { hasAgentsAPI } from "@/lib/agentsApi";

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
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  /** What a blank Model ID would resolve to for the provider currently picked — empty when that
   * provider has no default, which is `local` and only `local`. */
  const fallbackModel = providerId === "" ? defaultModel : (findProvider(providerId)?.defaultChatModel ?? "");

  // Whatever the user has already written about the agent — description first (usually the
  // more natural free-text answer to "what does this do?"), falling back to the prompt draft
  // when only that's been filled in. Nothing to suggest from until one of them has content.
  const suggestContext = description.trim() || prompt.trim();

  const handleSuggest = async () => {
    if (!suggestContext || suggesting || !hasAgentsAPI()) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const result = await window.agentsAPI.agent.suggestIdentity(suggestContext);
      setName(result.name);
      setTagline(result.tagline);
    } catch (err) {
      setSuggestError(formatHumanizedError(humanizeError(err)));
    } finally {
      setSuggesting(false);
    }
  };

  /** Moving the provider moves the model with it, the same way the accordion does for an agent
   * that already exists — otherwise the field still holds the Chat slot's id, which the newly
   * chosen provider has never heard of.
   *
   * A provider with no default *clears* the field rather than leaving it. Leaving it looked
   * harmless and wasn't: the field is pre-filled with the Chat model at mount, so picking Local AI
   * and submitting created an Ollama agent named `gpt-4.1-mini`, which 404s on first use. */
  const changeProvider = (nextProviderId: string) => {
    setProviderId(nextProviderId);
    setModel(nextProviderId === "" ? defaultModel : (findProvider(nextProviderId)?.defaultChatModel ?? ""));
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
      setSuggestError(null);
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
        <div className="add-agent-suggest-row">
          <IconButton
            className="add-agent-suggest-btn"
            aria-label="Suggest a name and tagline from the description above"
            disabled={!suggestContext || suggesting}
            onClick={handleSuggest}
          >
            <TablerIcon name={suggesting ? "ti-loader-2" : "ti-sparkles"} />
            <span>{suggesting ? "Suggesting…" : "Suggest name & tagline"}</span>
          </IconButton>
          {!suggestContext && <small>Describe the agent above to get a suggestion.</small>}
        </div>
        {suggestError && <p className="add-agent-form-error">{suggestError}</p>}
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
            <small>
              {fallbackModel
                ? `Leave blank to use ${fallbackModel}`
                : "Required — this provider has no default model"}
            </small>
          </span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={fallbackModel || "e.g. llama3.1:8b"}
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
