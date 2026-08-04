import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import { launchSandboxedApp, launchApp, completeOnboarding, typeIntoField, clickSelector } from "./helpers";

// AgentsApp.tsx's handleSend intercepts these exact strings BEFORE any provider call (see
// 0-cowork/plans/active/e2e-full-coverage.md Phase 4) — genuinely zero-cost, local-only. Two
// commands in the same intercept block are deliberately excluded: /agents-create rewrites the
// text and falls through to a real orchestrator call, and /<agent-slug> routing is likewise a
// real call — neither belongs in a zero-cost spec. /add-file and /add-folder open native OS
// pickers Playwright can't drive, and /tour's resulting DOM wasn't traced for this phase — all
// three are left uncovered here rather than guessed at.

const provider = resolveE2EProvider();

// Typing a full command opens ChatInputBar's own autocomplete menu (matches the app's other
// slash-driven surfaces) — Enter while it's open selects the highlighted menu item (completing
// the text) rather than submitting. Escape closes the menu without touching the typed text, so
// the next Enter takes the normal send path and handleSend's exact-string intercept fires.
async function sendSlashCommand(page: Page, command: string): Promise<void> {
  await typeIntoField(page, "#inp", command);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
}

test.describe("Slash-command interception", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    const { userData } = launchSandboxedApp();
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test("/settings opens the Settings modal", async () => {
    await sendSlashCommand(page, "/settings");
    await page.waitForSelector('[role="dialog"][aria-label="Settings"]', { timeout: 10_000 });
    await clickSelector(page, '[aria-label="Close settings"]');
  });

  test("/chat-history opens the Chat History modal", async () => {
    await sendSlashCommand(page, "/chat-history");
    await page.waitForSelector('[role="dialog"][aria-label="Chat History"]', { timeout: 10_000 });
    await clickSelector(page, '.modal-panel--chat-history [aria-label="Close"]');
  });

  test("/http-tools opens Settings deep-linked to the HTTP Tools section", async () => {
    await sendSlashCommand(page, "/http-tools");
    await page.waitForSelector('[role="dialog"][aria-label="Settings"]', { timeout: 10_000 });
    const title = await page.evaluate(() => document.querySelector(".settings-detail h1")?.textContent ?? "");
    expect(title).toBe("HTTP Tools");
    await clickSelector(page, '[aria-label="Close settings"]');
  });

  test("/knowledgebase opens the Knowledge modal", async () => {
    await sendSlashCommand(page, "/knowledgebase");
    await page.waitForSelector('[role="dialog"][aria-label="Knowledge"]', { timeout: 10_000 });
    await clickSelector(page, '.km-header [aria-label="Close"]');
  });

  test("/system-stats appends a local reply with no provider call", async () => {
    const before = await page.evaluate(() => document.querySelectorAll("#chat-log .turn.assistant").length);
    await sendSlashCommand(page, "/system-stats");
    await page.waitForFunction(
      (n) => document.querySelectorAll("#chat-log .turn.assistant").length > n,
      before,
      { timeout: 10_000 }
    );
    const lastReply = await page.evaluate(() => {
      const turns = [...document.querySelectorAll("#chat-log .turn.assistant .mb--assistant")];
      return turns[turns.length - 1]?.textContent ?? "";
    });
    expect(lastReply).toMatch(/CPU:|not available/);
  });

  test("/usage appends a local reply with no provider call", async () => {
    const before = await page.evaluate(() => document.querySelectorAll("#chat-log .turn.assistant").length);
    await sendSlashCommand(page, "/usage");
    await page.waitForFunction(
      (n) => document.querySelectorAll("#chat-log .turn.assistant").length > n,
      before,
      { timeout: 10_000 }
    );
    const lastReply = await page.evaluate(() => {
      const turns = [...document.querySelectorAll("#chat-log .turn.assistant .mb--assistant")];
      return turns[turns.length - 1]?.textContent ?? "";
    });
    expect(lastReply).toMatch(/Today's usage/);
  });
});
