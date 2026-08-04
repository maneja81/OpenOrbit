import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import { launchSandboxedApp, launchApp, completeOnboarding, typeIntoField, openDb, pollUntil } from "./helpers";

// The only spec in this suite that makes a real, billed AI provider call — see
// 0-cowork/plans/active/e2e-full-coverage.md Phase 4. Cost is whatever E2E_PROVIDER/.env.test
// resolves to (see providerConfig.ts) — this spec does not force a specific provider, since the
// harness has no way to override a run someone else configured. When E2E_PROVIDER=openrouter, the
// registry's default model for it is a "latest cheap/fast" floating alias
// (electron/main/ai/providers.ts), which is what onboarding accepts by default; unset or
// E2E_PROVIDER=openai instead bills against gpt-4.1-mini.
//
// agent:runStream has no single IPC promise this test process can await directly — the renderer
// only surfaces the result as DOM/DB effects (see AgentsApp.tsx's onStreamChunk/onStreamAgent
// listeners). The messages table (written server-side in agent:runStream's handler, before the
// IPC promise resolves) is the stable thing to poll — never assert on exact reply text, since a
// live model's wording isn't something this test controls.
//
// A trivial prompt still goes through the orchestrator's own routing hop before any reply, which
// is a second real model round trip — both the app's own agentRunTimeoutSeconds (default 60s) and
// Playwright's default test timeout are tight for that under normal network jitter, so both are
// raised here.

const provider = resolveE2EProvider();

test.describe("Core chat flow", () => {
  test.setTimeout(120_000);

  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test("sends a message and receives a real routed agent reply", async () => {
    const before = openDb(userData);
    const beforeCount = before.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    before.close();

    await typeIntoField(page, "#inp", "Reply with just the word OK, nothing else.");
    await page.keyboard.press("Enter");

    const assistantRow = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const row = db
          .prepare("SELECT role, text, trace_id FROM messages WHERE role = 'assistant' ORDER BY id DESC LIMIT 1")
          .get() as { role: string; text: string; trace_id: string | null } | undefined;
        return row ? row : undefined;
      } finally {
        db.close();
      }
    }, 90_000);

    expect(assistantRow, "no assistant reply landed in the sandbox DB").toBeDefined();
    expect(assistantRow!.text.length).toBeGreaterThan(0);
    expect(assistantRow!.trace_id).not.toBeNull();

    const after = openDb(userData);
    const afterCount = after.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    after.close();
    // At least the user turn and the assistant reply — an orchestrator handoff can add more.
    expect(afterCount.n).toBeGreaterThanOrEqual(beforeCount.n + 2);
  });
});
