# Project Instructions

Use live code evidence before planning or editing. Make the smallest safe change. Preserve existing behavior unless the user explicitly asks to change it.

## Context

OpenOrbit — a desktop app that runs a team of AI agents locally, with a central orchestrator delegating to specialist sub-agents, each with its own tools and access to the user's files, apps, and Google account.

**Status:** released (v0.1.0) and under active development on `develop`. ~290 source files across an Electron main process, a preload bridge, and a React renderer.

Four built-in sub-agents ship seeded from `electron/main/ai/defaultAgents.json`: Cipher (`configAgent`), Atlas (`knowledgeAgent`), Explorer (`explorerAgent`), Chrono (`taskAgent`). The orchestrator ("Orbit") is singular, not an `agents` row, and is configured from its own prompt file plus settings.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5, strict, ESM (`"type": "module"`) |
| Shell | Electron 43 |
| Build | electron-vite 5 (main / preload / renderer) + Vite 7 |
| Renderer | React 19 + framer-motion, react-markdown, driver.js |
| Orchestration | `@openai/agents` SDK + `openai` client |
| Persistence | better-sqlite3 (WAL, foreign keys on) |
| Validation | zod 4 |
| Test | vitest 4 + jsdom + @testing-library/react |
| Lint | eslint 9 (flat config) + typescript-eslint |
| Packaging | electron-builder (no config file yet — defaults only) |

## Project Structure

```
/
  index.html                  — renderer HTML entry (Vite root)
  electron.vite.config.ts     — main / preload / renderer builds; injects release defines
  vite.config.ts              — renderer-only web build (npm run dev:web)
  vitest.config.ts            — jsdom, @ alias, release-define stubs, exclusions
  tsconfig.json               — project refs → tsconfig.node.json + tsconfig.web.json
  eslint.config.mjs
  electron/
    main/
      index.ts                — bootstrap: CSP, userData migration, IPC registration, window
      appDirs.ts              — app-owned userData dirs + legacy-root migration
      csp.ts, devLog.ts
      ai/                     — agents.ts, provider.ts, mcp.ts, webSearchDaemon.ts,
                                approvalPolicy.ts, httpTools.ts, documentExtract.ts,
                                skillDistill.ts, userInfoStore.ts, xlsWorker.ts
        prompts/*.md          — orchestrator + built-in sub-agent system prompts
        tools/                — per-agent tool sets (task, knowledge, explorer, folder, …)
        defaultAgents.json    — seed rows for the four built-in agents
      db/                     — index.ts (bootstrap), migrations.ts, one store per table
      ipc/                    — one module per surface, each exporting register*Handlers()
      connectors/             — Google OAuth: account, Gmail, Calendar, Drive, Contacts
      security/               — secretStorage.ts (AES-256-GCM), externalUrl.ts
      net/urlSafety.ts        — SSRF/private-host guards for user-authored HTTP tools
      tasks/scheduler.ts      — recurring + one-shot task runner
      github/skillSearch.ts
    preload/index.ts          — contextBridge surface exposed to the renderer
  src/                        — React renderer
    main.tsx                  — root render (ErrorBoundary → AgentsApp)
    components/               — atoms / molecules / organisms
    hooks/                    — one hook per feature surface
    lib/                      — pure helpers, each with a colocated .test.ts
    vendor/tabler-icons/      — bundled icon webfont
    globals.css
  scripts/releaseInfo.ts      — build-time release metadata (no runtime network call)
  public/                     — audio, video, favicon
  dist-electron/              — build output (untracked)
  wiki/                       — GitHub wiki, separate repo cloned locally (gitignored)
  0-cowork/                   — agent working state (gitignored)
```

## Key Entry Points

- **Main process**: `electron/main/index.ts` — every `register*Handlers()` call is wired here
- **Preload bridge**: `electron/preload/index.ts` — the only channel the renderer may use
- **Renderer**: `index.html` → `src/main.tsx` → `src/components/organisms/AgentsApp.tsx`
- **Schema**: `electron/main/db/migrations.ts` — append-only, ledger-based
- **DB bootstrap**: `electron/main/db/index.ts` — `getDb()`, WAL, FK pragma, legacy renames
- **Agents**: `electron/main/ai/agents.ts` + `ai/defaultAgents.json` + `ai/prompts/*.md`
- **Providers**: `electron/main/ai/providers.ts` is the registry (id, label, base URL, default model, which HTTP surface it answers on, whether it can serve voice), mirrored in `src/lib/providers.ts` with `providersParity.test.ts` holding the two in step. Credentials live one row per provider in the `providers` table (`db/providersStore.ts`), keyed by registry id — not per agent, so one key serves every agent pointed at it. `ai/selectProvider.ts` is the single operation that moves the Chat slot: credentials, the slot, and the models of every agent that follows it change together, because doing them separately leaves agents naming a model the new host has never heard of.
- **Provider/credentials (per-slot)**: `electron/main/ai/provider.ts` — chat and voice slots
- **App storage**: `electron/main/appDirs.ts` — every app-owned userData directory

## Build & Run

- **Dev**: `npm run dev` (electron-vite; renderer on `PORT`, default 3100)
- **Dev, renderer only in a browser**: `npm run dev:web`
- **Build**: `npm run build` (`tsc -b && electron-vite build`) · **Package**: `npm run package`
- **Test**: `npm test` (`vitest run`) · watch: `npm run test:watch`
- **E2E test** (real Electron app via Playwright, sandboxed `--user-data-dir`): `npm run test:e2e:local` (needs `.env.test`) · isolated worktree runner: `npm run test:e2e`. See `## E2E Tests` for when to add one and the shared helper conventions.
- **Lint**: `npm run lint`
- **Drive the running app** (screenshots, clicking through the UI, confirming a change works for real rather than only in vitest): the `run-openorbit` skill — `.claude/skills/run-openorbit/SKILL.md`, a Playwright REPL over the built app.
- ⚠ **Never launch the app from a worktree without `--user-data-dir`.** `app.getPath("userData")` resolves to the same `~/Library/Application Support/OpenOrbit` from *every* checkout and worktree, so an exploratory launch writes into the real database — settings, chat history, agents, encrypted API keys. The `run-openorbit` driver sandboxes it and aborts if the isolation doesn't take; use it rather than launching by hand.
- **Env required**: none at runtime. Credentials are entered in-app and stored encrypted in SQLite — one row per provider in the `providers` table, with the pre-registry `appSettings.chatApiKey`/`chatApiUrl` pair still read when `chatProviderId` is `""` so installs predating the registry keep working (`ai/provider.ts`), per-connector OAuth client id/secret in the `connectors` table (`connectors/registry.ts`, migration 26). Optional at build time: `GITHUB_RELEASE_REPO` (`scripts/releaseInfo.ts`); `PORT` overrides the dev renderer port.

## Providers — things that bite

- **`@openai/agents` defaults to the Responses API** (`DEFAULT_OPENAI_API = 'responses'`), and the app only calls `setOpenAIAPI` from `configureChatClient`. OpenAI and OpenRouter serve `/responses`; **Anthropic's compatible surface 404s it and Ollama has no such endpoint**, so those run through `OpenAIChatCompletionsModel` instead. That is what the registry's `api` field decides.
- **An agent inheriting the Chat slot gets a plain model-id string**, which resolves through the process-wide default client. Only an agent pinned to its own provider gets a `Model` instance. Keep it that way — returning a `Model` for the inherited case re-routes every agent in the app.
- **A pinned provider that cannot be resolved falls back to the Chat slot and logs**, rather than throwing. `buildOrchestrator` constructs every agent before a run starts, so throwing there fails the whole app over one misconfigured agent that the run may not even involve.
- **Anthropic's `/v1/models` rejects a bearer token** (401) and wants `x-api-key` + `anthropic-version`, even though chat traffic through the same host accepts one. That is the only reason `modelsAuth` exists.
- **Model ids are not all `vendor/model`.** OpenRouter uses a leading `~` for floating aliases (`~deepseek/deepseek-v4-flash-latest`); Ollama uses `name:tag` with no vendor at all (`llama3.2:3b`). `MODEL_ID_PATTERN` admits both — it was written for `vendor/model` and silently refused each of them in turn.
- **Only OpenAI serves `/audio/*`.** Voice *output* falls back to the browser's own speech synthesis so it works everywhere; voice *input* has no fallback, which is why onboarding switches it off when the chosen provider cannot transcribe.
- **`selectChatProvider` writes with `setSetting`**, bypassing the `settings:update` handler — so `ipc/providers.ts` broadcasts afterwards. Without it the Settings panel renders the previous provider while the app already runs on the new one.
- **The static price table covers shipped defaults only.** OpenRouter reports a real billed figure from its own API, a local model is free, and everything else shows tokens with no price rather than a guess.
- **`chatProviderId` / `voiceProviderId` / an agent's `provider_id` are not agent-writable.** Choosing a provider chooses the host a key is sent to, the same exposure that keeps `chatApiUrl` out of ConfigAgent's reach.

## Worktrees

- ⚠ **Branch every new worktree from `develop`.** `develop` is the default working branch and is always ahead of `main` — `main` only moves at a release cut or hotfix, so a worktree cut from `main` (or from whatever HEAD happened to be) is missing whatever has merged into `develop` since the last release, reading as stale or feature-incomplete. This has now misled four separate sessions, including one that skipped `main`'s old idea-phase commit entirely and instead branched from a `main`-based release-sync merge that was itself several PRs behind `develop`.

  ```bash
  git worktree add -b <branch> .claude/worktrees/<name> develop
  ```

- **Check the base before trusting an existing worktree** — one command, before reading anything into its contents:

  ```bash
  git log --oneline <branch> ^develop     # empty = no unique commits, safe to reset onto develop
  git merge-base develop <branch>         # should be develop's tip or an ancestor of it
  ```

  Recovery, when the tree is clean and nothing unique is on the branch: `git fetch origin && git reset --hard origin/develop`.

- **`node_modules` and `dist-electron/` are per-worktree** and untracked — a fresh worktree needs its own install (see the Electron caveat below). `0-cowork/`, `MEMORY.md` and `.env` are gitignored and exist **only in the main checkout** at `/Users/mohitaneja/Projects/OpenOrbit`; write shared plans, fixes and memory to that absolute path or the workspace silently forks.

## Branching & Releases

- **`develop` is where all work happens — feature PRs, fixes, chores, docs — every time, no exceptions.** `main` tracks the released, stable line and moves only at a release cut (fast-forwarded to `develop`'s tip) or for a hotfix.
- **Hotfixing a released version:** branch off `main` (not `develop`), fix, verify gate, PR *into `main`*. Once merged, **immediately** bring the same fix into `develop` too (cherry-pick the hotfix commit, or merge `main` into `develop` — whichever is cleaner for that fix) so the next release cut from `develop` doesn't silently regress it. A hotfix that only lands on `main` is a fix that vanishes the next time `main` is fast-forwarded to `develop`.
- **Cutting a release:** finalize the CHANGELOG entry on `develop` first (dated header, corrected compare-link) via the normal PR flow, fast-forward `main` to `develop`'s new tip, then tag `vX.Y.Z` on `main`. `package.json`'s `version` field must match the tag exactly — `.github/workflows/release.yml` checks this and fails the build otherwise. The release workflow triggers on any `v*` tag push regardless of branch, but tagging from `main` keeps the tagged commit and the stable branch pointer identical.

## Verify Gate

- **Run all four, every time, before reporting work done** — a green vitest run alone is not validation:

  ```bash
  npx eslint src electron     # exit 0
  npx tsc -b                  # exit 0
  npm run build               # exit 0
  npm test                    # all pass
  ```

- **eslint and `tsc -b` print nothing when they pass**, so "no output" proves nothing on its own — check the exit code. Capture `$?` on its own line: `${PIPESTATUS[0]}` is bash-only and expands to an empty string under zsh, which renders as `lint exit:` and reads exactly like success.
- **Green baseline — `a2fa46f`, verified 2026-08-03: 106 test files / 1070 tests**, eslint 0, `tsc -b` 0, build 0. A materially *lower* test count almost always means a broken Electron binary rather than a removed test — see below.
- ⚠ **`npm ci` in a fresh worktree regularly leaves Electron unusable while still exiting 0.** Two observed variants: no binary at all (`node_modules/electron/dist` and `path.txt` both absent), or a half-extracted app (`failed to create directory …/Electron.app/Contents/Resources/kn.lproj: File exists`). Either way `electron/main/ai/agents.test.ts` — **45 tests** — fails with "Electron failed to install correctly" or disappears from the run. It reads as one broken suite; it is ~4% of the suite. Verify and repair:

  ```bash
  ls node_modules/electron/path.txt node_modules/electron/dist    # both must exist
  rm -rf node_modules/electron/dist node_modules/electron/path.txt && node node_modules/electron/install.js
  ```

## E2E Tests

- **When a change adds or materially alters a UI surface — a Settings tab, a widget, a modal, the chat flow — add or extend a Playwright spec under `e2e/` alongside it, not as separate follow-up work.** Not every change needs one (a copy tweak or a pure-logic refactor with vitest coverage doesn't), but a new interactive surface without one should be the exception, called out explicitly, not the silent default. `0-cowork/plans/active/e2e-full-coverage.md` (or its successor once that roadmap is fully shipped) tracks what's covered and what's deliberately deferred and why — check it before assuming a surface has no coverage.
- **Reuse `e2e/helpers.ts` before writing new DOM plumbing.** `launchSandboxedApp`/`launchApp`/`completeOnboarding` for setup; `clickSelector`/`clickByText`/`typeIntoField`/`typeIntoNth`/`typeIntoLabeledRow`/`clickInLabeledRow` for interaction (all click via `page.evaluate()`, never a locator click — this app's continuous framer-motion animation times out `page.click()` as "element is not stable"); `pickCombobox`/`selectComboboxOption` for the app's custom dropdown and `SlashCommandMenu` (both select on **mousedown**, not click); `confirmTypeToDelete` for the shared type-DELETE modal; `openDb`/`pollUntil` to assert against the sandboxed SQLite DB rather than fragile DOM text.
- **Assert against the DB or a stable DOM signal, never exact text from a live model.** Any spec touching a real AI provider call (see `e2e/chat-flow.spec.ts`) must poll for structural facts (a new `messages` row exists, has non-empty text, has a `trace_id`) — a live model's wording isn't something a test controls.
- **Settings text/number fields commit onBlur, not per keystroke** — `typeIntoField`/`typeIntoNth` focus the element first for exactly this reason; a blur without a real prior focus is a no-op.
- **A hook that only fetches once on mount** (`useTasks`, `useConnectors`, others like them) **needs its update broadcast fired manually** after a direct DB seed, or the UI never reflects the seeded state — see `connectors-disconnect.spec.ts` firing `connectors:update` via `app.evaluate`.
- **Cost- and network-aware by design, not by accident.** `e2e/providerConfig.ts`'s `resolveE2EProvider()` decides which AI provider a spec's onboarding uses — set `E2E_PROVIDER=openrouter` in `.env.test` for cheap-model runs; unset or `openai` bills against `gpt-4.1-mini`. Live-network specs (registry search, knowledge-base URL discovery, the About tab's release check) are fine to write, but say so in a comment — don't let a spec's real external dependency read as a local one.
- **Not part of the mandatory four-command Verify Gate below.** `npm run test:e2e:local` needs a build, a real `.env.test`, and for `chat-flow.spec.ts` specifically, real money — run it deliberately when a spec is added or a UI surface it covers changes, not on every commit.
- **Some flows are deliberately out of scope, not silently skipped — name the reason when one is.** Native OS file/save dialogs need `app.evaluate` to stub Electron's `dialog` module (see `agents-tab.spec.ts`'s export/import); a live OAuth consent screen opens the real system browser via `shell.openExternal`, entirely outside Playwright's `_electron` control surface, and needs either a dedicated test account with real browser automation or a human-in-the-loop step — neither attempted as of this writing (`connectors-disconnect.spec.ts` only covers `disconnect`).

## Conventions

- TypeScript strict throughout, two project refs: `tsconfig.node.json` (electron/, scripts/, configs) and `tsconfig.web.json` (src/). `@/*` → `./src`, aliased in both electron-vite and vitest.
- Tests are colocated `*.test.ts(x)` beside the file under test — no separate test tree.
- IPC: one module per surface in `electron/main/ipc/`, each exporting `register*Handlers()`, all invoked from `main/index.ts`. The renderer never touches `ipcRenderer` — it goes through the preload `contextBridge` API.
- Renderer follows atomic structure (atoms → molecules → organisms), with `hooks/` per feature surface and `lib/` for pure helpers.
- Schema changes are append-only entries in `db/migrations.ts`, keyed `id: "YYYYMMDDHHMMSS"`. Never edit a shipped migration; never reuse a numeric version (33 and 34 are permanently reserved).
- Secrets are encrypted via `security/secretStorage.ts` (`nodeCrypto:` prefix) before they reach the DB — API keys, `mcp_servers.env` values, connector credentials and settings.
- Electron hardening: `contextIsolation` on, `nodeIntegration` off, `sandbox` on, CSP applied to the default session before the first load, `window.open` filtered through `security/externalUrl.ts`.
- Comments carry non-obvious *why* — constraints, prior incidents, rejected alternatives. Dense rationale comments are the house style; restating code is not.
- Icons are Tabler webfont class strings (e.g. `"ti-robot"`) — there is no per-service image icon system.
- Per-agent attachment, never global: MCP servers, connectors, and HTTP tool collections are all attached to individual agents via JSON id arrays on the `agents` row.
- Everything local: chat history, memory, knowledge, and tasks live in SQLite under Electron's `userData`.
- Bring-your-own API key against any OpenAI-compatible host. Four providers ship as choices — OpenRouter, OpenAI, Claude (Anthropic's OpenAI-compatible surface) and Local AI (Ollama or similar) — picked during onboarding and changeable per agent in Settings → Agents.

## Design & Planning Rules

1. Never plan, defer, exclude, simplify, or mark anything "not needed" without first checking the relevant live source files.

2. Never invent, replace, or shrink schema. Inspect existing migrations, models, validators, `types.ts`, API contracts, and mappings first, then extend the current shape.

3. Never assume subsystem behavior such as sync, cache, Redis, auth, jobs, storage, state, permissions, routing, billing, or import/export. Inspect the implementation before describing or changing it.

4. Every assumption must become one of:
   - verified code evidence
   - a specific clarification question
   - an explicit unresolved risk

5. Existing behavior found in live code must be preserved and included in the plan unless code proves it obsolete or the user explicitly asks to remove it.

6. Any plan without file-level evidence is invalid and must not be treated as actionable.

## Required Plan Format

Every implementation plan must include:

### Code Evidence Checked
List the files, functions, routes, components, schemas, migrations, validators, tests, or configs inspected.

### Confirmed Existing Behavior
State what the checked code currently does.

### Proposed Change
Describe the smallest safe change that solves the confirmed problem.

### Risks / Unknowns
List anything not verified, unclear, environment-dependent, or outside the inspected scope.

### Not Deferred
Confirm that no required behavior, field, branch, route, migration, test, or edge case was skipped without evidence.

## Working Style

Don't present a menu of next steps and ask the user to choose. Identify the highest-priority, highest-impact next step, recommend it with brief reasoning, then list subsequent steps in order. Make the recommendation — don't outsource the decision.

## Communication Style

Be direct. Sound like a senior engineer, not a language model.

**Be direct and specific:**
- State findings plainly — "this can be nil" not "there may be a potential null reference issue"
- Reference exact locations — `file:line`, function name, variable name
- State opinions as opinions — "I don't think this is right" not "it might be worth considering whether"
- Skip pleasantries — no "great question", "hope this helps", "let me know if you have questions"
- Question design decisions bluntly — "why do we need this?", "is this necessary?"

**Language patterns to avoid:**
- Filler: "It's important to note", "It's worth mentioning", "In order to" (→ "to"), "That being said", "Moving forward"
- Overused words: "leverage" → "use", "utilize" → "use", "facilitate" → "help", "ensure" → "make sure", "robust" → "solid", "comprehensive" → "full", "seamless" → skip, "enhance" → "improve"
- Hedging: "I think maybe we could consider" → state the opinion; "It would seem that" → state the fact
- Padding: "Furthermore", "Additionally", "Moreover", "In conclusion" → drop or use "also"
- Meta-commentary: "This approach works by..." → just describe it; "The benefit of this is..." → state the benefit directly

## Development Execution Rules

1. Stay on the requested task only. Do not refactor, redesign, rename, reformat, optimize, or touch unrelated code unless explicitly required.

2. Before editing, identify the exact affected files, functions, routes, components, schemas, and tests.

3. Keep changes limited to the confirmed scope.

4. Make the smallest safe change that solves the confirmed problem while preserving existing behavior.

5. Follow existing project patterns for naming, structure, formatting, validation, logging, errors, tests, and architecture.

6. Do not introduce new patterns, dependencies, APIs, files, environment variables, or requirements unless the task requires them.

7. Prefer small diffs over rewrites.

8. Handle errors where the existing code expects them to be handled.

9. Add or update tests when behavior changes — including a Playwright spec under `e2e/` when the change touches a UI surface (see `## E2E Tests`), not just vitest coverage for the underlying logic.

10. Do not weaken, delete, skip, or bypass tests to make the build pass.

11. Do not remove code, fields, branches, tests, routes, feature flags, migrations, or edge-case handling unless proven unused or explicitly requested.

12. Do not add comments that restate the code. Add comments only when they explain non-obvious intent, constraints, or tradeoffs.

13. Do not over-engineer abstractions for one use case.

14. Explain tradeoffs only when they affect the implementation.

15. Do not use placeholder code, fake package names, imaginary methods, invented APIs, or guessed file paths.

16. If implementation reveals new scope, stop and report it as `Scope Discovered`. Do not expand the task silently.

17. Do not "clean up while here." Cleanup must be directly required for the task or separately requested.

18. After changes, verify affected imports, types, call paths, tests, and runtime behavior.

## Quick Checks

Before returning code, confirm:

- Relevant files were inspected before planning or editing.
- Existing behavior was identified and preserved.
- Public APIs, schemas, routes, migrations, and contracts were preserved unless intentionally changed.
- The diff is limited to the requested task.
- No unrelated refactor, rename, reformat, redesign, or optimization slipped in.
- Imports, types, call paths, and runtime paths were checked.
- Error handling follows the existing project pattern.
- Tests were added or updated for intentional behavior changes.
- No tests were weakened, deleted, skipped, or bypassed.
- No placeholder code, fake package names, imaginary methods, guessed files, or invented requirements were introduced.
- Anything not verified was reported as a risk or clarification question.

## Output Rules

Every final response after implementation must include:

### Changed Files
List each changed file and what changed.

### Behavior Changed
Describe the user-visible or system behavior that changed.

### Behavior Preserved
Call out important existing behavior that remains intact.

### Verification Run
List commands, tests, type checks, lint checks, builds, or manual checks run.

### Verification Not Run
List anything not run and why.

### Risks / Follow-up
Mention only real risks, unresolved unknowns, or follow-up work discovered during implementation.

## Notes
- Generated by cb-setup on 2026-07-30 — review and edit to add project-specific rules
- Context / Tech Stack / Project Structure / Key Entry Points / Build & Run / Conventions refreshed from live code on 2026-08-02. Everything below `## Design & Planning Rules` is unchanged.
