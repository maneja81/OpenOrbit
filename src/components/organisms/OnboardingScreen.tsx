import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";
import { USER_CONTEXT_FIELD_BY_KEY } from "@/lib/userContext";

export interface OnboardingAnswers {
  agentName: string;
  userName: string;
  profession: string;
  responseStyle: string;
  technicalLevel: string;
  stuckStyle: string;
  apiKey: string;
}

interface OnboardingScreenProps {
  onComplete: (answers: OnboardingAnswers) => void;
}

interface Step {
  key: keyof OnboardingAnswers;
  question: string;
  subtitle?: string;
  /** Text/password steps only — chip steps render preset options instead of an input. */
  placeholder?: string;
  type: "text" | "password" | "chips";
  chips?: readonly string[];
  required: boolean;
}

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
    key: "apiKey",
    question: "Enter your OpenAI API Key",
    subtitle: "Powers chat and voice out of the box — you can swap providers later in Settings.",
    placeholder: "sk-…",
    type: "password",
    required: true,
  },
];

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    agentName: "",
    userName: "",
    profession: "",
    responseStyle: "",
    technicalLevel: "",
    stuckStyle: "",
    apiKey: "",
  });
  const [leaving, setLeaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const step = STEPS[stepIndex];
  const value = answers[step.key];
  const canAdvance = !step.required || value.trim().length > 0;

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
          apiKey: final.apiKey.trim(),
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
      const count = step.chips?.length ?? 0;
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
    [step.chips]
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
          {step.subtitle && <p className="onboarding-subtitle">{step.subtitle}</p>}
          {step.type === "chips" ? (
            <div className="onboarding-chip-row">
              <div
                className="onboarding-chips"
                role="radiogroup"
                aria-label={step.question}
                onKeyDown={onChipKeyDown}
              >
                {step.chips?.map((chip, i) => (
                  <button
                    key={chip}
                    ref={(el) => {
                      chipRefs.current[i] = el;
                    }}
                    role="radio"
                    aria-checked={value === chip}
                    autoFocus={i === 0}
                    className={`onboarding-chip${value === chip ? " selected" : ""}`}
                    onClick={() => selectChip(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              {/* Chip steps are optional, so they need their own way past — selecting a chip
                  advances, this skips without recording an answer. */}
              <button className="onboarding-next" aria-label="Skip" onClick={advance}>
                <TablerIcon name={stepIndex < STEPS.length - 1 ? "ti-arrow-right" : "ti-check"} />
              </button>
            </div>
          ) : (
            <div className="onboarding-input-row">
              <input
                ref={inputRef}
                autoFocus
                type={step.type}
                value={value}
                placeholder={step.placeholder}
                autoComplete="off"
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
        </div>
      </div>
    </div>
  );
}
