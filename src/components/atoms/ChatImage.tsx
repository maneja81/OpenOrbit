import { MouseEvent, useState } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";

interface ChatImageProps {
  src?: string;
  alt?: string;
  title?: string;
  /** When false (the default), a remote image waits for a click before it loads — see
   * AgentsSettings.remoteImagesAutoLoad for why that default is the security control. */
  autoLoadRemote?: boolean;
}

/** Remote means "fetching it tells someone else you read this message". `data:` carries its
 * own bytes and touches no network, so it is never gated. */
function isRemote(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** Host on its own line, path second — the host is who gets told, and the path is where
 * exfiltrated data would sit. Both need to be readable before anyone consents. */
function describeUrl(src: string): { host: string; rest: string } {
  try {
    const url = new URL(src);
    return { host: url.host, rest: `${url.pathname}${url.search}` };
  } catch {
    // Unparseable but scheme-matched: show it whole rather than claiming a host we
    // could not read.
    return { host: src, rest: "" };
  }
}

/**
 * Schemes we are willing to put in an <img>.
 *
 * `file:` is deliberately absent even though a packaged build could load it: the renderer is
 * served from http://localhost in dev, where Chromium blocks file:// images outright. Allowing
 * it would mean an image that works in the packaged app and silently fails in dev. Refusing it
 * in both makes the fallback card the consistent answer.
 */
function isDisplayable(src: string): boolean {
  return /^https?:\/\//i.test(src) || /^data:image\//i.test(src);
}

/** A markdown image inside a message. Clicking opens it in the system browser — window.open
 * is routed to shell.openExternal by setWindowOpenHandler (electron/main/index.ts), so this
 * needs no IPC of its own. */
export default function ChatImage({ src, alt, title, autoLoadRemote = false }: ChatImageProps) {
  // Which src failed, not whether one did. A streaming reply rewrites this bubble on every
  // chunk, so the same tree position can hold a truncated URL one render and the finished one
  // the next — a plain boolean would make the first failure permanent and the working image
  // would never appear. Storing the URL means a new src clears the state for free, with no
  // reset effect to cascade a render.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === src;
  // Consent is stored as the URL it was given for, same reasoning as failedSrc — and it
  // matters more here: if a stream rewrote the URL under an approval the user already gave,
  // a boolean would carry that approval onto a URL they never saw.
  const [allowedSrc, setAllowedSrc] = useState<string | null>(null);

  if (!src) return null;

  if (!isDisplayable(src) || failed) {
    return (
      <span className="chat-image-fallback">
        <TablerIcon name={failed ? "ti-alert-triangle" : "ti-photo"} />
        <span>{alt || src}</span>
      </span>
    );
  }

  // No request has been made at this point and none will be until this returns an <img>.
  if (isRemote(src) && !autoLoadRemote && allowedSrc !== src) {
    const { host, rest } = describeUrl(src);
    return (
      <span className="chat-image-consent">
        <span className="chat-image-consent-head">
          <TablerIcon name="ti-photo-off" />
          <span className="chat-image-consent-title">{alt || "Remote image"}</span>
        </span>
        <span className="chat-image-consent-host">{host}</span>
        {rest && (
          <span className="chat-image-consent-path" title={src}>
            {rest}
          </span>
        )}
        <button
          type="button"
          className="settings-action-btn-sm"
          onClick={() => setAllowedSrc(src)}
        >
          Load image
        </button>
      </span>
    );
  }

  // Only a real remote image is worth handing to the OS. A data: URI is message-authored
  // content of arbitrary length and type, and shell.openExternal is not the place for it.
  const openable = /^https?:\/\//i.test(src);

  const open = (e: MouseEvent) => {
    // An image inside a link would otherwise fire the anchor's handler too, opening twice.
    e.preventDefault();
    e.stopPropagation();
    window.open(src);
  };

  const image = (
    <img
      className={openable ? "chat-image chat-image--openable" : "chat-image"}
      src={src}
      // Empty rather than the URL when the author gave no alt: a screen reader announcing a
      // long CDN path is worse than skipping a decorative image.
      alt={alt ?? ""}
      title={title}
      onError={() => setFailedSrc(src)}
    />
  );

  if (!openable) return image;

  // A real button rather than ARIA on the <img>: the image stays an image, and the
  // open-externally action becomes a control the keyboard can reach. The button carries the
  // whole accessible name because the img's alt is empty whenever the author gave none.
  return (
    <button
      type="button"
      className="chat-image-open"
      onClick={open}
      aria-label={alt ? `Open image in browser: ${alt}` : "Open image in browser"}
    >
      {image}
    </button>
  );
}
