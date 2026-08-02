import { useState } from "react";

interface TextFieldProps {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  /** Optional caution shown under the field, computed from what is currently typed rather than
   * what is stored — so it appears while the value is being considered, not after it is saved. */
  warningFor?: (value: string) => string | null;
}

/**
 * A text setting that saves when you finish, not on every keystroke.
 *
 * Every field here wrote per character: one IPC round trip and one SQLite write each, with the
 * full settings blob coming back to re-render the panel. Pasting a long URL was dozens of writes
 * for one edit, and the read-back meant a value the write boundary refused snapped away
 * mid-typing.
 *
 * The API key and numeric fields already work this way — ApiKeyField was forced into it when the
 * keys stopped being returned, NumberField when the bounds started being enforced. This is the
 * same shape for the plain text fields, which is what finding X5 asked for.
 */
export default function TextField({ label, hint, value, placeholder, onCommit, warningFor }: TextFieldProps) {
  const [draft, setDraft] = useState(value);

  // Follow the stored value when it changes underneath — an agent renaming the orchestrator
  // mid-run, or a reset. Adjusted during render rather than in an effect, which is what React
  // documents and what react-hooks/set-state-in-effect requires.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) onCommit(trimmed);
    setDraft(trimmed);
  };

  const warning = warningFor?.(draft) ?? null;

  return (
    <label className="row-field">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {warning && <p className="settings-warning">{warning}</p>}
    </label>
  );
}
