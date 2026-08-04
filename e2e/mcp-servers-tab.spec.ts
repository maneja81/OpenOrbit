import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { resolveE2EProvider } from "./providerConfig";
import {
  launchSandboxedApp,
  launchApp,
  completeOnboarding,
  openSettingsTab,
  clickByText,
  clickSelector,
  typeIntoNth,
  confirmTypeToDelete,
  openDb,
  pollUntil,
} from "./helpers";

// mcp:create/update/delete/toggle are pure local DB writes with no command validation (see
// electron/main/ai/mcp.ts's createMcpServer) — a fake command is safe to use throughout. Only
// mcp:test's failure path is exercised: a real successful connect needs an actual MCP-protocol
// server process on the other end (MCPServerStdio's real JSON-RPC handshake), which this harness
// doesn't provision — see 0-cowork/plans/active/e2e-full-coverage.md Phase 2.

const provider = resolveE2EProvider();

test.describe("Settings — MCP Servers tab", () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
    await openSettingsTab(page, "MCP Servers");
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test("creates, edits, toggles, and deletes a server with a fake command", async () => {
    await clickByText(page, "Add MCP Server");
    await typeIntoNth(page, ".mcp-add-form", "input", 0, "E2E Server");
    await typeIntoNth(page, ".mcp-add-form", "input", 1, "does-not-exist-xyz");
    await typeIntoNth(page, ".mcp-add-form", "input", 2, "--flag value");
    await typeIntoNth(page, ".mcp-add-form", "textarea", 0, "API_KEY=test-value");
    await clickByText(page, "Save", ".mcp-add-form");

    const server = await pollUntil(() => {
      const db = openDb(userData);
      try {
        return db.prepare("SELECT id, command, args, enabled FROM mcp_servers WHERE name = ?").get("E2E Server") as
          | { id: string; command: string; args: string; enabled: number }
          | undefined;
      } finally {
        db.close();
      }
    });
    expect(server, "server never appeared in the sandbox DB").toBeDefined();
    expect(server!.command).toBe("does-not-exist-xyz");
    expect(JSON.parse(server!.args)).toEqual(["--flag", "value"]);
    expect(server!.enabled).toBe(1);

    // Expand the row and edit the command.
    await clickByText(page, "E2E Server");
    await typeIntoNth(page, ".agent-accordion-body", "input", 1, "still-does-not-exist");
    await clickByText(page, "Save changes", ".agent-accordion-body");

    const updated = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT command FROM mcp_servers WHERE id = ?").get(server!.id) as
          | { command: string }
          | undefined;
        return r && r.command === "still-does-not-exist" ? r : undefined;
      } finally {
        db.close();
      }
    });
    expect(updated?.command).toBe("still-does-not-exist");

    // Toggle disabled.
    await clickSelector(page, '[aria-label="Toggle E2E Server"]');
    const disabled = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT enabled FROM mcp_servers WHERE id = ?").get(server!.id) as
          | { enabled: number }
          | undefined;
        return r && r.enabled === 0 ? r : undefined;
      } finally {
        db.close();
      }
    });
    expect(disabled?.enabled).toBe(0);

    // Delete (type-to-confirm).
    await clickSelector(page, '[aria-label="Remove E2E Server"]');
    await confirmTypeToDelete(page);

    const gone = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT id FROM mcp_servers WHERE id = ?").get(server!.id);
        return r ? undefined : { deleted: true };
      } finally {
        db.close();
      }
    });
    expect(gone?.deleted).toBe(true);
  });

  test("Test connection surfaces an error for a command that can't spawn", async () => {
    await clickByText(page, "Add MCP Server");
    await typeIntoNth(page, ".mcp-add-form", "input", 0, "E2E Bad Server");
    await typeIntoNth(page, ".mcp-add-form", "input", 1, "definitely-not-a-real-binary-xyz");
    await clickByText(page, "Test connection", ".mcp-add-form");

    await page.waitForSelector(".settings-error", { timeout: 15_000 });
    const errorText = await page.evaluate(() => document.querySelector(".settings-error")?.textContent ?? "");
    expect(errorText.length).toBeGreaterThan(0);

    // Test connection never writes to the DB — confirm the row doesn't exist.
    const db = openDb(userData);
    try {
      const row = db.prepare("SELECT id FROM mcp_servers WHERE name = ?").get("E2E Bad Server");
      expect(row).toBeUndefined();
    } finally {
      db.close();
    }

    await clickByText(page, "Cancel", ".mcp-add-form");
  });

  // Registry search is a live HTTPS call to registry.modelcontextprotocol.io (searchMcpRegistry in
  // electron/main/ai/mcp.ts) — the roadmap doc filed MCP Servers under Phase 2 as "local", which
  // this test corrects: search genuinely depends on an external service being reachable. Assertions
  // stay lenient about *what* comes back (a registry-side hiccup shouldn't fail the suite) but not
  // about *whether the call completed cleanly* (a thrown error is a real regression to catch).
  test("registry search reaches the live MCP registry and installs a result", async () => {
    await clickByText(page, "Add MCP Server");
    await clickByText(page, "Browse Registry", ".mcp-add-form");
    await typeIntoNth(page, ".mcp-add-form", "input", 0, "filesystem");
    await clickByText(page, "Search", ".mcp-add-form");

    await page.waitForFunction(
      () => document.querySelector(".settings-hint, .settings-empty, .settings-error") !== null,
      { timeout: 15_000 }
    );

    const errorText = await page.evaluate(() => document.querySelector(".settings-error")?.textContent ?? "");
    expect(errorText, "registry search reported an error").toBe("");

    const hasInstallButton = await page.evaluate(
      () => [...document.querySelectorAll(".settings-folder-row button")].some((b) => b.textContent?.trim() === "Install")
    );
    if (!hasInstallButton) {
      test.info().annotations.push({ type: "note", description: "registry returned no installable results for this query" });
      return;
    }

    await clickByText(page, "Install");
    const installed = await pollUntil(() => {
      const db = openDb(userData);
      try {
        return db.prepare("SELECT id, enabled FROM mcp_servers WHERE command LIKE ? OR command LIKE ?").get(
          "%npx%",
          "%node%"
        ) as { id: string; enabled: number } | undefined;
      } finally {
        db.close();
      }
    });
    expect(installed, "installed server never appeared in the sandbox DB").toBeDefined();
    // Installed servers land disabled by design (mcp.ts's handleInstall comment) — a
    // registry-sourced command shouldn't silently start running before it's reviewed.
    expect(installed?.enabled).toBe(0);
  });
});
