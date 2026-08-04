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
  openDb,
  pollUntil,
  type AgentsApiForE2E,
} from "./helpers";

const provider = resolveE2EProvider();

test.describe("Settings — HTTP Tools tab", () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    ({ userData } = launchSandboxedApp());
    ({ app, page } = await launchApp(userData));
    await completeOnboarding(page, provider);
    await openSettingsTab(page, "HTTP Tools");
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test("creates a collection with encrypted headers, adds an endpoint, toggles both, deletes both", async () => {
    await clickByText(page, "Add API");
    await typeIntoNth(page, ".http-collection-form", "input", 0, "E2E API");
    await typeIntoNth(page, ".http-collection-form", "input", 1, "Test collection");
    await typeIntoNth(page, ".http-collection-form", "input", 2, "https://example.com");
    await typeIntoNth(page, ".http-collection-form", "textarea", 0, "Authorization=Bearer secret-token");
    await clickByText(page, "Add API", ".http-collection-form");

    const collection = await pollUntil(() => {
      const db = openDb(userData);
      try {
        return db.prepare("SELECT id, headers FROM http_tool_collections WHERE name = ?").get("E2E API") as
          | { id: string; headers: string }
          | undefined;
      } finally {
        db.close();
      }
    });
    expect(collection, "collection never appeared in the sandbox DB").toBeDefined();
    // Headers are encrypted at rest — the raw column must not contain the plaintext token.
    expect(collection!.headers).not.toContain("secret-token");

    const decrypted = await page.evaluate(
      (id) => (window.agentsAPI as unknown as AgentsApiForE2E).httpTools.getCollectionHeaders(id),
      collection!.id
    );
    expect(decrypted).toEqual({ Authorization: "Bearer secret-token" });

    // Expand the collection row, add an endpoint.
    await clickByText(page, "E2E API — no endpoints yet");
    await clickByText(page, "Add endpoint");
    await typeIntoNth(page, ".http-tool-form", "input", 0, "Get Widget");
    await typeIntoNth(page, ".http-tool-form", "input", 1, "Fetch a widget");
    await typeIntoNth(page, ".http-tool-form", "input", 2, "/widget");
    await clickByText(page, "Add endpoint", ".http-tool-form");

    const tool = await pollUntil(() => {
      const db = openDb(userData);
      try {
        return db.prepare("SELECT id, enabled FROM http_tools WHERE name = ?").get("Get Widget") as
          | { id: string; enabled: number }
          | undefined;
      } finally {
        db.close();
      }
    });
    expect(tool, "endpoint never appeared in the sandbox DB").toBeDefined();
    expect(tool!.enabled).toBe(1);

    // Toggle the endpoint off.
    await clickSelector(page, '[aria-label="Toggle Get Widget"]');
    const disabledTool = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT enabled FROM http_tools WHERE id = ?").get(tool!.id) as
          | { enabled: number }
          | undefined;
        return r && r.enabled === 0 ? r : undefined;
      } finally {
        db.close();
      }
    });
    expect(disabledTool?.enabled).toBe(0);

    // Delete the endpoint (type-to-confirm), then the collection.
    await clickSelector(page, '[aria-label="Remove Get Widget"]');
    await typeIntoNth(page, ".delete-confirm-modal", "input", 0, "DELETE");
    await clickSelector(page, ".delete-confirm-modal .danger-zone-reset-btn");

    const toolGone = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT id FROM http_tools WHERE id = ?").get(tool!.id);
        return r ? undefined : { deleted: true };
      } finally {
        db.close();
      }
    });
    expect(toolGone?.deleted).toBe(true);

    await clickSelector(page, '[aria-label="Remove E2E API"]');
    await typeIntoNth(page, ".delete-confirm-modal", "input", 0, "DELETE");
    await clickSelector(page, ".delete-confirm-modal .danger-zone-reset-btn");

    const collectionGone = await pollUntil(() => {
      const db = openDb(userData);
      try {
        const r = db.prepare("SELECT id FROM http_tool_collections WHERE id = ?").get(collection!.id);
        return r ? undefined : { deleted: true };
      } finally {
        db.close();
      }
    });
    expect(collectionGone?.deleted).toBe(true);
  });
});
