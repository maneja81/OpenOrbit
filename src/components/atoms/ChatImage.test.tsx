import { describe, expect, it, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import ChatImage from "./ChatImage";

describe("ChatImage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders an http(s) image", () => {
    const { container } = render(<ChatImage src="https://example.com/a.png" alt="a chart" autoLoadRemote />);
    const img = container.querySelector("img.chat-image") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("https://example.com/a.png");
    expect(img.getAttribute("alt")).toBe("a chart");
  });

  it("renders an inline data image", () => {
    const { container } = render(<ChatImage src="data:image/png;base64,iVBORw0KGgo=" />);
    expect(container.querySelector("img.chat-image")).not.toBeNull();
  });

  it("refuses file: rather than rendering a blank image", () => {
    // Blocked from the dev server's http origin but loadable from a packaged file:// page —
    // refusing it keeps both environments behaving the same way.
    const { container } = render(<ChatImage src="file:///Users/me/a.png" alt="local" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".chat-image-fallback")?.textContent).toContain("local");
  });

  it("refuses a data: URI that is not an image", () => {
    const { container } = render(<ChatImage src="data:text/html,<script>alert(1)</script>" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".chat-image-fallback")).not.toBeNull();
  });

  it("falls back when the image fails to load", () => {
    const { container } = render(<ChatImage src="https://example.com/gone.png" alt="missing" autoLoadRemote />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".chat-image-fallback")?.textContent).toContain("missing");
  });

  it("renders nothing without a src", () => {
    const { container } = render(<ChatImage />);
    expect(container.firstChild).toBeNull();
  });

  it("opens the image externally on click", () => {
    // window.open is routed to shell.openExternal by setWindowOpenHandler in the main process.
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { container } = render(<ChatImage src="https://example.com/a.png" autoLoadRemote />);
    fireEvent.click(container.querySelector("img") as HTMLImageElement);
    expect(open).toHaveBeenCalledWith("https://example.com/a.png");
  });

  it("clears a previous failure when the src changes", () => {
    // A streaming reply rewrites the bubble on every chunk, so this position can hold a
    // truncated URL one render and the finished one the next. A boolean `failed` made the
    // first error permanent and the working image never appeared.
    const { container, rerender } = render(<ChatImage src="https://example.com/par" alt="p" autoLoadRemote />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector(".chat-image-fallback")).not.toBeNull();

    rerender(<ChatImage src="https://example.com/partial.png" alt="p" autoLoadRemote />);
    expect(container.querySelector("img.chat-image")).not.toBeNull();
    expect(container.querySelector(".chat-image-fallback")).toBeNull();
  });

  it("does not hand a data: URI to the system browser", () => {
    // window.open is routed to shell.openExternal; a message author should not be able to
    // push arbitrary inline content at the OS handler.
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { container } = render(<ChatImage src="data:image/png;base64,iVBORw0KGgo=" />);
    fireEvent.click(container.querySelector("img") as HTMLImageElement);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the image externally from the keyboard", () => {
    // The point of the wrapping button: an <img onClick> had no keyboard path at all.
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { getByRole } = render(<ChatImage src="https://example.com/a.png" alt="a chart" autoLoadRemote />);
    // A real button, so Enter and Space are the browser's job — clicking it is what a key
    // press produces, and that is what this asserts is wired.
    const button = getByRole("button", { name: "Open image in browser: a chart" });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith("https://example.com/a.png");
  });

  it("names the open control without alt text when the author gave none", () => {
    const { getByRole } = render(<ChatImage src="https://example.com/a.png" autoLoadRemote />);
    expect(getByRole("button", { name: "Open image in browser" })).not.toBeNull();
  });

  it("keeps the img an img rather than giving it a button role", () => {
    const { container } = render(<ChatImage src="https://example.com/a.png" alt="a chart" autoLoadRemote />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("role")).toBeNull();
    expect(img.getAttribute("tabindex")).toBeNull();
    expect(img.parentElement?.tagName).toBe("BUTTON");
  });

  it("wraps no button around an image that cannot be opened", () => {
    // A data: URI is never handed to the OS, so there is no action to expose as a control.
    const { container, queryByRole } = render(<ChatImage src="data:image/png;base64,iVBORw0KGgo=" />);
    expect(queryByRole("button")).toBeNull();
    expect(container.querySelector("img")?.parentElement?.tagName).not.toBe("BUTTON");
  });

  it("omits alt entirely when the author gave none", () => {
    // Better for a screen reader to skip a decorative image than to read out a CDN path.
    const { container } = render(<ChatImage src="https://example.com/a.png" autoLoadRemote />);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  describe("remote image consent (default)", () => {
    // The guarantee: no <img> element for a remote URL until a person clicks. No <img> is
    // what makes it a guarantee — a hidden or unloaded <img> would still have fetched.
    it("emits no img for a remote image until it is allowed", () => {
      const { container } = render(<ChatImage src="https://tracker.example/px.gif?d=abc" />);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".chat-image-consent")).not.toBeNull();
    });

    it("names the host and shows the path where exfiltrated data would sit", () => {
      const { container } = render(
        <ChatImage src="https://tracker.example/px.gif?d=eyJzZWNyZXQiOjF9" />
      );
      expect(container.querySelector(".chat-image-consent-host")?.textContent).toBe("tracker.example");
      expect(container.querySelector(".chat-image-consent-path")?.textContent).toBe(
        "/px.gif?d=eyJzZWNyZXQiOjF9"
      );
    });

    it("loads the image once the user clicks", () => {
      const { container, getByRole } = render(<ChatImage src="https://example.com/a.png" alt="chart" />);
      fireEvent.click(getByRole("button", { name: "Load image" }));
      expect(container.querySelector("img.chat-image")?.getAttribute("src")).toBe(
        "https://example.com/a.png"
      );
      expect(container.querySelector(".chat-image-consent")).toBeNull();
    });

    it("does not carry consent onto a url the user never saw", () => {
      // A streaming reply can rewrite this position's src after approval. Consent is stored
      // as the approved URL, so a new one is gated again rather than inheriting the click.
      const { container, getByRole, rerender } = render(<ChatImage src="https://example.com/a.png" />);
      fireEvent.click(getByRole("button", { name: "Load image" }));
      expect(container.querySelector("img")).not.toBeNull();

      rerender(<ChatImage src="https://tracker.example/px.gif?d=abc" />);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".chat-image-consent-host")?.textContent).toBe("tracker.example");
    });

    it("never gates a data: image — it reaches no network", () => {
      const { container } = render(<ChatImage src="data:image/png;base64,iVBORw0KGgo=" />);
      expect(container.querySelector("img.chat-image")).not.toBeNull();
      expect(container.querySelector(".chat-image-consent")).toBeNull();
    });

    it("loads remotely without asking when the setting is on", () => {
      const { container } = render(<ChatImage src="https://example.com/a.png" autoLoadRemote />);
      expect(container.querySelector("img.chat-image")).not.toBeNull();
      expect(container.querySelector(".chat-image-consent")).toBeNull();
    });
  });
});
