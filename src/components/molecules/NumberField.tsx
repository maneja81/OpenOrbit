import { useState } from "react";
import { NumericBound } from "@/lib/settings";

interface NumberFieldProps {
  label: string;
  hint?: string;
  value: number;
  bound: NumericBound;
  onCommit: (value: number) => void;
}

/**
 * A numeric setting input that enforces the range it advertises.
 *
 * `min` on a number input constrains the spinner and nothing else — typed and pasted values sail
 * straight past it. Every numeric setting here relied on that, backed only by a `value > 0` guard,
 * which is how a 1 ms system-stats poll interval and a 1-second agent timeout were reachable
 * (findings S2, S3, S4).
 *
 * The draft is local so the box can be cleared and retyped. Bound directly to the stored value it
 * could not be: clearing gives `Number("") === 0`, which the old guard rejected, so the field
 * snapped back to its previous value mid-edit and the number could not be changed by deleting
 * first. The same coercion silently muted background music, because 0 is a legal volume (S5).
 *
 * A rejected value now says why. The write boundary refuses out-of-range values since the
 * settings schema landed, but the refusal was invisible — the field just reverted with no
 * explanation, which is the tail S2 was reduced to.
 */
export default function NumberField({ label, hint, value, bound, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  // Follow the stored value when it changes underneath us — a Danger Zone reset, or an agent
  // writing it mid-run — but not while the user is mid-edit, which is what a pending error means.
  // Adjusted during render rather than in an effect: React documents this as the way to react to
  // a changed prop, SettingsPanel already does it for its section state, and the effect form is
  // rejected by react-hooks/set-state-in-effect.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (error === null) setDraft(String(value));
  }

  const rangeText = `${bound.min}–${bound.max}`;

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      // Empty means "I deleted it to retype", not "set this to zero".
      setDraft(String(value));
      setError(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return setError(`Must be a number between ${rangeText}`);
    if (bound.integer && !Number.isInteger(parsed)) return setError("Must be a whole number");
    if (parsed < bound.min || parsed > bound.max) return setError(`Must be between ${rangeText}`);
    setError(null);
    setDraft(String(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <label className="row-field">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="number"
        min={bound.min}
        max={bound.max}
        step={bound.integer ? 1 : 0.05}
        value={draft}
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {error && <p className="settings-error">{error}</p>}
    </label>
  );
}
