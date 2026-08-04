import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// Drives the real Electron app through onboarding, selecting OpenAI, and asserts the credential
// landed in the sandbox DB. See .claude/skills/run-openorbit/driver.mjs for the manual-REPL
// version of the same sandbox/click/DB-read conventions this spec reuses.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");

const ELECTRON_BIN =
  process.platform === "darwin"
    ? path.join(APP_DIR, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    : path.join(APP_DIR, "node_modules/electron/dist/electron");

function dbPath(userData: string): string {
  return path.join(userData, "database/agents.db");
}

// Same realpath-comparison as driver.mjs's isInsideSandbox — macOS symlinks /tmp to /private/tmp,
// so a plain startsWith would read a perfectly good sandbox as an escape.
function isInsideSandbox(resolved: string, sandboxReal: string): boolean {
  const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : path.resolve(resolved);
  return real === sandboxReal || real.startsWith(sandboxReal + path.sep);
}

// React-controlled inputs ignore a plain `.value =` assignment — it has to go through the
// prototype setter and dispatch a real input event, or onChange never fires.
async function typeIntoField(page: Page, selector: string, value: string): Promise<void> {
  await page.evaluate(
    ({ selector, value }) => {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (!el) throw new Error(`field not found: ${selector}`);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { selector, value }
  );
}

// Locator clicks time out on "element is not stable" against this app's continuous framer-motion
// animation — DOM click via evaluate sidesteps the actionability check entirely.
async function clickSelector(page: Page, selector: string): Promise<void> {
  const found = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    (el as HTMLElement).click();
    return true;
  }, selector);
  if (!found) throw new Error(`clickSelector: no element matching "${selector}"`);
}

async function clickByText(page: Page, text: string): Promise<void> {
  const found = await page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, a, [role="button"], [role="radio"]')];
    const el = els.find((e) => e.textContent?.trim() === t);
    if (!el) return false;
    (el as HTMLElement).click();
    return true;
  }, text);
  if (!found) throw new Error(`clickByText: no element with text "${text}"`);
}

test.describe("onboarding — OpenAI", () => {
  test.skip(!process.env.OPENAI_API_KEY, "OPENAI_API_KEY not set — skipping live-provider onboarding test");

  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    if (!fs.existsSync(path.join(APP_DIR, "dist-electron/main/index.js"))) {
      throw new Error("no build — run `npm run build` first (main is dist-electron/main/index.js)");
    }

    userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "orbit-e2e-"));

    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [APP_DIR, `--user-data-dir=${userData}`],
      timeout: 60_000,
    });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => typeof window.agentsAPI !== "undefined", { timeout: 30_000 });

    // Non-negotiable: abort before any interaction if isolation didn't take, or the test writes
    // into the developer's real ~/Library/Application Support/OpenOrbit database.
    const resolvedUserData = await app.evaluate(({ app }) => app.getPath("userData"));
    const sandboxReal = fs.realpathSync(userData);
    if (!isInsideSandbox(resolvedUserData, sandboxReal)) {
      await app.close();
      throw new Error(`ABORT: userData resolved to ${resolvedUserData}, expected under ${sandboxReal}`);
    }
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test("completes onboarding selecting OpenAI and persists the provider", async () => {
    await typeIntoField(page, 'input[aria-label="Give me a name?"]', "TestOrbit");
    await page.keyboard.press("Enter");

    await typeIntoField(page, 'input[aria-label="What should I call you?"]', "E2E Tester");
    await page.keyboard.press("Enter");

    // profession is an optional *text* step — no Skip button, just an always-enabled Next.
    await clickSelector(page, '[aria-label="Next"]');

    // responseStyle, technicalLevel, stuckStyle — optional *chip* steps, each with its own Skip.
    for (let i = 0; i < 3; i++) {
      await clickSelector(page, '[aria-label="Skip"]');
    }

    await clickByText(page, "OpenAI");

    // apiUrl step is prefilled from the OpenAI registry entry — accept the default.
    await page.keyboard.press("Enter");

    await typeIntoField(page, 'input[aria-label="Enter your API key"]', process.env.OPENAI_API_KEY!);
    await page.keyboard.press("Enter");

    // model step is prefilled — accept the default.
    await page.keyboard.press("Enter");

    // handleOnboardingComplete fires providers.selectChat fire-and-forget (not awaited by the UI),
    // so the DB write can land after the click resolves. Poll rather than assert immediately.
    const deadline = Date.now() + 5_000;
    let row: { id: string; api_url: string; keylen: number } | undefined;
    while (Date.now() < deadline) {
      const db = new Database(dbPath(userData), { readonly: true, fileMustExist: false });
      try {
        row = db
          .prepare("SELECT id, api_url, length(api_key) AS keylen FROM providers WHERE id = ?")
          .get("openai") as typeof row;
      } catch {
        // table may not exist yet on the very first poll — keep waiting.
      } finally {
        db.close();
      }
      if (row) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(row, "openai provider row never appeared in the sandbox DB").toBeDefined();
    expect(row!.keylen).toBeGreaterThan(0);
    expect(row!.api_url).not.toBe("");

    const settingsDb = new Database(dbPath(userData), { readonly: true });
    const chatProviderRow = settingsDb
      .prepare("SELECT setting_value FROM settings WHERE setting_name = ?")
      .get("appSettings.chatProviderId") as { setting_value: string } | undefined;
    settingsDb.close();

    expect(chatProviderRow?.setting_value).toBe(JSON.stringify("openai"));
  });
});
