/**
 * The context questions asked once during onboarding and editable afterwards in
 * Settings → General → About you.
 *
 * Both screens read this list rather than repeating the strings, because they must agree
 * on two things: the preset answers offered, and `factQuestion` — which is stored verbatim
 * in the user-fact store and matched on update. If Settings asked the same thing in
 * different words, saving would append a second, contradicting fact instead of replacing
 * the onboarding answer, and both would be injected into every agent's prompt.
 */

export type UserContextKey = "profession" | "responseStyle" | "technicalLevel" | "stuckStyle";

export interface UserContextField {
  key: UserContextKey;
  /** Stored verbatim as the fact's question and matched on update — changing the wording
   * orphans whatever the user already answered under the old text. */
  factQuestion: string;
  /** Row label in Settings → General → About you. */
  label: string;
  /** Preset answers. Omitted for free-text fields. */
  options?: readonly string[];
  /** Placeholder for free-text fields. */
  placeholder?: string;
}

export const USER_CONTEXT_FIELDS: readonly UserContextField[] = [
  {
    key: "profession",
    factQuestion: "What is your profession?",
    label: "What you do",
    placeholder: "e.g. Product Designer",
  },
  {
    key: "responseStyle",
    factQuestion: "How do you prefer responses?",
    label: "Response style",
    options: ["Brief & direct", "Detailed", "Conversational"],
  },
  {
    key: "technicalLevel",
    factQuestion: "How technical are you?",
    label: "Technical level",
    options: ["Beginner", "Intermediate", "Expert"],
  },
  {
    key: "stuckStyle",
    factQuestion: "When stuck, what helps you most?",
    label: "When you're stuck",
    options: ["Give me options", "Just tell me what to do", "Talk me through it"],
  },
];

export const USER_CONTEXT_FIELD_BY_KEY = Object.fromEntries(
  USER_CONTEXT_FIELDS.map((field) => [field.key, field])
) as Record<UserContextKey, UserContextField>;
