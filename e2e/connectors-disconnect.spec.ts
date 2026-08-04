import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { resolveE2EProvider } from "./providerConfig";
import {
  launchSandboxedApp,
  launchApp,
  completeOnboarding,
  openSettingsTab,
  clickByText,
  clickInLabeledRow,
  dbPath,
  openDb,
  pollUntil,
} from "./helpers";

// Only `disconnect` is covered — `connect`/`test` need a real, already-authorized Google account
// and driving the OS's actual system browser through Google's consent screen (runOAuthFlow calls
// shell.openExternal, entirely outside Playwright's _electron control surface), which this
// harness deliberately doesn't attempt. See 0-cowork/plans/active/e2e-full-coverage.md Phase 5 —
// deferred pending a decision on a dedicated test account, possibly with a human-in-the-loop step
// for the consent screen rather than full automation.
//
// There is no UI path to reach a "connected" status without a real OAuth round trip, so this
// spec seeds one directly into the sandbox DB (same pattern as tasks-widget.spec.ts seeding a
// task via the IPC bridge directly) — the same shape connect's own saveConnectorCredentials
// would leave behind (connectorsStore.ts), just without a real token in it.

const provider = resolveE2EProvider();

test.describe("Settings — Connectors tab — disconnect", () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);

    const db = new Database(dbPath(userData));
    db.prepare(
      `INSERT INTO connectors (id, type, status, account_label, credentials, updated_at)
       VALUES ('gmail', 'gmail', 'connected', 'e2e-test@example.com', '{}', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET status = 'connected', account_label = 'e2e-test@example.com'`
    ).run();
    db.close();

    // useConnectors.ts only fetches the catalog once on mount — it has no reason to know a
    // connector changed unless the main process pushes "connectors:update" (the same broadcast a
    // real connect/disconnect triggers). A direct DB write like the one above never fires it.
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send("connectors:update");
    });

    await openSettingsTab(page, "Connectors");
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test("disconnects a connected connector and clears its credentials", async () => {
    // Gmail is a child grouped under the "Google Account" parent (googleAccountConnector.ts) —
    // its own row has no accordion of its own to expand, only the parent does. 4 Google
    // connectors total (gmail/calendar/drive/contacts), 1 seeded connected, matching
    // formatGroupStatus's "N of M connected" text exactly.
    await page.waitForSelector(".agent-accordion-name", { timeout: 10_000 });
    await clickByText(page, "Google Account — 1 of 4 connected");
    await page.waitForSelector(".connector-service-row", { timeout: 10_000 });
    await clickInLabeledRow(page, ".connector-service-row", "Gmail", "Disconnect");

    const row = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT status, account_label, credentials FROM connectors WHERE id = 'gmail'").get() as
          | { status: string; account_label: string | null; credentials: string | null }
          | undefined;
        return r && r.status === "disconnected" ? r : undefined;
      } finally {
        db.close();
      }
    });
    expect(row?.status).toBe("disconnected");
    expect(row?.account_label).toBeNull();
    expect(row?.credentials).toBeNull();
  });
});
