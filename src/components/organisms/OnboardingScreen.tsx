import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";
import { USER_CONTEXT_FIELD_BY_KEY } from "@/lib/userContext";
import { AI_PROVIDERS, DEFAULT_PROVIDER_ID, findProvider } from "@/lib/providers";
import { providerUrlWarning } from "@/lib/providerUrlWarning";

export interface OnboardingAnswers {
  agentName: string;
  userName: string;
  profession: string;
  responseStyle: string;
  technicalLevel: string;
  stuckStyle: string;
  /** Registry id from lib/providers — decides the defaults for the three steps after it. */
  providerId: string;
  apiUrl: string;
  apiKey: string;
  model: string;
}

interface OnboardingScreenProps {
  onComplete: (answers: OnboardingAnswers) => void;
}

interface ChipOption {
  value: string;
  label: string;
}

interface Step {
  key: keyof OnboardingAnswers;
  question: string;
  /** A function where an earlier answer decides the wording — the provider steps all do. */
  subtitle?: string | ((answers: OnboardingAnswers) => string | undefined);
  /** Text/password steps only — chip steps render preset options instead of an input. */
  placeholder?: string | ((answers: OnboardingAnswers) => string);
  type: "text" | "password" | "chips";
  chips?: readonly string[];
  /** Chip steps whose stored value differs from its label — the provider step stores an id. */
  options?: readonly ChipOption[];
  /** A function where the answer decides it: a local server needs no key, everyone else does. */
  required: boolean | ((answers: OnboardingAnswers) => boolean);
  /** Shown under the field while typing — the plain-http key-exposure caution. */
  warningFor?: (value: string) => string | null;
}

const providerLabel = (answers: OnboardingAnswers): string =>
  findProvider(answers.providerId)?.label ?? "your provider";

const STEPS: Step[] = [
  {
    key: "agentName",
    question: "Give me a name?",
    subtitle: "I'll go by this in every conversation.",
    placeholder: "Orbit",
    type: "text",
    required: true,
  },
  {
    key: "userName",
    question: "What should I call you?",
    placeholder: "First name is fine",
    type: "text",
    required: true,
  },
  {
    key: "profession",
    question: "What do you do?",
    subtitle: "Helps me pitch answers at the right level.",
    placeholder: "e.g. Product Designer",
    type: "text",
    required: false,
  },
  // Preset answers come from USER_CONTEXT_FIELD_BY_KEY so this screen and
  // Settings → General → About you always offer the same choices.
  {
    key: "responseStyle",
    question: "How do you like answers?",
    type: "chips",
    chips: USER_CONTEXT_FIELD_BY_KEY.responseStyle.options,
    required: false,
  },
  {
    key: "technicalLevel",
    question: "How technical are you?",
    type: "chips",
    chips: USER_CONTEXT_FIELD_BY_KEY.technicalLevel.options,
    required: false,
  },
  {
    key: "stuckStyle",
    question: "When you're stuck, what helps?",
    type: "chips",
    chips: USER_CONTEXT_FIELD_BY_KEY.stuckStyle.options,
    required: false,
  },
  {
    key: "providerId",
    question: "Which AI provider?",
    subtitle: "You can change this later, or point individual agents somewhere else.",
    type: "chips",
    // Labels and ids differ here — "Claude" is the label, "anthropic" the stored id — which is
    // why chip steps carry options as well as plain strings.
    options: AI_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.label })),
    required: true,
  },
  {
    key: "apiUrl",
    question: "Where should I reach it?",
    // Prefilled for a hosted provider and blank for a local server, because only the user knows
    // that address — blank here cannot mean "use OpenAI's" the way an empty chatApiUrl does.
    subtitle: (answers) =>
      findProvider(answers.providerId)?.baseUrl === ""
        ? "Your server's OpenAI-compatible address — Ollama's default is http://localhost:11434/v1"
        : `The standard ${providerLabel(answers)} address. Change it only if you use a proxy.`,
    placeholder: (answers) => findProvider(answers.providerId)?.baseUrl || "http://localhost:11434/v1",
    type: "text",
    required: true,
    warningFor: providerUrlWarning,
  },
  {
    key: "apiKey",
    question: "Enter your API key",
    subtitle: (answers) =>
      findProvider(answers.providerId)?.keyRequired === false
        ? "A local server usually needs no key — leave this blank unless yours does."
        : `Your ${providerLabel(answers)} key. It is stored on this machine only.`,
    placeholder: "sk-…",
    type: "password",
    // The one provider that authenticates nothing. Demanding a key here would block the provider
    // whose whole point is not having one.
    required: (answers) => findProvider(answers.providerId)?.keyRequired !== false,
  },
  {
    key: "model",
    question: "Which model?",
    subtitle: (answers) =>
      findProvider(answers.providerId)?.defaultChatModel === ""
        ? "Whichever model you have pulled — `ollama list` shows them, e.g. llama3.2:3b"
        : "A sensible default for that provider. Change it if you prefer another.",
    placeholder: (answers) => findProvider(answers.providerId)?.defaultChatModel || "llama3.2:3b",
    type: "text",
    required: true,
  },
];

/** Resolves the step fields that can depend on earlier answers. */
function resolve<T>(value: T | ((answers: OnboardingAnswers) => T), answers: OnboardingAnswers): T {
  return typeof value === "function" ? (value as (a: OnboardingAnswers) => T)(answers) : value;
}

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    agentName: "",
    userName: "",
    profession: "",
    responseStyle: "",
    technicalLevel: "",
    stuckStyle: "",
    providerId: "",
    apiUrl: "",
    apiKey: "",
    model: "",
  });
  const [leaving, setLeaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const step = STEPS[stepIndex];
  const value = answers[step.key];
  const required = resolve(step.required, answers);
  const canAdvance = !required || value.trim().length > 0;
  const subtitle = resolve(step.subtitle, answers);
  const placeholder = resolve(step.placeholder, answers);
  const warning = step.warningFor?.(value) ?? null;
  const chipOptions: readonly ChipOption[] =
    step.options ?? (step.chips ?? []).map((chip) => ({ value: chip, label: chip }));

  // Both completion paths (typed final step, chip-selected final step) route through here so
  // trimming stays identical regardless of which control finished onboarding.
  const finish = useCallback(
    (final: OnboardingAnswers) => {
      setLeaving(true);
      setTimeout(() => {
        onComplete({
          agentName: final.agentName.trim(),
          userName: final.userName.trim(),
          profession: final.profession.trim(),
          responseStyle: final.responseStyle,
          technicalLevel: final.technicalLevel,
          stuckStyle: final.stuckStyle,
          providerId: final.providerId || DEFAULT_PROVIDER_ID,
          apiUrl: final.apiUrl.trim(),
          apiKey: final.apiKey.trim(),
          model: final.model.trim(),
        });
      }, 500);
    },
    [onComplete]
  );

  const advance = useCallback(() => {
    if (!canAdvance) return;
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      finish(answers);
    }
  }, [answers, canAdvance, finish, stepIndex]);

  // Chip steps advance on selection. `next` is passed to finish() explicitly because the
  // `answers` captured here is still the pre-setAnswers value.
  const selectChip = useCallback(
    (chip: string) => {
      const next = { ...answers, [step.key]: chip } as OnboardingAnswers;
      // Choosing a provider seeds the two steps that need a default, so the user reviews a
      // filled-in URL and model rather than typing them from scratch. Both stay editable, and a
      // local server correctly seeds blank — only the user knows that address or which model
      // they have pulled.
      if (step.key === "providerId") {
        const provider = findProvider(chip);
        next.apiUrl = provider?.baseUrl ?? "";
        next.model = provider?.defaultChatModel ?? "";
      }
      setAnswers(next);
      if (stepIndex < STEPS.length - 1) setStepIndex((i) => i + 1);
      else finish(next);
    },
    [answers, finish, step.key, stepIndex]
  );

  // Chips are the only control on their step, so the step has to stay usable from the
  // keyboard alone. Enter/Space need no handler — they fire onClick natively on a button.
  const onChipKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const count = chipOptions.length;
      if (count === 0) return;
      const current = chipRefs.current.findIndex((el) => el === document.activeElement);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        chipRefs.current[(current + 1 + count) % count]?.focus();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        chipRefs.current[(current - 1 + count) % count]?.focus();
      }
    },
    [chipOptions.length]
  );

  return (
    <div id="onboarding" className={leaving ? "leaving" : undefined}>
      <video id="bgvid" autoPlay muted loop playsInline>
        {/* Document-relative, not "/bg.mp4": built renderers load over file://, where a
            root-absolute path resolves to file:///bg.mp4 and the video never loads. */}
        <source src="./bg.mp4" type="video/mp4" />
      </video>
      <div id="titlebar">
        <span id="titlebar-title">WELCOME</span>
      </div>
      <div id="onboarding-body">
        <div key={step.key} className="onboarding-step">
          <span className="onboarding-step-index">
            {stepIndex + 1} / {STEPS.length}
          </span>
          <h1 className="onboarding-question">{step.question}</h1>
          {subtitle && <p className="onboarding-subtitle">{subtitle}</p>}
          {step.type === "chips" ? (
            <div className="onboarding-chip-row">
              <div
                className="onboarding-chips"
                role="radiogroup"
                aria-label={step.question}
                onKeyDown={onChipKeyDown}
              >
                {chipOptions.map((option, i) => (
                  <button
                    key={option.value}
                    ref={(el) => {
                      chipRefs.current[i] = el;
                    }}
                    role="radio"
                    aria-checked={value === option.value}
                    autoFocus={i === 0}
                    className={`onboarding-chip${value === option.value ? " selected" : ""}`}
                    onClick={() => selectChip(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {/* An optional chip step needs its own way past — selecting a chip advances, this
                  skips without recording an answer. A required one (the provider) must not offer
                  it, or the user reaches the end with nothing chosen. */}
              {!required && (
                <button className="onboarding-next" aria-label="Skip" onClick={advance}>
                  <TablerIcon name={stepIndex < STEPS.length - 1 ? "ti-arrow-right" : "ti-check"} />
                </button>
              )}
            </div>
          ) : (
            <div className="onboarding-input-row">
              <input
                ref={inputRef}
                autoFocus
                type={step.type}
                value={value}
                placeholder={placeholder}
                autoComplete="off"
                aria-label={step.question}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [step.key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") advance();
                }}
              />
              <button className="onboarding-next" aria-label="Next" onClick={advance} disabled={!canAdvance}>
                <TablerIcon name={stepIndex < STEPS.length - 1 ? "ti-arrow-right" : "ti-check"} />
              </button>
            </div>
          )}
          {warning && <p className="settings-warning">{warning}</p>}
        </div>
      </div>
    </div>
  );
}
