import { describe, expect, it } from "vitest";
import {
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserScrollTool,
  browserReadPageTextTool,
  browserGoBackTool,
  browserCloseSessionTool,
} from "./browserAgentTools";

const ALL_TOOLS = {
  browser_navigate: browserNavigateTool,
  browser_snapshot: browserSnapshotTool,
  browser_click: browserClickTool,
  browser_type: browserTypeTool,
  browser_scroll: browserScrollTool,
  browser_read_page_text: browserReadPageTextTool,
  browser_go_back: browserGoBackTool,
  browser_close_session: browserCloseSessionTool,
};

describe("browser agent tool names", () => {
  it("each tool's static .name matches its expected identifier", () => {
    for (const [expectedName, t] of Object.entries(ALL_TOOLS)) {
      expect(t.name).toBe(expectedName);
    }
  });
});

// needsApproval is always resolved to an async function by the SDK's tool() helper (defaults
// to `async () => false` when not supplied) — see @openai/agents-core's tool.js. Calling it
// directly with placeholder args/context mirrors taskAgentTools.test.ts's approach of testing
// the resolved approval decision rather than mocking the SDK's run loop. The runContext/args
// params are typed strictly per-tool by the SDK's zod-inferred generics; cast through
// `unknown` since this test only cares about the resolved boolean, not the SDK's own typing.
type LooseNeedsApproval = (ctx: unknown, args: unknown, callId?: string) => Promise<boolean>;
async function needsApproval(t: { needsApproval: unknown }) {
  return (t.needsApproval as LooseNeedsApproval)(undefined, {}, "test-call-id");
}

describe("browser agent tool approval gates", () => {
  it("browser_click requires approval", async () => {
    await expect(needsApproval(browserClickTool)).resolves.toBe(true);
  });

  it("browser_type requires approval", async () => {
    await expect(needsApproval(browserTypeTool)).resolves.toBe(true);
  });

  it("browser_navigate does not require approval", async () => {
    await expect(needsApproval(browserNavigateTool)).resolves.toBe(false);
  });

  it("browser_snapshot does not require approval", async () => {
    await expect(needsApproval(browserSnapshotTool)).resolves.toBe(false);
  });

  it("browser_scroll does not require approval", async () => {
    await expect(needsApproval(browserScrollTool)).resolves.toBe(false);
  });

  it("browser_read_page_text does not require approval", async () => {
    await expect(needsApproval(browserReadPageTextTool)).resolves.toBe(false);
  });

  it("browser_go_back does not require approval", async () => {
    await expect(needsApproval(browserGoBackTool)).resolves.toBe(false);
  });

  it("browser_close_session does not require approval", async () => {
    await expect(needsApproval(browserCloseSessionTool)).resolves.toBe(false);
  });
});
