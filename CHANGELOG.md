# Changelog

All notable changes to OpenOrbit are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] — 2026-08-22

### Added

- **A Stop button on the chat input** — an in-flight agent run had no cancel
  mechanism anywhere in the pipeline, only the configured run timeout (up to an
  hour by default). The send button now swaps to Stop for the run's whole
  duration, including any tool-approval or `ask_user` pause, and aborting
  settles those the same way an abandoned run already did.

### Fixed

- A cancelled run showed "(no response)" when nothing had streamed yet; it now
  shows "Stopped." instead.

## [0.1.2] — 2026-08-06

### Added

- **A `write_checklist` tool** giving Orbit and Cipher a live plan/progress widget in
  chat, and an **`ask_user` tool** for structured, one-at-a-time questions rendered as
  a real quick-reply card instead of plain chat text.
- **An LLM-generated onboarding greeting**, a live "Thinking" indicator during a run,
  a `chat-visible-conversations` setting, and agent name/tagline suggestions when
  creating a custom agent.

### Changed

- Built-in specialist agents (Cipher, Atlas, Explorer, Chrono) are now called as
  tools from the orchestrator rather than via handoffs, so each stays a fully
  independent, memoryless sub-run per call.

### Fixed

- **Cipher could get stuck in a confirmation loop** — repeating "please confirm" for
  a change the user had already approved, because a specialist has no memory of its
  own prior turn once it ends. The orchestrator now states the approval explicitly
  in the handoff instead of repeating the original request.
- **Cipher (or Orbit relaying its output) could claim an agent was created or
  updated when no such tool call happened in that run.** A new guard checks every
  reply that reads as a creation/update success against the actual tool calls made
  in that run and corrects it if they don't match.
- **The chat input box wasn't vertically centered against its buttons** on a
  single-line message; alignment now only shifts to the top once the input grows to
  multiple lines.
- **Search could fabricate community quotes, usernames, or commenters** when no real
  discussion was found. Explorer now says so instead of inventing a voice, and the
  same no-fabrication rule was extended app-wide to cover quotes and people, not just
  figures and records.
- **`orchestratorPromptOverride` and Orbit's own tool/connector/MCP attachments were
  writable through Cipher's general settings tool**, reopening a privilege-escalation
  path the settings protection list was meant to close. Moved back under the
  protected-settings list.
- Two unbounded LLM calls (onboarding identity suggestions, the onboarding greeting)
  now have explicit timeouts with a fallback instead of hanging the UI indefinitely.
- The "type anywhere focuses chat input" behavior no longer bypasses a disabled send
  state.

## [0.1.1] — 2026-08-05

### Added

- **A Help button in the bottom-right dock** opens the OpenOrbit GitHub wiki in the
  default browser. The bottom chrome dock is now split in two — Info and the app
  version stay bottom-left, Help and Settings move to a new bottom-right dock — and
  the tour-replay button switches from a question-mark icon to a route icon to free
  `?` for Help.
  ([#97](https://github.com/maneja81/OpenOrbit/pull/97))
- **The app checks for a new release at launch** and badges the existing About icon
  rather than adding a new toast/banner system. The previous build-time-only check
  could only ever compare a build against itself, so it could never detect a release
  published after the build ran. No auto-download or install — the project isn't
  code-signed, so `electron-updater`'s silent-install path can't run on macOS, and a
  Windows/Linux-only version would give a different experience per platform; this
  only tells the user a release exists.
  ([#98](https://github.com/maneja81/OpenOrbit/pull/98))
- **Orbit now acknowledges config changes in chat.** Adding a knowledge file,
  enabling location, or connecting a connector attached to an agent produces one
  coalesced message (e.g. "I've got report.pdf. How can I help?"), shown immediately
  if Settings is closed or once on close if several changes were made together.
  ([#99](https://github.com/maneja81/OpenOrbit/pull/99))
- **A dedicated `@` agent-mention menu in the chat input**, separate from the
  existing `/` command menu. Typing `@` (or clicking the new "Agents" toolbar chip)
  opens a menu of every enabled agent, grouped under "System" (the four built-in
  agents) and "Custom" (user-created ones); selecting one inserts a plain-name
  mention.
  ([#101](https://github.com/maneja81/OpenOrbit/pull/101))
- A Download section in the README linking directly to each v0.1.0 release asset
  (macOS arm64/x64 `.dmg`, Windows `.exe`, Linux `.AppImage`), noting these are
  versioned filenames that change next release, and flagging that builds are
  unsigned so the Gatekeeper/SmartScreen prompt on first run isn't a surprise.
  ([#96](https://github.com/maneja81/OpenOrbit/pull/96))
- **A Playwright E2E test suite (`e2e/`)** driving the real built Electron app,
  starting with the onboarding wizard and verifying selected-provider credentials
  land correctly in SQLite. Two run modes — `npm run test:e2e` (isolated: spins up
  a throwaway git worktree, installs/builds/tests there, tears itself down) and
  `npm run test:e2e:local` (fast, against the current checkout). Which provider a
  spec authenticates against is configurable via `E2E_PROVIDER` in a gitignored
  `.env.test`, so live runs don't have to hit OpenAI billing every time.
  ([#103](https://github.com/maneja81/OpenOrbit/pull/103))
- **E2E coverage across every major settings surface and the core chat flow**,
  built out in six phases on top of #103: Agents, HTTP Tools, General, Privacy &
  Safety, App Sounds and Tasks
  ([#107](https://github.com/maneja81/OpenOrbit/pull/107)); MCP Servers and Models
  ([#108](https://github.com/maneja81/OpenOrbit/pull/108)); knowledge-base
  Add-from-URL discovery and the About tab's update check
  ([#109](https://github.com/maneja81/OpenOrbit/pull/109)); the core chat
  send/reply flow and slash-command interception, the suite's first spec against
  a real billed provider call
  ([#110](https://github.com/maneja81/OpenOrbit/pull/110)); and Connectors-tab
  disconnect
  ([#111](https://github.com/maneja81/OpenOrbit/pull/111)). Shares a common
  `e2e/helpers.ts` for sandboxed launch, click/type, and DB-poll assertions across
  all specs. CLAUDE.md now documents this as a standing process — when a UI
  surface needs a spec, and the shared conventions to reuse
  ([#112](https://github.com/maneja81/OpenOrbit/pull/112)).

### Changed

- The orchestrator's internal reasoning now explicitly decomposes multi-part user
  messages, checks which specialist/resource actually covers each part, and is
  honest about the one-handoff-per-message architectural limit instead of implying
  a same-turn multi-specialist chain it can't execute. Atlas no longer offers to
  search "outside the knowledge base" since it has no web tools to back that up.
  A pre-existing routing defect — the orchestrator can pick the wrong specialist
  based on which one ran the previous turn — is not fixed by this change and is
  tracked as follow-up.
  ([#100](https://github.com/maneja81/OpenOrbit/pull/100))

### Fixed

- **Errors in MCP Servers, Connectors and HTTP Tools settings never cleared.** The
  panels' data hooks live for the app's lifetime, and 8 methods across
  `useMcpServers`/`useConnectors`/`useHttpTools` set `error` on failure but
  bypassed the hooks' shared `run()` helper that clears it on entry — so a stale
  failure could survive a tab switch or a full Settings close/reopen, outliving
  the mutation that caused it.
  ([#99](https://github.com/maneja81/OpenOrbit/pull/99))
- **The orbit orchestrator node and lower agent orbs could sit under the chat
  log.** At a 900px window the chat panel's 40vh max-height left the orbit node
  about 5px of clearance, and the panel's fade gradient made that read as a
  full overlap once the log grew. The chat log now caps at 28vh and the orbit's
  vertical center moved from 41% to 38.5% of the container, about 136px of
  clearance instead of 5px.
  ([#105](https://github.com/maneja81/OpenOrbit/pull/105))
- Dependency update for `hono` 4.12.33 → 4.13.0.
  ([#104](https://github.com/maneja81/OpenOrbit/pull/104))

## [0.1.0] — 2026-08-03

The first release. Installers for macOS, Windows and Linux are attached to
the [GitHub Release](https://github.com/maneja81/OpenOrbit/releases/tag/v0.1.0)
for this tag — see [Build and run](README.md#build-and-run) if you'd rather
build from source.

### Added

- **The application itself** — an Electron desktop app in which a central
  orchestrator delegates to specialist sub-agents. Ships with four: Cipher
  (onboarding, settings, agent authoring), Atlas (knowledge base and local
  folders), Explorer (web search and page reading), and Chrono (reminders and
  recurring prompt tasks). Includes the Electron main/preload/renderer tree, IPC
  handlers, SQLite migrations, Google connectors for Gmail, Calendar, Drive and
  Contacts, MCP server support, user-authored HTTP tools, a document-ingesting
  knowledge base, voice input and output, and the orbit UI.
  ([#2](https://github.com/maneja81/OpenOrbit/pull/2))
- **Pick an AI provider per slot and per agent.** OpenRouter, OpenAI, Claude and
  Local AI (Ollama) are chosen during onboarding with the URL and model
  prefilled, changed later in Settings → AI Models, and overridden per agent — so
  an orchestrator on OpenAI can hand off to a sub-agent on Claude. Credentials
  are stored per provider rather than per slot, so one key serves every agent
  pointed at it. Cost tracking follows the provider that actually served each
  call: OpenRouter reports its real billed figure, local models show *Free*, and
  anything unpriced shows tokens rather than a guess. Existing installs are
  migrated and keep working.
  ([#54](https://github.com/maneja81/OpenOrbit/pull/54))
- **A live countdown on tool-approval prompts**, on both the modal and the
  in-chat card, turning amber for the last 30 seconds. Approvals decline
  themselves after five minutes, and previously nothing said so.
  ([#51](https://github.com/maneja81/OpenOrbit/pull/51))
- **Re-run onboarding from Settings → General** without a Danger Zone reset. The
  stored answers stay put and become the starting point; chat history, agents,
  memory and the knowledge base are untouched.
  ([#40](https://github.com/maneja81/OpenOrbit/pull/40))
- **A release pipeline.** Pushing a `v*` tag builds installers on macOS, Windows
  and Linux and attaches them to a GitHub Release. The tag is gated by the same
  four checks every PR gets — by reference rather than a copied workflow, since a
  tag can be pushed from a commit that never went through a PR.
  ([#69](https://github.com/maneja81/OpenOrbit/pull/69))
- Packaging configuration for electron-builder, including an explicit file
  allowlist — the default `files: ["**/*"]` would have packed the entire project
  directory, `.env` included, into a publicly downloadable installer.
  ([#66](https://github.com/maneja81/OpenOrbit/pull/66))
- An app icon source, so packaged builds no longer ship the default Electron
  icon on all three platforms.
  ([#65](https://github.com/maneja81/OpenOrbit/pull/65))
- A GitHub Actions CI workflow running the project's four gates — eslint,
  `tsc -b`, tests, build — on every push to `develop` and every PR.
  ([#64](https://github.com/maneja81/OpenOrbit/pull/64))
- `SECURITY.md`, covering supported versions and how to report a vulnerability.
  ([#46](https://github.com/maneja81/OpenOrbit/pull/46))

### Changed

- **The safety controls now live in one place**, Settings → Privacy & Safety,
  split into *Approval* and *What Orbit can see*. The six settings governing what
  the app will do without asking were previously split between the HTTP Tools tab
  and General, so nobody auditing the app had a single place to look.
  ([#34](https://github.com/maneja81/OpenOrbit/pull/34))
- **Settings → Models is split into "API keys" and "Default models"**, cut by
  what a field is rather than which slot it belongs to. Previously the Chat
  provider's card was a different shape from every other provider's, so setting
  up a key was two different tasks depending on which provider you were on, and
  there was nowhere to see all your models at once. Each slot's Test button moves
  in beside the credentials it actually checks.
  ([#70](https://github.com/maneja81/OpenOrbit/pull/70))
- **Text settings save on blur** rather than on every keystroke. Every text field
  in Settings previously made one IPC round trip and one SQLite write per
  character, and a value the write boundary refused snapped away mid-typing.
  ([#43](https://github.com/maneja81/OpenOrbit/pull/43))
- **The system-stats poll interval applies immediately**, removing the only
  restart-required setting in the app.
  ([#41](https://github.com/maneja81/OpenOrbit/pull/41))
- **The orchestrator prompt box shows the template, not a rendered snapshot.**
  Editing it previously froze `{{agentName}}`, `{{userName}}` and
  `{{currentDateTime}}` permanently — the agent name stopped following a rename
  and the date of the edit was baked in for good. An active override is now
  labelled as one.
  ([#31](https://github.com/maneja81/OpenOrbit/pull/31))
- **The bundle is 51 MB smaller.** The background video and music were shipping
  at bitrates far above what they are rendered at; re-encoded with no code or
  path changes. Built renderer output dropped from 61 MB to 11 MB.
  ([#62](https://github.com/maneja81/OpenOrbit/pull/62))
- The greeting no longer wishes you good night while you are using the app — the
  21:00–04:59 band reads "Still at it", and the afternoon/evening boundary moved
  from 17:00 to 18:00.
  ([#52](https://github.com/maneja81/OpenOrbit/pull/52))
- The default TTS model is now `gpt-4o-mini-tts` rather than `tts-1`, and voice
  synthesis failures are logged instead of silently falling back to the browser's
  native speech.
  ([#23](https://github.com/maneja81/OpenOrbit/pull/23))
- The main process reads settings defaults from one shared source. Two had
  already diverged from the renderer's — on a fresh install the Settings toggles
  for voice input and type-anywhere showed *on* while the orchestrator's own view
  was *off*.
  ([#21](https://github.com/maneja81/OpenOrbit/pull/21),
  [#26](https://github.com/maneja81/OpenOrbit/pull/26))
- eslint now ignores `dist-electron/`, so lint gives the same answer whether or
  not a build has run.
  ([#10](https://github.com/maneja81/OpenOrbit/pull/10))

### Removed

- The unused `node` dependency. It declared a `node` binary, so npm put it first
  on `PATH` — every `npm test`, `npm run build` and `npm run dev` was running
  under a Node version pinned by a package nobody knew was installed, and it
  added 139 MB to every platform bundle.
  ([#63](https://github.com/maneja81/OpenOrbit/pull/63))
- The orchestrator's dead enabled-toggle handler, which wrote a locked key that
  was silently dropped.
  ([#39](https://github.com/maneja81/OpenOrbit/pull/39))

### Fixed

- **`getDb()` could cache a half-migrated database connection.** If a migration threw, the
  singleton was already assigned, so every call after the first silently returned the broken
  connection instead of retrying — reads and writes proceeded against a schema that might be
  missing tables or columns.
  ([#76](https://github.com/maneja81/OpenOrbit/pull/76))
- **The web search daemon's force-kill on quit could never fire**, a failed daemon start left it
  poisoned for the rest of the session with the orphaned process still running, an unspawnable
  daemon could crash the whole app, and a slow health check could take the app down at launch on
  a path meant to be non-blocking. All four fixed in the same pass.
  ([#79](https://github.com/maneja81/OpenOrbit/pull/79),
  [#80](https://github.com/maneja81/OpenOrbit/pull/80),
  [#81](https://github.com/maneja81/OpenOrbit/pull/81),
  [#82](https://github.com/maneja81/OpenOrbit/pull/82))
- **A daemon error response threw a raw JSON parse error** instead of reporting what actually
  failed, reading as a parsing bug in Explorer's tools or the knowledge base's "Add from URL"
  rather than a failed request.
  ([#87](https://github.com/maneja81/OpenOrbit/pull/87))
- **Quitting mid-task abandoned it outright**, potentially orphaning MCP server subprocesses the
  task had open. The app now waits for an in-flight scheduled task (capped at 10s) before it
  actually quits.
  ([#88](https://github.com/maneja81/OpenOrbit/pull/88))
- A scheduled task's OS notification truncated the body to a safe length but not the title,
  which is user- or agent-authored with no cap of its own.
  ([#92](https://github.com/maneja81/OpenOrbit/pull/92))
- **Browse Registry returned nothing for every MCP query.** The registry wraps
  each entry as `{ server, _meta }` and the parser read the fields off the
  wrapper, so a healthy response carrying 30 servers produced an empty list — for
  the entire life of the feature. Also corrects the generated command,
  surfaces required environment variables, filters to stdio transports, and adds
  an empty state and a result count.
  ([#49](https://github.com/maneja81/OpenOrbit/pull/49))
- **Clearing an agent's Model ID sent an OpenAI model id to whatever provider
  that agent used.** A blank model now resolves against the agent's own provider,
  or the live orchestrator model, instead of the build's compile-time default.
  ([#67](https://github.com/maneja81/OpenOrbit/pull/67))
- **Rotating the Chat API key silently reset the model and the API URL.**
  Settings saves the key, URL and model as three separate writes, and every
  omitted field fell through to the provider's registry default — so changing one
  reset the others, and because the slot re-points every inheriting agent, a key
  rotation moved all of them onto a different model.
  ([#68](https://github.com/maneja81/OpenOrbit/pull/68))
- **An agent's Model ID placeholder advertised a model its provider didn't
  serve** — an agent pinned to Claude still showed an OpenAI id as its default.
  It now shows what a blank field would actually resolve to. A model left over
  from a previous provider is also flagged rather than left looking configured,
  by asking whether an id carries *another* provider's naming scheme rather than
  checking it against a list of known-good prefixes — a list rejects every model
  an OpenAI-compatible gateway serves, and a false warning telling someone their
  working setup is broken is the more expensive error.
  ([#71](https://github.com/maneja81/OpenOrbit/pull/71),
  [#72](https://github.com/maneja81/OpenOrbit/pull/72))
- **One corrupt database row could read as "my entire configuration was wiped."**
  An unguarded `JSON.parse` in the settings store made a single malformed row
  throw out of the whole read, falling back to every default, API keys included.
  Now skipped per row. The same guard was extended to the agent data store and to
  every remaining JSON column — connector credentials, HTTP tool headers, MCP
  server environment, task recurrence, and agent attachment lists.
  ([#8](https://github.com/maneja81/OpenOrbit/pull/8),
  [#11](https://github.com/maneja81/OpenOrbit/pull/11),
  [#37](https://github.com/maneja81/OpenOrbit/pull/37))
- **A corrupt API key row stopped the app starting at all.** Migration 27 parsed
  each key row unguarded, so a throw inside its transaction failed every
  migration and left the app recoverable only by hand-editing SQLite.
  ([#12](https://github.com/maneja81/OpenOrbit/pull/12))
- **The numeric settings enforce the ranges they advertise.** `min` on a number
  input constrains the spinner and nothing else, so a 1-second agent run timeout
  and a 1 ms system-stats poll interval were both reachable by typing. Clearing a
  box to retype also snapped the value back mid-edit, and coerced the background
  music volume to silent.
  ([#36](https://github.com/maneja81/OpenOrbit/pull/36))
- Values written by earlier builds are validated on read, not just on write — a
  stored `null` previously beat its own default and reached the UI, flipping
  React inputs to uncontrolled.
  ([#17](https://github.com/maneja81/OpenOrbit/pull/17),
  [#25](https://github.com/maneja81/OpenOrbit/pull/25))
- **A click outside the HTTP tool approval modal silently declined the call.**
  The component documented itself as not dismissible by clicking away, and was.
  ([#47](https://github.com/maneja81/OpenOrbit/pull/47))
- **An approval prompt answered by the five-minute timeout stayed on screen**,
  looking live, minutes after the app had already declined the call and told the
  agent.
  ([#48](https://github.com/maneja81/OpenOrbit/pull/48))
- **Agent create, update and delete failed silently.** The agents hook was the
  only data hook with no error handling — a failed delete closed the modal and
  left the agent in place, with no message.
  ([#56](https://github.com/maneja81/OpenOrbit/pull/56))
- **Onboarding answers that failed to save said nothing.** The write was
  fire-and-forget; onboarding completed, the app opened, and the answers were
  gone with nothing on screen to suggest it.
  ([#61](https://github.com/maneja81/OpenOrbit/pull/61))
- **A render failure in the chat took the whole app to the root fallback.**
  Error boundaries now wrap the orbit scene and the chat panel — the two surfaces
  a user actually lives in, and the largest render-time surface in the app, since
  the chat renders untrusted model output through a markdown pipeline.
  ([#58](https://github.com/maneja81/OpenOrbit/pull/58))
- **Modals asserted `aria-modal` without implementing any of it.** They now take
  a required label, keep Tab inside the dialog, restore focus to whatever opened
  them, and focus something even with no text field present.
  ([#45](https://github.com/maneja81/OpenOrbit/pull/45))
- **The orbit's orbs were mouse-only.** Clicking an orb is how you open an
  agent's details, so the primary controls on the app's main screen had no
  keyboard equivalent. The click-to-open chat image had the same gap.
  ([#57](https://github.com/maneja81/OpenOrbit/pull/57),
  [#59](https://github.com/maneja81/OpenOrbit/pull/59))
- Enter now confirms in the delete-confirmation modal, which was the one place in
  the app where typing the confirmation and pressing Enter did nothing.
  ([#55](https://github.com/maneja81/OpenOrbit/pull/55))
- A second click no longer queues a duplicate knowledge-base operation. Re-syncing
  a URL is network-bound and gave no feedback of its own.
  ([#53](https://github.com/maneja81/OpenOrbit/pull/53))
- **Deleting an MCP server, connector or HTTP tool collection now detaches it from
  the orchestrator.** Agent rows were pruned; the orchestrator's attachments are
  settings and were not — so recreating something that reused a previous id
  silently re-attached it.
  ([#38](https://github.com/maneja81/OpenOrbit/pull/38))
- **A failed settings reset left the Danger Zone button disabled forever**, on
  "Resetting…", with no message and no way out but quitting the app.
  ([#27](https://github.com/maneja81/OpenOrbit/pull/27))
- **CSP was blocking synthesized speech.** `media-src` allowed `'self'` only,
  while TTS audio arrives over IPC and plays from a `data:` URI — so AI voice was
  silently rejected and fell back to browser speech on every use.
  ([#33](https://github.com/maneja81/OpenOrbit/pull/33))
- Voice synthesis failures surface a real reason instead of a silent fallback: a
  200 response is now checked to actually be audio, and the browser-fallback log
  carries the real media error.
  ([#30](https://github.com/maneja81/OpenOrbit/pull/30))
- **Electron's IPC error wrapper was deciding error categories.** "Access denied"
  is thrown across IPC and therefore always arrived wrapped, so the check for it
  never matched and users got a generic "Something went wrong" instead of the one
  message telling them to grant the folder.
  ([#29](https://github.com/maneja81/OpenOrbit/pull/29))
- A wrong or misspelled key passed to the HTTP tool tester now names the accepted
  keys, instead of blaming a parameter definition for a missing sample value.
  ([#60](https://github.com/maneja81/OpenOrbit/pull/60))
- Tool output in the diagnostic log shows the tool's actual return value rather
  than re-printing the preceding call line.
  ([#28](https://github.com/maneja81/OpenOrbit/pull/28))

### Security

- **A redirect could bypass the SSRF guard.** User-authored HTTP tools, the HTTP Tools test
  button, and sitemap discovery all validated a URL before fetching it, but `fetch()` follows
  redirects by default — so a `302` to a cloud-metadata or localhost address was followed and
  its body handed to the agent (or, for sitemaps, silently trusted). All three now follow
  redirects manually, re-validating every hop.
  ([#74](https://github.com/maneja81/OpenOrbit/pull/74))
- **`update_agent` could rewrite any agent's system prompt or attach a connector with no
  approval**, the same way settings once could (see below) — a rewritten prompt paired with a
  newly attached Gmail connector is durable persistence plus an exfiltration path. Changing an
  agent's prompt, MCP servers, or connectors now pauses for approval; renaming an agent or
  changing its model does not, since neither grants lasting capability.
  ([#75](https://github.com/maneja81/OpenOrbit/pull/75))
- **Creating a recurring or one-shot prompt task required no approval.** A prompt task runs
  through a full orchestrator — every MCP server, connector, and HTTP tool the agent has —
  whenever it's due, with no user present to review it. Creating or editing one now pauses for
  approval when it carries a prompt; a plain reminder (just a notification) still doesn't.
  ([#77](https://github.com/maneja81/OpenOrbit/pull/77))
- **A scheduled task that hit one of the new approval gates silently did nothing.** The
  scheduler's run loop never inspected the approval interruption a headless run can't answer,
  so the task recorded as complete with no result and no signal it was ever blocked. It now
  declines the call explicitly and records why.
  ([#78](https://github.com/maneja81/OpenOrbit/pull/78))
- **A stored OAuth token missing an expiry was treated as never expiring**, converting a
  connector into one that fails every call with no automatic recovery. Latent today — Google
  always returns an expiry — but the flow is generic and reusable by any future connector.
  ([#83](https://github.com/maneja81/OpenOrbit/pull/83))
- **An HTTP tool parameter name was interpolated unescaped into a RegExp.** A name like `.*`
  silently substituted one value across every placeholder in a path; an unbalanced `(` threw an
  opaque failure. Parameter names are now restricted to a safe identifier pattern at
  creation/edit time.
  ([#84](https://github.com/maneja81/OpenOrbit/pull/84))
- **The HTTP Tools test button skipped its protocol check when private hosts were allowed.**
  "Allow private addresses" is meant to widen which hosts are reachable, never which protocols
  — the agent-facing path already enforced this; the test button now matches it.
  ([#85](https://github.com/maneja81/OpenOrbit/pull/85))
- **Every Chromium permission was granted unconditionally**, not just the microphone access
  voice input actually needs — notifications, clipboard-read, midi, and anything a future
  Electron upgrade adds would have arrived pre-approved. Now an explicit allowlist of one.
  ([#86](https://github.com/maneja81/OpenOrbit/pull/86))
- **Seven IPC channels reachable from the renderer had no caller anywhere in the app** —
  `fs.readFile`, `fs.writeFile`, `fs.listAllowedRoots`, `fs.removeAllowedRoot`, `agent.run`,
  `memory.add`, `memory.list`. `fs.writeFile` in particular could write arbitrary content to any
  path inside a granted folder from any script that reached the renderer. Removed, along with
  the now-fully-unused `memory` feature they backed.
  ([#89](https://github.com/maneja81/OpenOrbit/pull/89))
- **A corrupted or tampered secret failed with a raw crypto exception** instead of a message a
  user could act on, and the module holding every API key, OAuth token, and MCP env var had no
  test coverage at all. Both fixed together.
  ([#90](https://github.com/maneja81/OpenOrbit/pull/90))
- **The OAuth consent callback told the browser "success" before checking whether it actually
  was.** A failed state/code check rejected the connection in the app while the browser kept
  showing the success page. The response is now written after validation and varies by outcome,
  with `Referrer-Policy`/`Cache-Control` added since the callback URL carries the authorization
  code. A failed token exchange or refresh also no longer echoes the provider's raw error body
  into the agent's context — only the status does.
  ([#91](https://github.com/maneja81/OpenOrbit/pull/91))
- **An agent could disable the approval gate governing it.** The config agent's
  allowlist included the three HTTP approval settings, the approval display mode,
  and location access — so "set httpToolApprovalDelete to false" was a sentence
  an attacker could put in a web page, an email, or a knowledge base file, and
  the next DELETE would execute without pausing.
  ([#18](https://github.com/maneja81/OpenOrbit/pull/18))
- **An agent could redirect the provider URLs.** Both were writable by the config
  agent and neither was parsed — `"not a url at all"` and `ftp://example.com/v1`
  were stored verbatim — while four call sites attach `Authorization: Bearer` to
  whatever host they name. Injected text could have pointed the next agent run,
  and the API key with it, at an attacker's endpoint.
  ([#22](https://github.com/maneja81/OpenOrbit/pull/22))
- **The API keys were sent to the renderer** on every settings read and held in
  React state for the lifetime of the app, where anything with script access
  could read them in the clear. Nothing in the renderer ever needed the value —
  both reads were `type="password"` fields, which render dots either way. The IPC
  now returns booleans.
  ([#24](https://github.com/maneja81/OpenOrbit/pull/24))
- **Settings interpolated into system prompts are now bounded.** The agent name,
  agent description and user name had no length or line limit, are writable by
  the config agent, and appear in the opening line of every prompt the app builds
  — so injected text could plant a persistent, invisible fake prompt section.
  ([#32](https://github.com/maneja81/OpenOrbit/pull/32))
- **Every settings write is validated against one shared schema.** The write
  boundary previously checked only that the patch was a plain object, so a typo'd
  key became a real row, and a string could land in a field whose consumers
  assume a boolean — where `"false"` reads as *on*.
  ([#16](https://github.com/maneja81/OpenOrbit/pull/16))
- **A provider URL that would send the API key in the clear now warns** — and
  only when the traffic would actually leave the machine or the local network, so
  pointing at Ollama or another self-hosted server over plain HTTP still works.
  ([#42](https://github.com/maneja81/OpenOrbit/pull/42))
- The tasks IPC validates its input. It was the last write surface that did not,
  and tasks are not inert — the scheduler reads them back and runs their prompts.
  ([#35](https://github.com/maneja81/OpenOrbit/pull/35))
- Dependency updates for `tmp` (path traversal, high; symlink arbitrary write,
  low), `fast-csv` (denial of service, low), and `exceljs` 3.4.0 → 3.10.0.
  ([#5](https://github.com/maneja81/OpenOrbit/pull/5))

[Unreleased]: https://github.com/maneja81/OpenOrbit/compare/v0.1.3...develop
[0.1.3]: https://github.com/maneja81/OpenOrbit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/maneja81/OpenOrbit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/maneja81/OpenOrbit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/maneja81/OpenOrbit/releases/tag/v0.1.0
