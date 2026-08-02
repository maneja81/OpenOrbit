# Project Instructions

Use live code evidence before planning or editing. Make the smallest safe change. Preserve existing behavior unless the user explicitly asks to change it.

## Context

OpenOrbit — a desktop app that runs a team of AI agents locally, with a central orchestrator delegating to specialist sub-agents, each with its own tools and access to the user's files, apps, and Google account.

**Status:** implemented and under active development on `develop-ai`. ~290 source files across an Electron main process, a preload bridge, and a React renderer. The source tree is currently untracked in git (only `README.md`, `LICENSE`, `.gitignore`, and this file are committed) — `README.md` still describes the project as "idea phase" and is stale.

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
- **Provider/credentials**: `electron/main/ai/provider.ts` — chat and voice slots
- **App storage**: `electron/main/appDirs.ts` — every app-owned userData directory

## Build & Run

- **Dev**: `npm run dev` (electron-vite; renderer on `PORT`, default 3100)
- **Dev, renderer only in a browser**: `npm run dev:web`
- **Build**: `npm run build` (`tsc -b && electron-vite build`) · **Package**: `npm run package`
- **Test**: `npm test` (`vitest run`) · watch: `npm run test:watch`
- **Lint**: `npm run lint`
- **Drive the running app** (screenshots, clicking through the UI, confirming a change works for real rather than only in vitest): the `run-openorbit` skill — `.claude/skills/run-openorbit/SKILL.md`, a Playwright REPL over the built app.
- ⚠ **Never launch the app from a worktree without `--user-data-dir`.** `app.getPath("userData")` resolves to the same `~/Library/Application Support/OpenOrbit` from *every* checkout and worktree, so an exploratory launch writes into the real database — settings, chat history, agents, encrypted API keys. The `run-openorbit` driver sandboxes it and aborts if the isolation doesn't take; use it rather than launching by hand.
- **Env required**: none at runtime. Credentials are entered in-app and stored encrypted in SQLite — chat/voice API key + base URL under `appSettings.*` (`ai/provider.ts`), per-connector OAuth client id/secret in the `connectors` table (`connectors/registry.ts`, migration 26). Optional at build time: `GITHUB_RELEASE_REPO` (`scripts/releaseInfo.ts`); `PORT` overrides the dev renderer port.

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
- Bring-your-own API key against any OpenAI-compatible host (OpenAI by default; OpenRouter and Ollama both supported paths).

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

9. Add or update tests when behavior changes.

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
