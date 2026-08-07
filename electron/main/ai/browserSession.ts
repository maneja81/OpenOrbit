/**
 * Per-run lifecycle for Pilot's browser — a single, real, visible Chromium window driven via
 * `playwright-core`, launched against a persistent profile (see appDirs.ts's
 * getBrowserProfileDir) so a login session survives across chat turns and app restarts, the
 * same way a real browser profile would.
 *
 * Module-level singleton, same "rebuilt fresh per run, closed in a finally" discipline as
 * ai/mcp.ts's connectMcpServersForAgent/closeMcpServers — see ipc/agent.ts's run-completion
 * finally block, which calls closeBrowserSession() alongside closeMcpServers().
 *
 * Deviation from the original plan: the plan described building a hand-formatted accessibility
 * tree and rebuilding a ref→Locator map via page.getByRole(role, { name }) after every
 * snapshot. That machinery already exists in this installed playwright-core version —
 * `page.ariaSnapshot({ mode: "ai" })` returns exactly the ref-annotated tree text
 * (`button "Reply" [ref=e14]`) the plan wanted, and `page.locator('aria-ref=<ref>')` is a real
 * Playwright selector engine that resolves a ref straight back to a Locator — so there is no
 * manual ref-map bookkeeping at all. Simpler and more robust than the planned design (no
 * role/name reconstruction that could resolve to the wrong element on a page with duplicate
 * labels), and it's the same mechanism Playwright's own MCP server uses for the same job.
 */

import { chromium, type BrowserContext, type Page } from "playwright-core";
import { resolveBrowserExecutable } from "./browserExecutable";
import { getBrowserProfileDir } from "../appDirs";
import { devLog } from "../devLog";

/** Page text past this length is truncated — no existing precedent caps page text in this
 * codebase, so this is a new, explicit limit sized to stay well clear of blowing a chat turn's
 * context budget on one huge page. */
const MAX_PAGE_TEXT_LENGTH = 20_000;

let context: BrowserContext | null = null;
let currentPage: Page | null = null;

async function getPage(): Promise<Page> {
  const ctx = await getOrLaunchBrowserSession();
  if (currentPage && !currentPage.isClosed()) return currentPage;
  currentPage = ctx.pages()[0] ?? (await ctx.newPage());
  return currentPage;
}

/**
 * Returns the already-open persistent-context browser for this run, launching one if none is
 * open yet. Headed (not headless) so the user can see and complete a login themselves — Pilot's
 * prompt (browserAgent.md) tells the model to navigate to a login page and then call ask_user
 * to pause for the user, rather than attempting to guess or bypass credentials.
 */
export async function getOrLaunchBrowserSession(): Promise<BrowserContext> {
  if (context) return context;

  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new Error("No Chrome or Edge installation found — Pilot needs a real browser installed to control.");
  }

  try {
    context = await chromium.launchPersistentContext(getBrowserProfileDir(), {
      headless: false,
      executablePath,
    });
  } catch (e) {
    // Playwright's persistent-context launch takes an OS-level lock on the profile directory —
    // a second concurrent launch attempt (e.g. a headless prompt-task run overlapping an
    // interactive chat run) rejects rather than queuing. Surfaced as a clear tool error the
    // model can relay, rather than an opaque Playwright stack trace.
    const message = e instanceof Error ? e.message : String(e);
    if (/lock|already in use|SingletonLock/i.test(message)) {
      throw new Error("The browser profile is already in use by another task — wait for it to finish.");
    }
    throw e;
  }

  // The window closing (user clicks the X) must not leave a stale reference this module thinks
  // is still usable — the next call re-launches instead of touching a closed context.
  context.on("close", () => {
    context = null;
    currentPage = null;
  });

  return context;
}

export async function navigate(url: string): Promise<{ title: string; url: string }> {
  const page = await getPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return { title: await page.title(), url: page.url() };
}

/**
 * Returns an accessibility-tree snapshot of the current page as text, with short ref ids
 * (`[ref=e14]`) that browser_click/browser_type target directly — see the module header for
 * why this needs no separate ref-map bookkeeping.
 */
export async function snapshot(): Promise<string> {
  const page = await getPage();
  return page.ariaSnapshot({ mode: "ai" });
}

/** Resolves a snapshot ref to a Locator. Playwright's own `aria-ref=` selector engine does the
 * lookup — a stale ref (page navigated/changed since the last snapshot) surfaces as that
 * Locator's own "element not found" on the next action, not a special case here. */
function refLocator(page: Page, ref: string) {
  if (!ref || ref.trim().length === 0) {
    throw new Error("A ref is required — call browser_snapshot first and use one of its [ref=...] values.");
  }
  return page.locator(`aria-ref=${ref}`);
}

export async function clickRef(ref: string): Promise<string> {
  const page = await getPage();
  await refLocator(page, ref).click();
  return `Clicked ${ref}.`;
}

export async function typeRef(ref: string, text: string, submit: boolean): Promise<string> {
  const page = await getPage();
  const locator = refLocator(page, ref);
  await locator.fill(text);
  if (submit) await locator.press("Enter");
  return submit ? `Typed into ${ref} and pressed Enter.` : `Typed into ${ref}.`;
}

const DEFAULT_SCROLL_AMOUNT = 800;

export async function scroll(direction: "up" | "down", amount?: number): Promise<string> {
  const page = await getPage();
  const delta = amount ?? DEFAULT_SCROLL_AMOUNT;
  await page.mouse.wheel(0, direction === "down" ? delta : -delta);
  return `Scrolled ${direction} by ${delta}px.`;
}

export async function readPageText(): Promise<string> {
  const page = await getPage();
  const text = await page.locator("body").innerText();
  return text.length > MAX_PAGE_TEXT_LENGTH
    ? `${text.slice(0, MAX_PAGE_TEXT_LENGTH)}\n\n[truncated — page text exceeded ${MAX_PAGE_TEXT_LENGTH} characters]`
    : text;
}

export async function goBack(): Promise<{ title: string; url: string }> {
  const page = await getPage();
  await page.goBack();
  return { title: await page.title(), url: page.url() };
}

/** Safe to call when nothing is open — same tolerance as closeMcpServers's Promise.allSettled
 * over per-server closes, applied here to the single browser context. Unlike closeMcpServers,
 * this logs the failure via devLog rather than swallowing it silently: a browser that fails to
 * close is a more diagnosable, less expected event than one MCP stdio server among several
 * failing to shut down, so it's worth a trace if it ever happens. */
export async function closeBrowserSession(): Promise<void> {
  if (!context) return;
  const ctx = context;
  context = null;
  currentPage = null;
  try {
    await ctx.close();
  } catch (e) {
    devLog(`[browserSession] closeBrowserSession: ${e instanceof Error ? e.message : String(e)}`);
  }
}
