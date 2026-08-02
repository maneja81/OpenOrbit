import { useCallback, useEffect, useRef, useState } from "react";

/** How close to the bottom still counts as "at the bottom". Wide enough that a partially
 * scrolled last line doesn't flip the state, narrow enough that reading back one message
 * does. */
const AT_BOTTOM_THRESHOLD_PX = 60;

export function isScrolledToBottom(el: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_THRESHOLD_PX;
}

/**
 * Stick-to-bottom behaviour for the chat log.
 *
 * Replaces an unconditional "scroll to the bottom whenever messages change" effect. That
 * was invisible while only the last exchange rendered, but with a real backlog on screen it
 * drags the view down every time a streaming chunk lands — including while the user is
 * reading something further up. Here, new content only follows when the view is already at
 * the bottom; otherwise `isAtBottom` goes false and the caller can offer a jump button.
 *
 * A stream grows the content without firing a scroll event, so growth is watched with a
 * MutationObserver. A ResizeObserver on the container would never fire: the log is
 * max-height capped, so its own box stays exactly the same size as content overflows it.
 */
export function useScrollToBottom<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // Mirrored in a ref so the observer callback reads the current value without being torn
  // down and re-created on every state flip.
  const atBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const sync = () => {
      const atBottom = isScrolledToBottom(el);
      atBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    };

    // Content grew (a chunk streamed in, a bubble expanded). Follow it only if the reader
    // was already at the bottom — "instant" so a stream doesn't animate on every chunk.
    const follow = () => {
      if (!atBottomRef.current) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    };

    el.addEventListener("scroll", sync, { passive: true });
    // childList catches a new turn being appended; characterData catches a reply growing
    // token by token inside a bubble that already exists.
    const observer = new MutationObserver(follow);
    observer.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, []);

  return { containerRef, isAtBottom, scrollToBottom };
}
