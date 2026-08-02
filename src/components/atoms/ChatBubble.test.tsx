import { describe, expect, it, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import ChatBubble from "./ChatBubble";

const FENCE = "```ts\nconst a = 1;\n```";

describe("ChatBubble", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a fenced block as a CodeBlock in an assistant reply", () => {
    const { container } = render(<ChatBubble role="assistant" text={FENCE} avatarLabel="A" />);
    expect(container.querySelector(".code-block")).not.toBeNull();
    expect(container.querySelector(".code-block-lang")?.textContent).toBe("ts");
    expect(container.querySelector(".code-block-body code")?.textContent).toBe("const a = 1;");
  });

  it("renders a fenced block in a user message too", () => {
    // User text used to render literally; a pasted snippet showed as raw backticks.
    const { container } = render(<ChatBubble role="user" text={FENCE} avatarLabel="M" />);
    expect(container.querySelector(".code-block")).not.toBeNull();
  });

  it("renders an empty fence as a CodeBlock, not a bare pre", () => {
    // Every intermediate state of a streaming fence looks like this. Treating it as "not a
    // fence" made the block visibly swap element types mid-reply. CodeBlock's own test for
    // this passed throughout by rendering the component directly.
    const { container } = render(<ChatBubble role="assistant" text={"```ts\n```"} avatarLabel="A" />);
    expect(container.querySelector(".code-block")).not.toBeNull();
    expect(container.querySelector(".code-block-lang")?.textContent).toBe("ts");
    expect(container.querySelector("pre:not(.code-block-body)")).toBeNull();
  });

  it("keeps the same element type across a streaming fence", () => {
    const full = "Here you go:\n\n```ts\nconst a = 1;\n```";
    for (let i = full.indexOf("```") + 3; i <= full.length; i++) {
      const { container, unmount } = render(
        <ChatBubble role="assistant" text={full.slice(0, i)} avatarLabel="A" />
      );
      expect(container.querySelector(".code-block")).not.toBeNull();
      expect(container.querySelector("pre:not(.code-block-body)")).toBeNull();
      unmount();
    }
  });

  it("does not parse plain user prose as markdown", () => {
    // Parsing wholesale destroys typed text: "---" became an <hr> and the message vanished,
    // and four leading spaces became a code block.
    const { container: rule } = render(<ChatBubble role="user" text="---" avatarLabel="M" />);
    expect(rule.querySelector("hr")).toBeNull();
    expect(rule.querySelector(".mb")?.textContent).toBe("---");
    cleanup();

    const { container: indented } = render(
      <ChatBubble role="user" text="    please look at this" avatarLabel="M" />
    );
    expect(indented.querySelector(".code-block")).toBeNull();
    expect(indented.querySelector(".mb")?.textContent).toBe("    please look at this");
    cleanup();

    const { container: stars } = render(
      <ChatBubble role="user" text="my_var_name and *not* a star" avatarLabel="M" />
    );
    expect(stars.querySelector(".mb")?.textContent).toBe("my_var_name and *not* a star");
    expect(stars.querySelector(".mb--plain")).not.toBeNull();
  });

  it("still parses a user message that carries a fence or an image", () => {
    const { container: withImage } = render(
      <ChatBubble role="user" text="look: ![x](https://example.com/a.png)" avatarLabel="M" autoLoadRemoteImages />
    );
    expect(withImage.querySelector("img.chat-image")).not.toBeNull();
    expect(withImage.querySelector(".mb--plain")).toBeNull();
  });

  it("leaves inline code as inline code", () => {
    const { container } = render(
      <ChatBubble role="assistant" text="use `npm run build` first" avatarLabel="A" />
    );
    expect(container.querySelector(".code-block")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe("npm run build");
  });

  it("keeps a user's single line breaks", () => {
    // Markdown folds a single newline into one paragraph; .mb--user p restores it with
    // pre-wrap, so the newline has to survive into the DOM for that CSS to have anything
    // to act on.
    const { container } = render(<ChatBubble role="user" text={"first\nsecond"} avatarLabel="M" />);
    const text = container.querySelector(".mb")?.textContent ?? "";
    expect(text).toContain("first");
    expect(text).toContain("second");
    expect(text).toContain("\n");
  });

  it("tags the bubble with its role", () => {
    const { container } = render(<ChatBubble role="user" text="hi" avatarLabel="M" />);
    expect(container.querySelector(".mb--user")).not.toBeNull();
    expect(container.querySelector(".mb--assistant")).toBeNull();
  });

  it("renders a markdown image through ChatImage", () => {
    const { container } = render(
      <ChatBubble role="assistant" text="![chart](https://example.com/a.png)" avatarLabel="A" autoLoadRemoteImages />
    );
    expect(container.querySelector("img.chat-image")?.getAttribute("src")).toBe(
      "https://example.com/a.png"
    );
  });

  it("renders an inline data: image through the markdown pipeline", () => {
    // react-markdown's default urlTransform blanks non-http schemes, which made data: images
    // disappear entirely — no <img>, and no fallback either, because ChatImage never saw a
    // URL to refuse. ChatImage's own tests couldn't catch it: they bypass the pipeline.
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";
    const { container } = render(
      <ChatBubble role="assistant" text={`![dot](${gif})`} avatarLabel="A" />
    );
    expect(container.querySelector("img.chat-image")?.getAttribute("src")).toBe(gif);
  });

  it("shows the fallback for a file: image rather than dropping it", () => {
    const { container } = render(
      <ChatBubble role="user" text="![local](file:///tmp/x.png)" avatarLabel="M" />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".chat-image-fallback")?.textContent).toContain("local");
  });

  it("opens a link externally instead of navigating", () => {
    // will-navigate is cancelled in the main process, so without the override a link click
    // does nothing at all.
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { container } = render(
      <ChatBubble role="assistant" text="[docs](https://example.com)" avatarLabel="A" />
    );
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);
    expect(open).toHaveBeenCalledWith("https://example.com");
  });

  it("keeps relative, fragment and tel links instead of deleting them", () => {
    // A scheme allowlist stripped these to bare text, losing the destination with no trace.
    // Fragment links are also how remark-gfm renders footnotes.
    for (const [md, href] of [
      ["[docs](./a.md)", "./a.md"],
      ["[top](#head)", "#head"],
      ["[call](tel:+15551234)", "tel:+15551234"],
    ] as const) {
      const { container, unmount } = render(
        <ChatBubble role="assistant" text={md} avatarLabel="A" />
      );
      expect(container.querySelector("a")?.getAttribute("href")).toBe(href);
      unmount();
    }
  });

  it("renders footnote links rather than swallowing them", () => {
    const { container } = render(
      <ChatBubble role="assistant" text={"note[^1]\n\n[^1]: the note"} avatarLabel="A" />
    );
    expect(container.querySelector("a[href^='#']")).not.toBeNull();
  });

  it("does not hand a relative href to the system browser", () => {
    // window.open is routed to shell.openExternal; a relative path means nothing out there.
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { container } = render(
      <ChatBubble role="assistant" text="[docs](./a.md)" avatarLabel="A" />
    );
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);
    expect(open).not.toHaveBeenCalled();
  });

  it("refuses to render a javascript: link as an anchor", () => {
    const { container } = render(
      <ChatBubble role="assistant" text="[click](javascript:alert(1))" avatarLabel="A" />
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector(".mb")?.textContent).toContain("click");
  });

  it("does not render raw HTML from either role", () => {
    // No rehype-raw is configured; this test is what stops someone adding it without
    // thinking about model- or user-supplied markup.
    const evil = "<script>alert(1)</script><img src=x onerror=alert(1)>";
    const { container: assistant } = render(
      <ChatBubble role="assistant" text={evil} avatarLabel="A" />
    );
    expect(assistant.querySelector("script")).toBeNull();
    expect(assistant.querySelector("img")).toBeNull();
    cleanup();

    const { container: user } = render(<ChatBubble role="user" text={evil} avatarLabel="M" />);
    expect(user.querySelector("script")).toBeNull();
    expect(user.querySelector("img")).toBeNull();
  });

  it("wraps a table so it can scroll instead of stretching the bubble", () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { container } = render(<ChatBubble role="assistant" text={table} avatarLabel="A" />);
    expect(container.querySelector(".mb-table-wrap table")).not.toBeNull();
  });

  it("gives the tour anchor to the first fence only", () => {
    const two = `${FENCE}\n\nand then\n\n\`\`\`sh\necho hi\n\`\`\``;
    const { container } = render(
      <ChatBubble role="assistant" text={two} avatarLabel="A" codeBlockId="code-block-copy" />
    );
    expect(container.querySelectorAll(".code-block")).toHaveLength(2);
    expect(container.querySelectorAll("#code-block-copy")).toHaveLength(1);
    // It must be the first block's button, not whichever rendered last.
    const first = container.querySelectorAll(".code-block")[0];
    expect(first.querySelector("#code-block-copy")).not.toBeNull();
  });

  it("gives the anchor to exactly one block when two fences are identical", () => {
    // Matching by source offset rather than by code text is what makes this hold.
    const twins = `${FENCE}\n\n${FENCE}`;
    const { container } = render(
      <ChatBubble role="assistant" text={twins} avatarLabel="A" codeBlockId="code-block-copy" />
    );
    expect(container.querySelectorAll(".code-block")).toHaveLength(2);
    expect(container.querySelectorAll("#code-block-copy")).toHaveLength(1);
  });

  it("keeps a multi-character language label intact", () => {
    const { container } = render(
      <ChatBubble role="assistant" text={"```c++\nint x;\n```"} avatarLabel="A" />
    );
    expect(container.querySelector(".code-block-lang")?.textContent).toBe("c++");
  });

  it("anchors a tilde fence as readily as a backtick one", () => {
    const { container } = render(
      <ChatBubble role="assistant" text={"~~~js\nx\n~~~"} avatarLabel="A" codeBlockId="code-block-copy" />
    );
    expect(container.querySelectorAll("#code-block-copy")).toHaveLength(1);
  });

  it("carries no anchor when the panel did not assign one", () => {
    // The history modal renders the same component over the live panel; a duplicated id
    // there would break the tour selector.
    const { container } = render(<ChatBubble role="assistant" text={FENCE} avatarLabel="A" />);
    expect(container.querySelector("#code-block-copy")).toBeNull();
  });
});
