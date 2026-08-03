# Changelog

All notable changes to OpenOrbit are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

Everything below is the work leading up to the first release. Nothing has been
tagged or published yet, and there are no packaged downloads — running OpenOrbit
means [building from source](README.md#build-and-run).

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

[0.1.0]: https://github.com/maneja81/OpenOrbit/commits/develop
