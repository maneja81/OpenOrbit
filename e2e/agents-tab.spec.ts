import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveE2EProvider } from "./providerConfig";
import {
  launchSandboxedApp,
  launchApp,
  completeOnboarding,
  openSettingsTab,
  clickByText,
  clickSelector,
  typeIntoField,
  blurActive,
  confirmTypeToDelete,
  openDb,
  pollUntil,
} from "./helpers";

// Settings → Agents: create/edit/enable/export/import/delete a custom agent. Built-in agents
// (Cipher/Atlas/Explorer/Chrono/the orchestrator) are excluded from destructive coverage — only
// a custom agent this spec creates itself is ever deleted.

const provider = resolveE2EProvider();

test.describe("Settings — Agents tab", () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
    await openSettingsTab(page, "Agents");
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test("creates, edits, toggles, and deletes a custom agent", async () => {
    await clickByText(page, "New");
    await typeIntoField(page, ".add-agent-form input", "E2E Scout");
    await clickByText(page, "Add Agent");

    const row = await pollUntil(() => {
      const db = openDb(userData);
      try {
        return db.prepare("SELECT id, enabled FROM agents WHERE name = ?").get("E2E Scout") as
          | { id: string; enabled: number }
          | undefined;
      } finally {
        db.close();
      }
    });
    expect(row, "created agent never appeared in the sandbox DB").toBeDefined();
    expect(row!.enabled).toBe(1);

    // Expand the new agent's accordion and edit its tagline — commits onBlur, not per keystroke.
    await clickByText(page, "E2E Scout");
    await typeIntoField(page, '.agent-accordion-body input[placeholder="e.g. App configuration"]', "Testing tagline");
    await blurActive(page);

    const updated = await pollUntil(() => {
      const db = openDb(userData);
      try {
        return db.prepare("SELECT tagline FROM agents WHERE id = ?").get(row!.id) as
          | { tagline: string }
          | undefined;
      } finally {
        db.close();
      }
    });
    expect(updated?.tagline).toBe("Testing tagline");

    // Toggle disabled.
    await clickSelector(page, `[aria-label="Toggle E2E Scout"]`);
    const disabled = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT enabled FROM agents WHERE id = ?").get(row!.id) as
          | { enabled: number }
          | undefined;
        return r && r.enabled === 0 ? r : undefined;
      } finally {
        db.close();
      }
    });
    expect(disabled?.enabled).toBe(0);

    // Delete requires typing DELETE to confirm.
    await clickByText(page, "Delete");
    await confirmTypeToDelete(page);

    const gone = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT id FROM agents WHERE id = ?").get(row!.id);
        return r ? undefined : { deleted: true };
      } finally {
        db.close();
      }
    });
    expect(gone?.deleted).toBe(true);
  });

  test("exports and imports an agent through a stubbed native file dialog", async () => {
    // Playwright cannot click through a native OS dialog — stub Electron's dialog module in the
    // main process before triggering the click. It's the same module-level `dialog` singleton
    // agent.ts imports, so patching it here is visible to the IPC handler.
    const exportPath = path.join(userData, "exported-agent.json");
    await app.evaluate(
      async ({ dialog }, exportPath) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: exportPath })) as typeof dialog.showSaveDialog;
      },
      exportPath
    );

    await clickByText(page, "New");
    await typeIntoField(page, ".add-agent-form input", "E2E Export Me");
    await clickByText(page, "Add Agent");
    await pollUntil(() => {
      const db = openDb(userData);
      try {
        return db.prepare("SELECT id FROM agents WHERE name = ?").get("E2E Export Me") as
          | { id: string }
          | undefined;
      } finally {
        db.close();
      }
    });

    await clickByText(page, "E2E Export Me");
    await clickByText(page, "Export");

    const exported = await pollUntil(() => (fs.existsSync(exportPath) ? { ok: true } : undefined));
    expect(exported?.ok, "export never wrote the stubbed file path").toBe(true);
    const payload = JSON.parse(fs.readFileSync(exportPath, "utf-8"));
    expect(payload.name).toBe("E2E Export Me");

    // Import it back under a new name to prove the round trip lands a fresh agent row.
    payload.name = "E2E Imported Agent";
    const importPath = path.join(userData, "import-agent.json");
    fs.writeFileSync(importPath, JSON.stringify(payload), "utf-8");

    await app.evaluate(
      async ({ dialog }, importPath) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [importPath],
        })) as typeof dialog.showOpenDialog;
      },
      importPath
    );

    await clickByText(page, "Import Agent");

    const imported = await pollUntil(() => {
      const db = openDb(userData);
      try {
        return db.prepare("SELECT id FROM agents WHERE name = ?").get("E2E Imported Agent") as
          | { id: string }
          | undefined;
      } finally {
        db.close();
      }
    });
    expect(imported, "imported agent never appeared in the sandbox DB").toBeDefined();
  });
});
