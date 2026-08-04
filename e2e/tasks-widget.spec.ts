import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import {
  launchSandboxedApp,
  launchApp,
  completeOnboarding,
  clickSelector,
  openDb,
  pollUntil,
  type AgentsApiForE2E,
} from "./helpers";

// There is no UI to create a task (electron/main/ai/tools/taskAgentTools.ts's createTaskTool is
// the only real entry point, invoked mid-conversation by the agent, and the scheduler creates
// recurring ones) — see 0-cowork/plans/active/e2e-full-coverage.md. Seeding here goes straight
// through the same window.agentsAPI.tasks.create() contract the agent tool calls, so it still
// exercises the real IPC validation (assertTaskFields) and DB write; only Complete/Delete are
// driven through the actual TasksWidget UI.

const provider = resolveE2EProvider();

// TasksWidget only re-fetches on the "tasks:update" broadcast (electron/main/ipc/agent.ts's
// broadcastTasksUpdate) — the same path Chrono's tools and the scheduler rely on for writes that
// bypass the tasks:* IPC handlers, which is exactly what this seed does too (see the comment
// below). Without firing it ourselves, a task created this way never appears in the widget.
async function broadcastTasksUpdate(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("tasks:update");
  });
}

test.describe("Tasks widget", () => {
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

  test("tasks:create rejects a blank title", async () => {
    const error = await page.evaluate(async () => {
      try {
        await (window.agentsAPI as unknown as AgentsApiForE2E).tasks.create({ title: "" });
        return null;
      } catch (err) {
        return String(err);
      }
    });
    expect(error).toContain("non-empty title");
  });

  test("completes a task through the widget", async () => {
    const created = await page.evaluate(
      () => (window.agentsAPI as unknown as AgentsApiForE2E).tasks.create({ title: "E2E Complete Me" })
    );
    await broadcastTasksUpdate(app);
    await page.waitForSelector(`[aria-label="Complete ${created.title}"]`, { timeout: 10_000 });

    await clickSelector(page, `[aria-label="Complete ${created.title}"]`);

    const done = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT status FROM tasks WHERE id = ?").get(created.id) as
          | { status: string }
          | undefined;
        return r && r.status === "done" ? r : undefined;
      } finally {
        db.close();
      }
    });
    expect(done?.status).toBe("done");
  });

  test("deletes a task through the widget", async () => {
    const created = await page.evaluate(
      () => (window.agentsAPI as unknown as AgentsApiForE2E).tasks.create({ title: "E2E Delete Me" })
    );
    await broadcastTasksUpdate(app);
    await page.waitForSelector(`[aria-label="Delete ${created.title}"]`, { timeout: 10_000 });

    await clickSelector(page, `[aria-label="Delete ${created.title}"]`);

    const gone = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT id FROM tasks WHERE id = ?").get(created.id);
        return r ? undefined : { deleted: true };
      } finally {
        db.close();
      }
    });
    expect(gone?.deleted).toBe(true);
  });
});
