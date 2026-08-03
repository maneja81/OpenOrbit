import { useEffect, useRef, useState } from "react";
import IconButton from "@/components/atoms/IconButton";
import TablerIcon from "@/components/atoms/TablerIcon";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";

interface CodeBlockProps {
  code: string;
  /** From the fence's `language-xxx` class. Absent for a bare ``` fence. */
  language?: string;
  /** Tour anchor, set on the first block in the live panel only — ids must be unique. */
  id?: string;
}

const COPIED_RESET_MS = 1500;

/**
 * A fenced code block: language label and copy button in a header strip, code below.
 *
 * No syntax highlighting — the reference implementation uses shiki, which is a sizeable
 * dependency plus a THIRD_PARTY_NOTICES obligation for a feature nothing has asked for yet.
 * This component is the seam where it would land, so call sites wouldn't change.
 */
export default function CodeBlock({ code, language, id }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Both failure paths say so rather than leaving the button inert. An unchanged icon reads
  // as "the click missed", not "copying is unavailable here", and CLAUDE.md requires
  // user-facing errors to go through humanizeError rather than being swallowed.
  const copy = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const fail = (reason: unknown) => {
      setCopied(false);
      setError(formatHumanizedError(humanizeError(reason)));
      timerRef.current = setTimeout(() => setError(null), COPIED_RESET_MS);
    };

    // Absent in jsdom and in any non-secure context.
    if (!navigator.clipboard) {
      fail(new Error("Copying isn't available here."));
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
    } catch (e) {
      fail(e);
      return;
    }
    setError(null);
    setCopied(true);
    timerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  return (
    <div className="code-block">
      <div className="code-block-head">
        {language && <span className="code-block-lang">{language}</span>}
        {error && (
          <span className="code-block-error" role="status">
            {error}
          </span>
        )}
        <IconButton
          id={id}
          type="button"
          className="code-block-copy"
          aria-label={copied ? "Copied" : "Copy code"}
          title={error ?? undefined}
          onClick={copy}
        >
          <TablerIcon name={error ? "ti-alert-triangle" : copied ? "ti-check" : "ti-copy"} />
        </IconButton>
      </div>
      <pre className="code-block-body">
        <code>{code}</code>
      </pre>
    </div>
  );
}
