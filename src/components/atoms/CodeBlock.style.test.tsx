import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import ChatBubble from "@/components/atoms/ChatBubble";

/**
 * Loads the real stylesheet and asserts computed values, which no other test here does.
 *
 * The bug this guards: `.code-block-body` is (0,1,0) while the generic markdown rule
 * `.mb pre` is (0,1,1), so every declaration written to strip the old code styling lost
 * silently. The block still rendered — with an opaque panel, its own border and a stray
 * bottom margin nested inside the new frosted container. Nothing in the type checker, the
 * linter, or a DOM-shape test can see that; only computed style can.
 */
describe("CodeBlock computed style", () => {
  it("wins against the generic .mb pre markdown rules", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/globals.css", "utf8");
    document.head.appendChild(style);

    const { container } = render(
      <ChatBubble role="assistant" text={"```ts\nconst a = 1;\n```"} avatarLabel="A" />
    );
    const pre = container.querySelector("pre.code-block-body") as HTMLElement;
    const cs = getComputedStyle(pre);
    const code = getComputedStyle(pre.querySelector("code") as HTMLElement);

    // Each of these is a value `.mb pre` / `.mb pre code` would otherwise impose.
    expect(cs.backgroundColor).toBe("rgba(0, 0, 0, 0)"); // not rgba(0, 0, 0, 0.25)
    expect(cs.borderTopStyle).toBe("none"); // not 0.5px solid
    expect(cs.borderRadius).toBe("0px"); // not 8px — the container owns the radius
    expect(cs.padding).toBe("8px 10px"); // not 10px 12px
    expect(cs.margin).toBe("0px"); // not 0 0 8px, which left a dead strip inside the block
    expect(code.fontSize).toBe("12px"); // not 0.85em

    style.remove();
  });

  it("does not stack the wrapper's margin with the table's own", () => {
    // Same trap, found by the recurrence check: `.mb-table-wrap table` ties with `.mb table`
    // on specificity and loses on source order, so the gap under every table was 16px.
    const style = document.createElement("style");
    style.textContent = readFileSync("src/globals.css", "utf8");
    document.head.appendChild(style);

    const { container } = render(
      <ChatBubble role="assistant" text={"| a | b |\n| - | - |\n| 1 | 2 |"} avatarLabel="A" />
    );
    const wrap = getComputedStyle(container.querySelector(".mb-table-wrap") as HTMLElement);
    const table = getComputedStyle(container.querySelector("table") as HTMLElement);

    expect(wrap.marginBottom).toBe("8px");
    expect(table.marginBottom).toBe("0px");

    style.remove();
  });
});
