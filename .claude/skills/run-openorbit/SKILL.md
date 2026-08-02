---
name: run-openorbit
description: Build, run and drive the OpenOrbit Electron app. Use when asked to start the app, screenshot it, click through its UI, or confirm a change works in the real app rather than only in the test suite.
---

OpenOrbit is an Electron desktop app. Drive it through the Playwright REPL at
`.claude/skills/run-openorbit/driver.mjs`. Launch takes ~5s, so the REPL beats relaunching per
interaction.

Paths below are relative to the repo root. On macOS no xvfb is needed; on headless Linux prefix
with `xvfb-run -a`.

## Read this first — the sandbox is not optional

`app.getPath("userData")` resolves to `~/Library/Application Support/OpenOrbit` **from every
checkout and every git worktree**. There is no per-branch data directory. Launching the app to
try something out therefore writes into the developer's real database: settings, chat history,
agents, and encrypted API keys.

The driver always passes `--user-data-dir` and **aborts the launch** if `app.getPath("userData")`
doesn't land inside the sandbox. Don't remove that check, and don't launch the app by hand from a
worktree to "just have a look".

Sandbox defaults to `/tmp/orbit-run/userdata` — override with `ORBIT_USER_DATA`. Because it
starts empty, the first launch is a genuine fresh install: onboarding, empty database. That is
usually what you want for testing defaults; `reset` gets you back to it.

## Build

```bash
npm install          # once per worktree — node_modules is not shared
npm run build        # main is dist-electron/main/index.js; the driver checks it exists
```

⚠ **Check the Electron binary after installing — the install lies.** `npm ci` / `npm install` in a
fresh worktree regularly exits 0 having left no usable Electron. Two variants seen: the binary
missing entirely (`dist` and `path.txt` both absent), and a half-extracted app (`failed to create
directory …/Electron.app/Contents/Resources/kn.lproj: File exists`). The driver then can't launch,
and vitest quietly loses `electron/main/ai/agents.test.ts` — 45 tests.

```bash
ls node_modules/electron/path.txt node_modules/electron/dist    # both must exist
# repair:
rm -rf node_modules/electron/dist node_modules/electron/path.txt && node node_modules/electron/install.js
```

`path.txt` should read `Electron.app/Contents/MacOS/Electron`.

## Run

```bash
node .claude/skills/run-openorbit/driver.mjs
```

Wrapped in tmux, which is how an agent should drive it:

```bash
tmux new-session -d -s orbit -x 200 -y 50
tmux send-keys -t orbit 'node .claude/skills/run-openorbit/driver.mjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t orbit -p | grep -q "orbit>"; do sleep 0.2; done'
tmux send-keys -t orbit 'launch' Enter
timeout 90 bash -c 'until tmux capture-pane -t orbit -p | grep -qE "launched|ABORT|ERROR"; do sleep 0.2; done'
tmux send-keys -t orbit 'ss landing' Enter
tmux capture-pane -t orbit -p
```

Then **open the screenshot**. A blank frame is a failed launch, however clean the log looks.

Screenshots land in `/tmp/orbit-run/shots` (override: `SCREENSHOT_DIR`).

### Commands

| command | what it does |
|---|---|
| `launch` | launch into the sandbox; aborts if isolation didn't take |
| `reset` | delete the sandbox so the next launch is a fresh install (quit first) |
| `ss [name]` | screenshot → `/tmp/orbit-run/shots/<name>.png` |
| `click <sel>` / `click-text <text>` | click via DOM |
| `type <text>` / `press <key>` | keyboard input |
| `wait <sel>` | wait for a selector, 10s timeout |
| `eval <js>` / `text [sel]` | evaluate in the page / print innerText |
| `settings` | dump every setting through the real `settings:get` IPC |
| `set <json>` | write through `settings:update`, printing sent vs stored per key |
| `sql-set <name> <raw>` | write a raw `setting_value` straight into SQLite (quit first) |
| `sql <statement>` | arbitrary SQL against the sandbox DB — SELECT prints rows, else the change count (quit first) |
| `sql-dump` | print the settings rows unparsed, as they sit on disk |
| `log [grep]` | tail/filter `debug.log` — where read-side rejections surface |
| `windows` | list windows and webContents |
| `quit` | close the app (REPL stays up) |

`set` prints **sent vs stored**, which is the quickest way to see the settings schema refuse a
value — a rejected write shows the old value still in place rather than throwing.

`sql-set` exists because the interesting failure modes can't be produced through the UI. Rows
holding malformed JSON, out-of-range numbers, or values from an older build are exactly what the
read-side guards are for, and this is the only way to create them.

`sql` is the general form, for tables `sql-set` doesn't cover. Two things it unlocks:

- **`agent_data`** — the per-agent KV store has the same guards as settings, reachable through
  `window.agentsAPI.agentData.*`.
- **Replaying a migration.** Migrations are selected by *absence* from `schema_migrations`, so
  deleting a row makes that one migration re-run on the next launch — the only way to exercise a
  migration's behaviour against a database state you've constructed.

```
sql DELETE FROM schema_migrations WHERE id = '00000000000027'
```

Legacy numeric versions are the id zero-padded to 14 characters; migrations added since use
`YYYYMMDDHHMMSS` directly.

## A worked example

Confirming the settings guards behave in the real app:

```
launch
set {"userName":"Ada","systemStatsPollIntervalMs":1,"nonsenseKey":"x"}
    userName: sent "Ada" → stored "Ada"
    systemStatsPollIntervalMs: sent 1 → stored undefined      ← below the 500 floor
    nonsenseKey: sent "x" → stored undefined                  ← not a known setting
sql-dump                     # only the valid row is on disk
quit
sql-set appSettings.agentName {not json
launch                       # app still starts; the bad row is skipped, not fatal
log skipping                 # [db] skipping appSettings.agentName: value is not valid JSON (9 bytes)
settings                     # agentName absent; everything else intact
```

## Gotchas

- **Don't launch without the sandbox.** See the top of this file. The driver enforces it; a
  hand-rolled `_electron.launch()` does not.
- **`npm run build` first.** `main` points at `dist-electron/main/index.js`, and the dev script
  (`npm run dev`) deletes that directory before starting electron-vite. The driver checks and
  tells you rather than hanging for 60s.
- **`node_modules` is per-worktree** and untracked, so a fresh worktree needs `npm install`
  (~minutes: it builds `better-sqlite3` natively and runs `electron-builder install-app-deps`).
  Verify the Electron binary afterwards — see the Build section; a successful-looking install
  routinely leaves none.
- **A worktree cut from `main` contains no app.** `main` is a README-only "idea phase" commit —
  four files, no `src/` or `electron/`. Branch worktrees from `develop`
  (`git worktree add -b <branch> .claude/worktrees/<name> develop`), and if you inherit one,
  confirm the base with `git log --oneline <branch> ^develop` before concluding anything about
  what is or isn't in the tree.
- **Wait for `window.agentsAPI`, not a fixed sleep.** The renderer renders nothing until settings
  have loaded, so the bridge appearing is the real ready signal.
- **`[aria-label*="Close"]` quits the app** — it matches the window's X before any modal's close
  button. Use Escape or a specific selector.
- **A stale Electron holds port 9222**, so a later CDP-based launch silently gets no debugger.
  `lsof -ti:9222 | xargs kill -9`.
- **Placeholders are attributes, not `innerText`.** Checking a default rendered as a placeholder
  (`agentName` → "Orbit" on the onboarding step) needs `input.placeholder`; scraping `innerText`
  reports a false failure.
- **Driver scripts written outside the repo** can't resolve `playwright-core` by walking up from
  their own path. Use `createRequire(<repo>/package.json)`.

## Troubleshooting

- **`ABORT: userData is …`** — the `--user-data-dir` switch didn't take. Do not work around it by
  removing the check; find out why first.
- **Launch times out (60s)** — usually no build. Run `npm run build`.
- **`ERROR: quit first`** — `sql-set` and `reset` touch files the running app holds open.
- **App opens on onboarding every time** — expected: the sandbox starts empty. Complete
  onboarding, or `set {"onboardingDone":true}` to skip past it.
