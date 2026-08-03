#!/usr/bin/env node
// REPL driver for the OpenOrbit Electron app.
//
// Designed for agents: wrap in tmux, send-keys commands, capture-pane output. Launch is slow
// (~5s), so a REPL beats relaunching per interaction.
//
// SAFETY: always launches against an isolated --user-data-dir. app.getPath("userData") resolves
// to the same ~/Library/Application Support/OpenOrbit from every checkout and every worktree, so
// without this a driver run writes into the developer's real database — settings, chat history,
// agents, encrypted API keys. `launch` refuses to continue if the isolation didn't take.
import { createRequire } from "node:module";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

const APP_DIR = path.resolve(import.meta.dirname, "../../..");
// The driver may be invoked from anywhere; resolve deps against the app, not the cwd.
const require = createRequire(path.join(APP_DIR, "package.json"));
const { _electron: electron } = require("playwright-core");

const USER_DATA = process.env.ORBIT_USER_DATA || "/tmp/orbit-run/userdata";
const SHOT_DIR = process.env.SCREENSHOT_DIR || "/tmp/orbit-run/shots";
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

// Compare resolved paths, not the strings. On macOS /tmp is a symlink to /private/tmp, so
// Electron reports the sandbox back as /private/tmp/... and a plain startsWith would read a
// perfectly good sandbox as an escape. Created above so realpath has something to resolve.
const USER_DATA_REAL = fs.realpathSync(USER_DATA);
const isInsideSandbox = (p) => {
  const real = fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
  return real === USER_DATA_REAL || real.startsWith(USER_DATA_REAL + path.sep);
};

const ELECTRON_BIN =
  process.platform === "darwin"
    ? path.join(APP_DIR, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    : path.join(APP_DIR, "node_modules/electron/dist/electron");

let app = null;
let page = null;

function dbPath() {
  return path.join(USER_DATA, "database/agents.db");
}

const COMMANDS = {
  async launch() {
    if (app) return console.log("already launched");
    if (!fs.existsSync(path.join(APP_DIR, "dist-electron/main/index.js"))) {
      return console.log("ERROR: no build — run `npm run build` first (main is dist-electron/main/index.js)");
    }
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
      timeout: 60_000,
    });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    // The renderer gates its entire render on settings loading, so the bridge appearing is the
    // real "ready" signal — better than a fixed sleep.
    await page.waitForFunction(() => typeof window.agentsAPI !== "undefined", { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));

    const resolved = await app.evaluate(({ app }) => app.getPath("userData"));
    if (!isInsideSandbox(resolved)) {
      console.log(`ABORT: userData is ${resolved}, expected under ${USER_DATA_REAL}. Closing before anything writes.`);
      await app.close();
      app = page = null;
      return;
    }
    console.log("launched. userData:", resolved);
    for (const w of app.windows()) console.log("  window:", w.url());
  },

  /** Wipe the sandbox so the next launch is a genuine fresh install (onboarding, empty DB). */
  reset() {
    if (app) return console.log("ERROR: quit first");
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    console.log("removed", USER_DATA);
  },

  async ss(name) {
    if (!page) return console.log("ERROR: launch first");
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + ".png");
    await page.screenshot({ path: f });
    console.log("screenshot:", f);
  },

  // DOM click rather than locator.click(): coordinate-based clicking hits the wrong layer when
  // content sits under an overlay, and this app is modal-heavy.
  async click(sel) {
    if (!page) return console.log("ERROR: launch first");
    console.log(
      "click",
      sel,
      "→",
      await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return "NOT_FOUND";
        el.click();
        return "OK";
      }, sel)
    );
  },

  async "click-text"(text) {
    if (!page) return console.log("ERROR: launch first");
    console.log(
      "click-text",
      JSON.stringify(text),
      "→",
      await page.evaluate((t) => {
        const els = [...document.querySelectorAll('button, a, [role="button"]')];
        const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t));
        if (!el) return "NOT_FOUND";
        el.click();
        return "OK: " + el.tagName;
      }, text)
    );
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 30 });
  },
  async press(key) {
    if (page) await page.keyboard.press(key);
  },

  async wait(sel) {
    if (!page) return console.log("ERROR: launch first");
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log("found:", sel);
    } catch {
      console.log("TIMEOUT:", sel);
    }
  },

  async eval(expr) {
    if (!page) return console.log("ERROR: launch first");
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log("ERROR:", e.message);
    }
  },

  async text(sel) {
    if (!page) return console.log("ERROR: launch first");
    console.log(
      await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? "(null)", sel || null)
    );
  },

  /** Read every app setting through the real IPC. */
  async settings() {
    if (!page) return console.log("ERROR: launch first");
    console.log(JSON.stringify(await page.evaluate(() => window.agentsAPI.settings.get()), null, 2));
  },

  /** `set {"userName":"Ada"}` — writes through settings:update and prints the authoritative
   * post-write state, so a value the schema refused is visible as unchanged. */
  async set(json) {
    if (!page) return console.log("ERROR: launch first");
    let patch;
    try {
      patch = JSON.parse(json);
    } catch {
      return console.log('ERROR: expected JSON, e.g. set {"userName":"Ada"}');
    }
    const after = await page.evaluate((p) => window.agentsAPI.settings.update(p), patch);
    for (const key of Object.keys(patch)) {
      console.log(`  ${key}: sent ${JSON.stringify(patch[key])} → stored ${JSON.stringify(after[key])}`);
    }
  },

  /** `sql-set <name> <raw>` — writes a raw setting_value straight into SQLite, bypassing
   * settings:update. The only way to create rows the UI cannot: malformed JSON, out-of-range
   * numbers, values written by older builds. Quit first; SQLite is held open by the app. */
  "sql-set"(args) {
    if (app) return console.log("ERROR: quit first — the app holds the database open");
    const [name, ...rest] = args.split(/\s+/);
    const raw = rest.join(" ");
    if (!name || !raw) return console.log("usage: sql-set appSettings.foo <raw setting_value>");
    if (!fs.existsSync(dbPath())) return console.log("ERROR: no database yet — launch once first");
    const Database = require("better-sqlite3");
    const db = new Database(dbPath());
    db.prepare(
      `INSERT INTO settings (setting_name, setting_value) VALUES (?, ?)
       ON CONFLICT(setting_name) DO UPDATE SET setting_value = excluded.setting_value`
    ).run(name, raw);
    db.close();
    console.log(`wrote ${name} = ${raw}`);
  },

  /** `sql <statement>` — run arbitrary SQL against the sandbox database. Quit first.
   *
   * `sql-set` only covers the settings table; the read-side guards live on other tables too
   * (agent_data), and some paths can only be reached by editing schema_migrations to make a
   * migration replay. A SELECT prints its rows; anything else prints the change count. Safe
   * because the sandbox check has already confined this to a throwaway database — never point
   * ORBIT_USER_DATA at the real one. */
  sql(statement) {
    if (app) return console.log("ERROR: quit first — the app holds the database open");
    if (!statement) return console.log("usage: sql SELECT * FROM schema_migrations LIMIT 5");
    if (!fs.existsSync(dbPath())) return console.log("ERROR: no database yet — launch once first");
    const Database = require("better-sqlite3");
    const db = new Database(dbPath());
    try {
      const stmt = db.prepare(statement);
      if (stmt.reader) {
        const rows = stmt.all();
        if (!rows.length) console.log("(no rows)");
        for (const row of rows) console.log(" ", JSON.stringify(row));
      } else {
        const { changes } = stmt.run();
        console.log(`${changes} row(s) changed`);
      }
    } catch (e) {
      console.log("SQL ERROR:", e.message);
    } finally {
      db.close();
    }
  },

  /** Print the settings rows as they actually sit in SQLite, unparsed. */
  "sql-dump"() {
    if (!fs.existsSync(dbPath())) return console.log("ERROR: no database yet — launch once first");
    const Database = require("better-sqlite3");
    const db = new Database(dbPath(), { readonly: true });
    for (const r of db.prepare("SELECT setting_name, setting_value FROM settings ORDER BY setting_name").all()) {
      console.log(` ${r.setting_name} = ${r.setting_value}`);
    }
    db.close();
  },

  /** The main+renderer log, cleared on every launch. Where read-side rejections surface. */
  log(grep) {
    const f = path.join(USER_DATA, "debug.log");
    if (!fs.existsSync(f)) return console.log("(no debug.log yet)");
    const lines = fs.readFileSync(f, "utf8").split("\n");
    for (const line of grep ? lines.filter((l) => l.includes(grep)) : lines.slice(-40)) {
      if (line.trim()) console.log(line);
    }
  },

  async windows() {
    if (!app) return console.log("ERROR: launch first");
    for (const w of app.windows()) console.log("  window:", w.url());
    const wcs = await app.evaluate(({ webContents }) =>
      webContents.getAllWebContents().map((w) => ({ id: w.id, type: w.getType(), url: w.getURL() }))
    );
    for (const w of wcs) console.log(`  [${w.id}] ${w.type}: ${w.url}`);
  },

  async quit() {
    if (app) await app.close().catch(() => {});
    app = page = null;
    console.log("closed");
  },

  help() {
    console.log("commands:", Object.keys(COMMANDS).join(", "));
  },
};

/** Runs one command line. Returns false if the driver should stop. */
async function runCommand(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return true;
  const cmd = trimmed.split(/\s+/)[0];
  const rest = trimmed.slice(cmd.length).trim();
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log("unknown:", cmd, "— try: help");
    return true;
  }
  try {
    await fn(rest);
  } catch (e) {
    console.log("ERROR:", e.message);
  }
  return !(cmd === "quit" && rest === "exit");
}

console.log(`OpenOrbit driver — sandbox: ${USER_DATA}`);

if (process.stdin.isTTY) {
  // Interactive/tmux. Electron steals stdin once launched, so read the raw fd instead.
  const stdin = fs.createReadStream(null, { fd: fs.openSync("/dev/stdin", "r") });
  const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: "orbit> " });
  console.log('"help" for commands, "launch" to start');
  rl.on("line", async (line) => {
    rl.pause();
    const keepGoing = await runCommand(line);
    if (!keepGoing) return rl.close();
    rl.resume();
    rl.prompt();
  });
  rl.on("close", async () => {
    await COMMANDS.quit();
    process.exit(0);
  });
  rl.prompt();
} else {
  // Batch: `printf 'launch\nss shot\n' | node driver.mjs`, or a here-doc. Commands must run
  // strictly in order, and readline cannot give that — it emits every line of a piped chunk
  // before an async handler for the first one has resolved, so `set` would race ahead of a
  // launch still in flight. Read the script up front (before Electron takes stdin) and await
  // each command in turn. `#` starts a comment.
  const script = fs.readFileSync(0, "utf8");
  for (const line of script.split("\n")) {
    if (line.trim()) console.log(`orbit> ${line.trim()}`);
    if (!(await runCommand(line))) break;
  }
  await COMMANDS.quit();
  process.exit(0);
}
