import { type ElectronApplication, type Page, _electron as electron } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { E2EProviderConfig } from "./providerConfig";

// Shared launch/click/type/DB conventions, extracted from onboarding.spec.ts once a second spec
// needed them (see 0-cowork/plans/active/e2e-full-coverage.md's reuse audit — premature extraction
// for a single caller was deliberately deferred until Phase 1 gave it a second one).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_DIR = path.resolve(__dirname, "..");

export const ELECTRON_BIN =
  process.platform === "darwin"
    ? path.join(APP_DIR, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    : path.join(APP_DIR, "node_modules/electron/dist/electron");

export function dbPath(userData: string): string {
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
export async function typeIntoField(page: Page, selector: string, value: string): Promise<void> {
  await page.evaluate(
    ({ selector, value }) => {
      const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) throw new Error(`field not found: ${selector}`);
      // Settings' TextField/NumberField commit onBlur, not onChange — a later blurActive() only
      // fires that handler if this element actually holds DOM focus, which a bare value-setter +
      // dispatch does not give it.
      el.focus();
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { selector, value }
  );
}

// Locator clicks time out on "element is not stable" against this app's continuous framer-motion
// animation — DOM click via evaluate sidesteps the actionability check entirely.
export async function clickSelector(page: Page, selector: string): Promise<void> {
  const found = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    (el as HTMLElement).click();
    return true;
  }, selector);
  if (!found) throw new Error(`clickSelector: no element matching "${selector}"`);
}

// Retries briefly: a preceding action (e.g. a create submit) can resolve before React's list
// re-render commits, and the target text isn't in the DOM yet on the very next evaluate.
export async function clickByText(page: Page, text: string, scopeSelector?: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  let found = false;
  while (!found && Date.now() < deadline) {
    found = await page.evaluate(
      ({ t, scopeSelector }) => {
        const root = scopeSelector ? document.querySelector(scopeSelector) : document;
        if (!root) return false;
        const els = [...root.querySelectorAll('button, a, [role="button"], [role="radio"], [role="option"]')];
        const el = els.find((e) => e.textContent?.trim() === t);
        if (!el) return false;
        (el as HTMLElement).click();
        return true;
      },
      { t: text, scopeSelector }
    );
    if (!found) await new Promise((r) => setTimeout(r, 100));
  }
  if (!found) throw new Error(`clickByText: no element with text "${text}"`);
}

// For fields with no aria-label/id to target directly — picks the Nth match (document order)
// of `innerSelector` within `scopeSelector` and types into it.
export async function typeIntoNth(
  page: Page,
  scopeSelector: string,
  innerSelector: string,
  index: number,
  value: string
): Promise<void> {
  await page.evaluate(
    ({ scopeSelector, innerSelector, index, value }) => {
      const scope = document.querySelector(scopeSelector);
      if (!scope) throw new Error(`typeIntoNth: no scope matching "${scopeSelector}"`);
      const els = [...scope.querySelectorAll(innerSelector)] as (HTMLInputElement | HTMLTextAreaElement)[];
      const el = els[index];
      if (!el) throw new Error(`typeIntoNth: no element at index ${index} for "${innerSelector}" in "${scopeSelector}"`);
      el.focus();
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { scopeSelector, innerSelector, index, value }
  );
}

// For rows with no aria-label/id at all (e.g. ApiKeyField, whose <span>{label}</span> is only
// ever visible text) — finds a `rowSelector` element whose text starts with `labelText` and types
// into its first `input`/`textarea`.
export async function typeIntoLabeledRow(
  page: Page,
  rowSelector: string,
  labelText: string,
  value: string
): Promise<void> {
  await page.evaluate(
    ({ rowSelector, labelText, value }) => {
      const rows = [...document.querySelectorAll(rowSelector)];
      const row = rows.find((r) => r.textContent?.trim().startsWith(labelText));
      if (!row) throw new Error(`typeIntoLabeledRow: no "${rowSelector}" starting with "${labelText}"`);
      const el = row.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) throw new Error(`typeIntoLabeledRow: no input/textarea inside row "${labelText}"`);
      el.focus();
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { rowSelector, labelText, value }
  );
}

// Companion to typeIntoLabeledRow — clicks a button by text inside the row starting with
// `labelText`, e.g. ApiKeyField's per-provider "Remove" button.
export async function clickInLabeledRow(
  page: Page,
  rowSelector: string,
  labelText: string,
  buttonText: string
): Promise<void> {
  const found = await page.evaluate(
    ({ rowSelector, labelText, buttonText }) => {
      const rows = [...document.querySelectorAll(rowSelector)];
      const row = rows.find((r) => r.textContent?.trim().startsWith(labelText));
      if (!row) return false;
      const buttons = [...row.querySelectorAll("button")];
      const btn = buttons.find((b) => b.textContent?.trim() === buttonText);
      if (!btn) return false;
      btn.click();
      return true;
    },
    { rowSelector, labelText, buttonText }
  );
  if (!found) throw new Error(`clickInLabeledRow: no "${buttonText}" button in row "${labelText}"`);
}

// Blurs whatever currently holds focus — Settings text/number fields commit onBlur, not per
// keystroke, so a test must blur after typing (which focuses the field, see typeIntoField above)
// before the write lands.
export async function blurActive(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

export async function openCombobox(page: Page, ariaLabel: string): Promise<void> {
  await clickSelector(page, `[aria-haspopup="listbox"][aria-label="${ariaLabel}"]`);
}

// Combobox options select on mousedown (not click) — e.preventDefault() there is deliberate,
// keeping the search input focused instead of blurring it — so a synthetic .click() (which never
// fires mousedown) is a silent no-op against them.
export async function selectComboboxOption(page: Page, optionText: string): Promise<void> {
  const found = await page.evaluate((t) => {
    const els = [...document.querySelectorAll('[role="listbox"] [role="option"]')];
    const el = els.find((e) => e.textContent?.trim() === t);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    return true;
  }, optionText);
  if (!found) throw new Error(`selectComboboxOption: no option with text "${optionText}"`);
}

export async function pickCombobox(page: Page, ariaLabel: string, optionText: string): Promise<void> {
  await openCombobox(page, ariaLabel);
  await selectComboboxOption(page, optionText);
}

export async function confirmTypeToDelete(page: Page): Promise<void> {
  await typeIntoField(page, ".delete-confirm-modal input", "DELETE");
  await clickSelector(page, ".delete-confirm-modal .danger-zone-reset-btn");
}

export async function openSettings(page: Page): Promise<void> {
  await clickSelector(page, "#setbtn");
}

export async function openSettingsTab(page: Page, label: string): Promise<void> {
  await openSettings(page);
  await clickByText(page, label, ".settings-sidebar");
}

export function launchSandboxedApp(): { userData: string } {
  const userData = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "orbit-e2e-"));
  return { userData };
}

export async function launchApp(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  if (!fs.existsSync(path.join(APP_DIR, "dist-electron/main/index.js"))) {
    throw new Error("no build — run `npm run build` first (main is dist-electron/main/index.js)");
  }
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, `--user-data-dir=${userData}`],
    timeout: 60_000,
  });
  const page = await app.firstWindow();
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
  return { app, page };
}

// Drives the same onboarding flow onboarding.spec.ts exercises directly, purely as a means to
// reach the main screen — every Electron build gates on `settings.onboardingDone`
// (AgentsApp.tsx's showOnboarding), so any spec that needs Settings open has to clear it first.
export async function completeOnboarding(page: Page, provider: E2EProviderConfig): Promise<void> {
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

  await clickByText(page, provider.label);

  // apiUrl step is prefilled from the provider's registry entry — accept the default.
  await page.keyboard.press("Enter");

  await typeIntoField(page, 'input[aria-label="Enter your API key"]', provider.apiKey);
  await page.keyboard.press("Enter");

  // model step is prefilled — accept the default.
  await page.keyboard.press("Enter");

  // handleOnboardingComplete fires providers.selectChat fire-and-forget, so the main screen can
  // render before the write lands — wait for the orbit UI (settings button) rather than a fixed
  // delay.
  await page.waitForSelector("#setbtn", { timeout: 15_000 });
}

// global.d.ts deliberately types window.agentsAPI as `unknown` — every other spec drives the UI
// rather than the bridge. The handful of specs that must call it directly (no UI exists to seed
// a task; header decryption has no visible affordance) go through this narrow, local-only shape
// instead of casting inline at each call site.
export interface AgentsApiForE2E {
  tasks: {
    create: (input: { title: string }) => Promise<{ id: string; title: string }>;
  };
  httpTools: {
    getCollectionHeaders: (id: string) => Promise<Record<string, string>>;
  };
}

export function openDb(userData: string): Database.Database {
  return new Database(dbPath(userData), { readonly: true, fileMustExist: false });
}

export async function pollUntil<T>(fn: () => T | undefined, timeoutMs = 5_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  let result: T | undefined;
  while (Date.now() < deadline) {
    try {
      result = fn();
    } catch {
      // table may not exist yet on the very first poll — keep waiting.
    }
    if (result !== undefined) return result;
    await new Promise((r) => setTimeout(r, 150));
  }
  return result;
}
