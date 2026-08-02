import { isValidElement, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import ChatImage from "@/components/atoms/ChatImage";
import CodeBlock from "@/components/atoms/CodeBlock";
import { firstFenceOffset as findFirstFenceOffset, hasCodeFence } from "@/lib/codeFence";

export type MessageRole = "user" | "assistant";

interface ChatBubbleProps {
  role: MessageRole;
  text: string;
  avatarLabel: string;
  /** Tour anchor for the copy button on this bubble's first code block, if it has one. Set
   * by the live chat panel only — the history modal must not duplicate the id. */
  codeBlockId?: string;
  /** Passed to every ChatImage in this bubble. Off by default so a remote image waits for a
   * click — see AgentsSettings.remoteImagesAutoLoad. */
  autoLoadRemoteImages?: boolean;
}

/** A markdown image — the other construct worth parsing a user's own message for. */
const IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/;

/**
 * Whether a user's typed message should go through the markdown parser.
 *
 * Assistant replies always do — the model writes real markdown. User text is different:
 * people type prose, and parsing it wholesale *destroys* content. "---" on its own becomes
 * an <hr> and the message disappears; four leading spaces silently become a code block;
 * `*not emphasis*` loses its asterisks. So user text is parsed only when it plainly contains
 * one of the two things this feature exists for, and is otherwise rendered literally exactly
 * as it was before.
 */
function shouldParseUserText(text: string): boolean {
  return hasCodeFence(text) || IMAGE_PATTERN.test(text);
}

/** Schemes an anchor may keep. `javascript:` and friends are stripped to plain text, but
 * relative paths, in-page anchors (including remark-gfm's footnote links), tel: and mailto:
 * are all legitimate and were live before this component started overriding `a`. */
function isSafeHref(href: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return /^(https?:|mailto:|tel:)/i.test(href);
  // No scheme at all: relative path, query, or fragment. Nothing to route anywhere unsafe.
  return true;
}

/** Only these reach window.open — everything else stays inert. Relative and fragment hrefs
 * have no meaning outside the app, and handing a data: URI to the OS handler is not
 * something a message author should be able to trigger. */
function isExternallyOpenable(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

/** Pulls the raw source and `language-xxx` class off the <code> element remark nests inside
 * a fenced <pre>. Returns null for a <pre> that isn't shaped that way, so the caller can fall
 * back to rendering it untouched rather than throwing. */
function readFence(node: ReactNode): { code: string; language?: string } | null {
  if (!isValidElement(node)) return null;
  const props = node.props as { className?: string; children?: ReactNode };
  // An empty fence — and every intermediate state of a streaming one — has no children at
  // all. Treating that as "not a fence" made the block flip between a bare <pre> and a
  // CodeBlock mid-stream, and left an empty fence permanently unstyled.
  if (props.children !== undefined && typeof props.children !== "string") return null;
  const code = props.children ?? "";
  // Not [\w-]: a `c++` or `ts,twoslash` info string would be truncated to its first word.
  const language = /language-(\S+)/.exec(props.className ?? "")?.[1];
  // remark leaves a trailing newline on every fence; it would render as a blank last line.
  return { code: code.replace(/\n$/, ""), language };
}

export default function ChatBubble({ role, text, codeBlockId, autoLoadRemoteImages }: ChatBubbleProps) {
  const isUser = role === "user";
  const bodyRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const isOverflowing = el.scrollHeight > el.clientHeight;
    setOverflowing(isOverflowing);
    if (isOverflowing) el.scrollTop = el.scrollHeight;
  }, [text]);

  // Where the bubble's first fence starts in the source. The tour anchor is matched against
  // this offset rather than by counting blocks as they render: any counter would have to live
  // in the components closure and survive re-renders, which walks the id off the block it was
  // meant for. An offset is a pure function of the text, and unique even when two fences in
  // one message contain identical code.
  const firstFenceOffset = useMemo(() => findFirstFenceOffset(text), [text]);

  const components = useMemo<Components>(
    () => ({
      // Fenced code arrives as <pre><code class="language-x">; inline code arrives as a bare
      // <code> and is left alone, so the override belongs on <pre> rather than on <code>.
      pre({ children, node }) {
        const fence = readFence(children);
        if (!fence) return <pre>{children}</pre>;
        const isAnchor =
          codeBlockId !== undefined &&
          firstFenceOffset !== null &&
          node?.position?.start?.offset === firstFenceOffset;
        return (
          <CodeBlock code={fence.code} language={fence.language} id={isAnchor ? codeBlockId : undefined} />
        );
      },
      img({ src, alt, title }) {
        return (
          <ChatImage
            src={typeof src === "string" ? src : undefined}
            alt={alt}
            title={title}
            autoLoadRemote={autoLoadRemoteImages}
          />
        );
      },
      a({ href, children }) {
        // Without this an in-bubble link does nothing at all: will-navigate is cancelled in
        // the main process, so the default navigation is blocked. window.open is routed to
        // shell.openExternal instead — but only for schemes that mean something outside the
        // app. A fragment link (remark-gfm's footnotes) keeps its href and default behaviour.
        if (!href || !isSafeHref(href)) return <>{children}</>;
        // Kept as a real anchor so the destination is visible and copyable, but the click is
        // swallowed: will-navigate cancels it in the main process anyway, so letting it
        // through only attempts a navigation that is guaranteed to be thrown away.
        if (!isExternallyOpenable(href)) {
          return (
            <a href={href} onClick={(e) => e.preventDefault()}>
              {children}
            </a>
          );
        }
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              window.open(href);
            }}
          >
            {children}
          </a>
        );
      },
      table({ children }) {
        // A wide table scrolls inside its own container rather than stretching the bubble.
        return (
          <div className="mb-table-wrap">
            <table>{children}</table>
          </div>
        );
      },
    }),
    [codeBlockId, firstFenceOffset, autoLoadRemoteImages]
  );

  // Plain typed prose stays literal, exactly as it rendered before this component learned
  // markdown — see shouldParseUserText for why parsing it wholesale is destructive.
  const plain = isUser && !shouldParseUserText(text);

  return (
    <div className={`m ${isUser ? "u" : "a"}`}>
      <div
        ref={bodyRef}
        className={`mb mb--${role}${plain ? " mb--plain" : ""}${overflowing ? " scrollable" : ""}`}
      >
        {plain ? (
          text
        ) : (
        /* A fence or an image is worth rendering wherever it came from, so a user message
           containing one goes through the same pipeline as a reply. Single line breaks
           survive via `white-space: pre-wrap` on .mb--user p, which markdown would otherwise
           fold away. No rehype-raw, so raw HTML in either role stays inert. */
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={components}
          // react-markdown's default urlTransform blanks any scheme outside http/https/
          // mailto/tel, which silently emptied `src` on data: and file: images — they
          // vanished with no fallback, since the component never saw a URL to reject. URL
          // policy lives in the components instead, where it is explicit and tested:
          // isSafeHref gates anchors, isDisplayable gates images, and anything they refuse
          // renders as text or a fallback card rather than disappearing.
          urlTransform={(url) => url}
        >
          {text}
        </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
