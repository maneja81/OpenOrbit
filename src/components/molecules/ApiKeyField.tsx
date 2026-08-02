import { useState } from "react";

interface ApiKeyFieldProps {
  label: string;
  /** Whether a key is already stored. The value itself never reaches the renderer. */
  isSet: boolean;
  onSave: (key: string) => void;
}

/**
 * An API key input for a value the renderer is never given.
 *
 * `settings:get` returns `chatApiKeySet` / `voiceApiKeySet` instead of the keys themselves, so
 * this field cannot be bound to a stored value the way every other setting is. It keeps what the
 * user types in local state and commits on blur.
 *
 * Local state is not a style choice here. Every other field writes on each keystroke and rebinds
 * to the authoritative response; with a masked key that response carries no value, so a
 * per-keystroke field would clear itself after the first character and a key could never be
 * typed at all. (The per-keystroke write is finding X5, still open — this is a scoped slice of
 * it, forced by the masking.)
 *
 * Committing on blur also means one encrypted write per key entered rather than one per
 * character — pasting a 164-character key used to be 164 OS-keychain round trips.
 */
export default function ApiKeyField({ label, isSet, onSave }: ApiKeyFieldProps) {
  const [draft, setDraft] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const commit = () => {
    const trimmed = draft.trim();
    // Blurring an untouched field must not clear a stored key — an empty draft means
    // "unchanged", not "remove it". Clearing is done from the Danger Zone.
    if (trimmed.length === 0) return;
    onSave(trimmed);
    setDraft("");
    setJustSaved(true);
  };

  const stored = isSet || justSaved;

  return (
    <label className="row-field">
      <span>
        {label}
        {stored && <small>A key is saved — type a new one to replace it</small>}
      </span>
      <input
        type="password"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setJustSaved(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={stored ? "••••••••" : "sk-…"}
        autoComplete="off"
      />
    </label>
  );
}
