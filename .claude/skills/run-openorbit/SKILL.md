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

### No tmux available

If `tmux` isn't installed, pipe a whole script into the driver via stdin instead — it detects a
non-TTY and switches to **batch mode**: reads the full script up front, then awaits each command
in order before running the next (a plain `printf ... | node driver.mjs` would otherwise let
readline emit every line before the first async command resolves, racing `set`/`type` ahead of a
`launch` still in flight).

```bash
cat > /tmp/orbit-script.txt <<'EOF'
launch
ss landing
EOF
node .claude/skills/run-openorbit/driver.mjs < /tmp/orbit-script.txt
```

**The app closes at the end of every batch script** — `quit` runs automatically after the last
line. This means **one script = one continuous session**: everything for a single interaction
sequence (onboard, send a message, inspect the result, click something, inspect again) has to be
*one* piped script, not several. Splitting it across multiple `node driver.mjs < script` calls
silently starts over from a fresh app launch each time — see the next gotcha for why that's easy
to miss.

`eval` runs in the page's `Function` constructor, which does **not** allow top-level `await`
(`SyntaxError: await is only valid in async functions`). For anything that needs to wait —
polling for a reply, pausing between steps — wrap it: `eval (async()=>{ await new
Promise(r=>setTimeout(r,500)); return document.querySelector('...')?.textContent; })()`. A
polling loop in one `eval` call (rather than many separate `eval`/`ss` round trips) is both more
reliable and cheaper than guessing a fixed delay:

```
eval (async()=>{const log=[];for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,1200));
  const done = !document.querySelector('#inp')?.disabled;
  log.push({t:i*1.2, done});
  if (done) break;
} return log;})()
```

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

## Onboarding through to a real chat message

Everything below is **one continuous batch script** (see "No tmux available" above) — required
if you need to inspect the resulting conversation, since a second `launch` would start over. For
a hosted provider, only three fields need real typed input: agent name, your name, and the API
key — the provider chip pre-fills the URL and model.

```bash
source .env.test   # OPENAI_API_KEY, or whichever provider you're testing
cat > /tmp/script.txt <<EOF
reset
launch
type Orbit
click .onboarding-next
type Tester
click .onboarding-next
click .onboarding-next
click-text Brief & direct
click-text Beginner
click-text Just tell me what to do
click-text OpenAI
click .onboarding-next
type ${OPENAI_API_KEY}
click .onboarding-next
click .onboarding-next
wait #chat-log
press Escape
click #inp
type Hello, what tools do you have?
press Enter
eval (async()=>{for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,1200));
  if(!document.querySelector('#inp')?.disabled) break;}
  return document.querySelector('.turn.assistant:last-child .m')?.textContent;})()
ss reply
EOF
node .claude/skills/run-openorbit/driver.mjs < /tmp/script.txt
```

The profession/responseStyle/technicalLevel/stuckStyle steps are all optional — `click
.onboarding-next` (blank text step) or a chip click both advance past them; skipping them
entirely is fine unless the thing under test specifically depends on one of those answers.

## Gotchas

- **Chat messages are not persisted across a relaunch.** The live chat log is renderer-only
  React state, seeded fresh with the static "Online. Tell me what needs doing." greeting on
  every mount — there is no restore from `chat_history` on load. A second `launch` in a new
  script (even against the same sandbox, without `reset`) starts a brand-new conversation, not a
  continuation. If a test needs to inspect a message you just sent, do it inside the *same*
  batch script that sent it — don't check across two `node driver.mjs` invocations.
- **Onboarding's last step takes 500ms to actually finish, even once the field is valid.**
  `finish()` (`OnboardingScreen.tsx`) sets an exit-animation flag and only calls `onComplete` after a
  `setTimeout(..., 500)`. Checking state (or screenshotting) immediately after the final
  `click .onboarding-next` reads the still-mid-transition onboarding screen, not the app it
  becomes — `wait #chat-log` (10s timeout, so it comfortably outlasts the 500ms) rather than
  checking synchronously.
- **A chip-selected provider pre-fills the next two onboarding fields with real values, not
  just placeholders.** Choosing "OpenAI" on the provider step writes the actual base URL and
  default model straight into `answers.apiUrl`/`answers.model` (`selectChip` in
  `OnboardingScreen.tsx`) — the API-URL and model steps arrive already filled in, not merely
  showing a greyed placeholder. `type`ing into them (Playwright's `keyboard.type` appends, it
  doesn't replace) produces a doubled, broken value
  (`https://api.openai.com/v1https://api.openai.com/v1`), which then makes every real API call
  404. For a hosted provider, click `.onboarding-next` directly on those two steps without typing
  anything; only the API key field is genuinely empty and needs a real `type`.
- **Onboarding's Enter-to-advance can silently double-skip a step** when the next step is a chip
  step (its first chip autofocuses) — reproduced consistently, tracked as KI-18 in
  `0-cowork/memory/known-issues.md`, not fixed. Clicking `.onboarding-next` instead of pressing
  Enter does not have this problem — prefer clicks over Enter when scripting onboarding.
- **The feature tour auto-launches right after onboarding completes** (a `driver.js` overlay,
  "1 of 23"). `press Escape` once before your first real interaction to dismiss it — clicking its
  visible "×" is riskier: `[aria-label*="Close"]` also matches the window chrome's own close
  button (see the gotcha below).
- **`settings`'s `chatApiKeySet` reflects only the legacy `appSettings.chatApiKey` column, not
  the provider-registry `providers` table.** After onboarding with a registry provider (anything
  chosen via the provider chip step, e.g. OpenAI), `chatApiKeySet` correctly reads `false` even
  though the real credential is stored and working — it is not a signal that onboarding or
  `selectChat` failed. Look for `chatProviderId` being set to the expected id instead.
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
