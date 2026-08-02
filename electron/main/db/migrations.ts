/**
 * Schema migrations.
 *
 * **Adding one: use `id: "YYYYMMDDHHMMSS"` (the current UTC timestamp), not the next number.**
 *
 * Which migrations have run is recorded in the `schema_migrations` table, keyed by id — not by a
 * `PRAGMA user_version` high-water mark, which failed in two ways once more than one branch was in
 * flight against the same real database (every worktree of this repo shares one):
 *
 *  - Two branches picked the same next number. The database ran one of them, so the other was
 *    filtered out by `version > user_version` and never ran — leaving a half-applied schema that
 *    only surfaced when a query hit the missing column at runtime.
 *  - Worse and quieter: once the database advanced past a number, a migration carrying it became
 *    unreachable *forever* there, because nothing ever moves the mark back.
 *
 * A ledger selects by absence, so a migration runs whenever it first appears regardless of order,
 * and timestamp ids make two branches colliding effectively impossible. `user_version` is still
 * maintained as the highest applied numeric version, purely so reverting to the old runner works.
 *
 * The existing numeric entries stay numeric — they are already recorded as applied on real
 * databases under their padded ids, so renumbering them would re-run them.
 *
 * This module is deliberately free of runtime imports; see MigrationContext below.
 */
import type Database from "better-sqlite3";

/**
 * Filesystem paths a migration needs but must not resolve itself. This module is
 * deliberately free of runtime imports — several tests and the Danger Zone reset call
 * `runMigrations` against a bare in-memory database with no Electron app available, so
 * importing appDirs (and through it `electron`) here would break them. Callers that have
 * a real userData root supply these; everyone else omits them and the path-rewrite
 * migration correctly does nothing.
 */
export interface MigrationContext {
  /** Absolute path to the current knowledge-files directory. */
  knowledgeFilesDir?: string;
  /** The same directory under each userData root the app used before its current name. */
  legacyKnowledgeFilesDirs?: string[];
}

/**
 * A migration is identified by either a legacy sequential `version` or a timestamp `id` — never
 * both, so there is exactly one canonical key per entry.
 *
 * New migrations must use `id: "YYYYMMDDHHMMSS"`. Sequential numbers are unsafe here because every
 * worktree of this repo runs against the *same* real database: two branches routinely picked the
 * same next number, and whichever ran second was silently skipped forever (see canonicalId and
 * bootstrapLedger below). The existing numeric entries are kept as-is — renumbering them would
 * change keys that are already recorded as applied on real databases.
 */
type Migration = { version: number; id?: undefined; up: MigrationUp } | { id: string; version?: undefined; up: MigrationUp };

type MigrationUp = (db: Database.Database, context: MigrationContext) => void;

/** Width of a YYYYMMDDHHMMSS id. Legacy numeric versions are zero-padded to the same width so the
 * two forms sort correctly against each other as text — unpadded, "9" would sort after
 * "20260801014800" and run a legacy migration last. */
const MIGRATION_ID_WIDTH = 14;

function canonicalId(migration: Migration): string {
  return migration.id !== undefined ? migration.id : String(migration.version).padStart(MIGRATION_ID_WIDTH, "0");
}

/**
 * Re-points `knowledge_files.path` rows from a previous userData root at the current one.
 *
 * These rows store absolute paths (see ipc/knowledgeBase.ts `copyIntoStorage`), so moving
 * the app's storage after a rename leaves every one of them pointing at the old location —
 * which makes `fs:openPath` refuse them (it only allows paths inside the *current*
 * knowledge-files directory) and stops sync from reading the file.
 *
 * Prefixes are matched exactly, separator included, so a sibling like
 * `knowledge-files-backup` can never be caught by the `knowledge-files` prefix. Rows
 * already under the current root, and rows pointing anywhere else, are left untouched.
 */
export function rewriteKnowledgeFilePaths(
  db: Database.Database,
  knowledgeFilesDir: string,
  legacyKnowledgeFilesDirs: string[],
  separator = "/"
): number {
  const replacement = knowledgeFilesDir.endsWith(separator) ? knowledgeFilesDir : knowledgeFilesDir + separator;
  let rewritten = 0;
  for (const legacyDir of legacyKnowledgeFilesDirs) {
    const prefix = legacyDir.endsWith(separator) ? legacyDir : legacyDir + separator;
    if (prefix === replacement) continue;
    const result = db
      .prepare("UPDATE knowledge_files SET path = ? || substr(path, ?) WHERE substr(path, 1, ?) = ?")
      .run(replacement, prefix.length + 1, prefix.length, prefix);
    rewritten += result.changes;
  }
  return rewritten;
}

/** Column presence check for migrations that must be safe to re-run. Only needed by entries whose
 * numeric predecessor already ran on a real database — see the two http-tools migrations below. */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).some((c) => c.name === column);
}

/**
 * Append new entries here to evolve the schema — never edit an already-shipped migration.
 * `conversations` exists from day one even though the UI only ever shows one thread today,
 * so a future multi-conversation feature doesn't need a data migration to retrofit the FK.
 */
const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          agent_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);

        CREATE TABLE memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT,
          kind TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_memory_agent_id ON memory(agent_id);
      `);
    },
  },
  {
    version: 2,
    up: (db) => {
      // Single KV table for all app settings — replaces electron-store entirely
      // (both allowedRoots and the AI-related settings). setting_value holds
      // JSON.stringify'd content so it can store any JSON-serializable type.
      db.exec(`
        CREATE TABLE settings (
          setting_name TEXT PRIMARY KEY,
          setting_value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 3,
    up: (db) => {
      // Delegate-able sub-agents users can create (Alex, the orchestrator, is not a row
      // here — it's the singular hub, configured separately from its own prompt file).
      // Schema only; seeding (e.g. the built-in "setup" agent) happens at app-init time
      // once the prompt .md files exist, not baked into this migration.
      db.exec(`
        CREATE TABLE agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          prompt TEXT NOT NULL,
          model TEXT NOT NULL,
          tools TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 4,
    up: (db) => {
      // Orbit UI renders one icon per node — discovered missing when wiring the dynamic
      // agent list up to the existing icon-per-node UI.
      db.exec(`ALTER TABLE agents ADD COLUMN icon TEXT NOT NULL DEFAULT 'ti-robot';`);
    },
  },
  {
    version: 5,
    up: (db) => {
      // Settings → AI tab lets each agent be toggled off without deleting it — disabled
      // agents are excluded from the orchestrator's handoffs and from the orbit UI.
      db.exec(`ALTER TABLE agents ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;`);
    },
  },
  {
    version: 6,
    up: (db) => {
      // The app's default model changed from "anthropic/claude-3.5-sonnet" (which
      // started 404ing — no endpoints found for it on OpenRouter) to
      // "openai/gpt-4.1-mini". Installs that seeded Setup's row before this change
      // have the old literal baked into that row permanently (seeding only ever runs
      // once) — rewrite it here rather than leaving existing users stuck on a dead model.
      db.prepare("UPDATE agents SET model = ? WHERE model = ?").run(
        "openai/gpt-4.1-mini",
        "anthropic/claude-3.5-sonnet"
      );
      db.prepare("UPDATE settings SET setting_value = ? WHERE setting_name = ? AND setting_value = ?").run(
        JSON.stringify("openai/gpt-4.1-mini"),
        "appSettings.alexModel",
        JSON.stringify("anthropic/claude-3.5-sonnet")
      );
    },
  },
  {
    version: 7,
    up: (db) => {
      // Orbit UI shows a short tagline (2-3 words) below each sub-agent's name.
      // Stored per-agent so it can be edited in Settings → AI without a code change.
      db.exec(`ALTER TABLE agents ADD COLUMN tagline TEXT NOT NULL DEFAULT '';`);
      // Seed the built-in Setup agent's tagline — seeding only ever runs once, so
      // new installs won't pick this up from the seed call; we set it here instead.
      db.prepare("UPDATE agents SET tagline = ? WHERE id = ?").run("Configuration & Settings", "setup");
    },
  },
  {
    version: 8,
    up: (db) => {
      // Rename the built-in setup agent from "Setup" to "Forge". Seeding only runs once
      // so existing installs keep the old name without this migration.
      db.prepare("UPDATE agents SET name = ? WHERE id = ? AND name = ?").run("Forge", "setup", "Setup");
    },
  },
  {
    version: 9,
    up: (db) => {
      // Knowledge base — stores .md files ingested by the user for Lore to reference.
      // Content is capped at 100 KB in the IPC handler; path is UNIQUE so re-adding the
      // same file is an upsert (refresh) rather than a duplicate row.
      db.exec(`
        CREATE TABLE knowledge_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          path TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          synced_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_knowledge_files_path ON knowledge_files(path);
      `);
    },
  },
  {
    version: 10,
    up: (db) => {
      // Rename the built-in vault agent to "Lore" and set its tagline.
      // Name check prevents double-applying on fresh installs where the seed already
      // uses the new name from defaultAgents.json.
      db.prepare("UPDATE agents SET name = ?, tagline = ? WHERE id = ? AND name = ?").run(
        "Lore",
        "Knowledge & Memory",
        "vault",
        "Vault"
      );
      // Also ensure any install that already had the old default tagline is updated.
      db.prepare("UPDATE agents SET tagline = ? WHERE id = ? AND tagline = ?").run(
        "Knowledge & Memory",
        "vault",
        ""
      );
    },
  },
  {
    version: 11,
    up: (db) => {
      // One row per underlying LLM call (a single agent:run can span multiple calls when
      // the orchestrator hands off to a sub-agent using a different model). cost_usd starts
      // NULL and is filled in best-effort from OpenRouter's /generation endpoint after the
      // row is inserted, so a slow/failed cost lookup never blocks logging the call itself.
      db.exec(`
        CREATE TABLE token_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          agent_id TEXT,
          model TEXT NOT NULL,
          trace_id TEXT,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          cost_usd REAL,
          generation_id TEXT
        );
        CREATE INDEX idx_token_usage_created_at ON token_usage(created_at);
        CREATE INDEX idx_token_usage_model ON token_usage(model);
      `);
    },
  },
  {
    version: 12,
    up: (db) => {
      // Replaces the hardcoded BUILT_IN_AGENT_IDS id-list check: system agents (Forge,
      // Lore) can't be disabled or removed, but their name/tagline/prompt are editable
      // like any other agent — it's a data flag now, not an id allowlist in code.
      db.exec(`ALTER TABLE agents ADD COLUMN system INTEGER NOT NULL DEFAULT 0;`);
      db.prepare("UPDATE agents SET system = 1 WHERE id IN ('setup', 'vault')").run();
    },
  },
  {
    version: 13,
    up: (db) => {
      // Rename built-in agent ids away from user-facing display words: 'setup'→'configAgent',
      // 'vault'→'knowledgeAgent'. messages/token_usage/memory.agent_id store the agent's
      // *name*, not its id (see electron/main/ipc/agent.ts), so no historical rows reference
      // these ids and none need updating here.
      db.prepare("UPDATE agents SET id = 'configAgent' WHERE id = 'setup'").run();
      db.prepare("UPDATE agents SET id = 'knowledgeAgent' WHERE id = 'vault'").run();

      // Conditional renames, same pattern as v8/v10: only overwrite if still at the prior
      // default, so a user's own custom name/tagline is never clobbered.
      db.prepare("UPDATE agents SET name = ? WHERE id = ? AND name = ?").run("Cipher", "configAgent", "Forge");
      db.prepare("UPDATE agents SET tagline = ? WHERE id = ? AND tagline = ?").run(
        "Build & Configure",
        "configAgent",
        "Configuration & Settings"
      );
      db.prepare("UPDATE agents SET name = ? WHERE id = ? AND name = ?").run("Atlas", "knowledgeAgent", "Lore");
      db.prepare("UPDATE agents SET tagline = ? WHERE id = ? AND tagline = ?").run(
        "Know & Reference",
        "knowledgeAgent",
        "Knowledge & Memory"
      );

      // Orchestrator's default display name, same conditional pattern applied to a
      // settings row instead of an agents row (matching v6's alexModel rename below).
      db.prepare("UPDATE settings SET setting_value = ? WHERE setting_name = ? AND setting_value = ?").run(
        JSON.stringify("Aixon"),
        "appSettings.agentName",
        JSON.stringify("Alex")
      );

      // Setting key rename: alexModel → orchestratorModel. alexEnabled has no equivalent
      // row (it's in settings.ts's LOCKED_KEYS, so settings:update always skips persisting
      // it — it only ever comes from the client-side default), so nothing to migrate there.
      db.prepare("UPDATE settings SET setting_name = ? WHERE setting_name = ?").run(
        "appSettings.orchestratorModel",
        "appSettings.alexModel"
      );
    },
  },
  {
    version: 14,
    up: (db) => {
      // Onboarding/Settings generalized from OpenRouter-specific wording to a generic
      // "AI Provider" (the app can point at any OpenAI-chat-completions-compatible host,
      // not just OpenRouter). Renames the stored key so an existing key carries over
      // losslessly; no new row needed for the (new, optional) aiProviderApiUrl setting.
      db.prepare("UPDATE settings SET setting_name = ? WHERE setting_name = ?").run(
        "appSettings.aiProviderApiKey",
        "appSettings.openRouterApiKey"
      );
    },
  },
  {
    version: 15,
    up: (db) => {
      // Longer free-text field distinct from the existing short "tagline" — lets each
      // agent (built-in or custom) carry a real description, editable in Settings → AI.
      db.exec(`ALTER TABLE agents ADD COLUMN description TEXT NOT NULL DEFAULT '';`);
    },
  },
  {
    version: 16,
    up: (db) => {
      // Knowledge base now supports pdf/docx/csv/txt in addition to .md, and copies the
      // source file into app-owned storage on add instead of only referencing the original
      // path (knowledgebase:remove can now delete the stored copy; moving/deleting the user's original
      // file no longer breaks the entry). `path` now holds the internal storage path.
      // Dev-only data, safe to clear rather than migrate the old reference-in-place rows.
      db.exec(`DELETE FROM knowledge_files;`);
      db.exec(`ALTER TABLE knowledge_files ADD COLUMN original_name TEXT NOT NULL DEFAULT '';`);
    },
  },
  {
    version: 17,
    up: (db) => {
      // AI-derived category for the file-management modal's filter tabs; defaults to
      // "Uncategorized" so existing rows and any categorization failure both land somewhere.
      db.exec(`ALTER TABLE knowledge_files ADD COLUMN category TEXT NOT NULL DEFAULT 'Uncategorized';`);
    },
  },
  {
    version: 18,
    up: (db) => {
      // Dedup check for knowledgebase:add: sha256 of the source file's raw bytes, so re-adding the
      // same file (same content, any filename/location) is rejected with a clear error
      // instead of silently creating another row. Not UNIQUE at the schema level — every
      // pre-existing row defaults to '' here, which a UNIQUE constraint would reject outright
      // on migrate; the dedup check itself is done in application code (addFile) instead.
      db.exec(`ALTER TABLE knowledge_files ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';`);
      db.exec(`CREATE INDEX idx_knowledge_files_content_hash ON knowledge_files(content_hash);`);
    },
  },
  {
    version: 19,
    up: (db) => {
      // Marks a knowledge_files row as sourced from a crawled URL rather than an
      // uploaded file — empty string (not NULL) for existing/file-sourced rows, so
      // `WHERE source_url = ?` and `NULLIF(source_url, '')` both work without a
      // NULL-handling special case anywhere else in the codebase.
      db.exec(`ALTER TABLE knowledge_files ADD COLUMN source_url TEXT NOT NULL DEFAULT '';`);
      db.exec(`CREATE INDEX idx_knowledge_files_source_url ON knowledge_files(source_url);`);
    },
  },
  {
    version: 20,
    up: (db) => {
      // MCP (Model Context Protocol) servers a user has configured — local stdio processes
      // only for now (command/args/env), not remote/HTTP servers. env holds encrypted
      // secret values (encryptSecret/decryptSecret, same as aiProviderApiKey), stored as a
      // JSON object string so an arbitrary number of env vars fit one column.
      db.exec(`
        CREATE TABLE mcp_servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          command TEXT NOT NULL,
          args TEXT NOT NULL DEFAULT '[]',
          env TEXT NOT NULL DEFAULT '{}',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // Per-agent attachment — deliberately not global, so a server isn't exposed to
      // every agent just because it's configured. JSON array of mcp_servers.id.
      db.exec(`ALTER TABLE agents ADD COLUMN mcp_server_ids TEXT NOT NULL DEFAULT '[]';`);
    },
  },
  {
    version: 21,
    up: (db) => {
      // v18's dedup check (SELECT content_hash then INSERT in addFile/addUrl) is only an
      // app-level guard — two concurrent knowledgebase:add calls can both pass the SELECT before either
      // INSERTs, producing duplicate rows. A partial unique index enforces it atomically at
      // the DB layer instead; partial (excluding '') so it doesn't reject pre-v18 legacy rows,
      // which all default to content_hash = ''.
      db.exec(
        `CREATE UNIQUE INDEX idx_knowledge_files_content_hash_unique ON knowledge_files(content_hash) WHERE content_hash != '';`
      );
    },
  },
  {
    version: 22,
    up: (db) => {
      // Oversized URL-sourced content is now split across multiple rows instead of
      // truncated (see knowledgeBase.ts's splitContent) — part_index/part_count group
      // the rows belonging to one logical fetch, sharing one source_url. 0/1 for every
      // pre-existing and every never-split row, so callers can treat "part_index = 0"
      // as "the whole thing, or the first/only part" with no NULL-handling special case.
      db.exec(`ALTER TABLE knowledge_files ADD COLUMN part_index INTEGER NOT NULL DEFAULT 0;`);
      db.exec(`ALTER TABLE knowledge_files ADD COLUMN part_count INTEGER NOT NULL DEFAULT 1;`);
    },
  },
  {
    version: 23,
    up: (db) => {
      // Settings split from one shared aiProviderApiKey/aiProviderApiUrl pair into two
      // independent credential slots — Chat (agents/tools) and Voice (transcription/TTS) —
      // so a user can point either at a different provider without affecting the other.
      // Existing installs get their prior single key/URL copied into both new slots
      // (already-encrypted value carries over as-is, same as v14's key rename) so nobody
      // has to re-enter anything; each slot is independently editable in Settings afterward.
      for (const suffix of ["ApiKey", "ApiUrl"]) {
        const row = db
          .prepare("SELECT setting_value FROM settings WHERE setting_name = ?")
          .get(`appSettings.aiProvider${suffix}`) as { setting_value: string } | undefined;
        if (!row) continue;
        for (const prefix of ["chat", "voice"]) {
          db.prepare(
            `INSERT INTO settings (setting_name, setting_value, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(setting_name) DO NOTHING`
          ).run(`appSettings.${prefix}${suffix}`, row.setting_value);
        }
      }
      db.prepare("DELETE FROM settings WHERE setting_name IN (?, ?)").run(
        "appSettings.aiProviderApiKey",
        "appSettings.aiProviderApiUrl"
      );
    },
  },
  {
    version: 24,
    up: (db) => {
      // Per-agent key/value data store — lets a custom agent (e.g. a user-created "budget
      // agent") persist and retrieve its own data across turns/conversations. Scoped by
      // agent_id (TEXT, matches agents.id) so one agent can never read another's rows.
      // FK + cascade so deleting an agent (deleteAgent in ai/agents.ts) doesn't leave
      // orphaned data behind silently.
      db.exec(`
        CREATE TABLE agent_data (
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (agent_id, key)
        );
      `);
    },
  },
  {
    version: 25,
    up: (db) => {
      // Third-party service connections ("connectors") a user has authorized — e.g. Gmail
      // via OAuth2. `credentials` holds an encrypted JSON blob (access/refresh token,
      // expiry, scopes), same encrypt-the-whole-value approach as mcp_servers.env's
      // per-key encryption. `status` is 'disconnected' until a real OAuth flow completes.
      db.exec(`
        CREATE TABLE connectors (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'disconnected',
          account_label TEXT,
          credentials TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // Per-agent attachment — deliberately not global, same reasoning as v20's
      // mcp_server_ids (a connector isn't exposed to every agent just because it's
      // connected). JSON array of connectors.id.
      db.exec(`ALTER TABLE agents ADD COLUMN connector_ids TEXT NOT NULL DEFAULT '[]';`);
    },
  },
  {
    version: 26,
    up: (db) => {
      // Per-connector user-entered configuration (OAuth client id/secret, or any other
      // field a connector type declares) — kept separate from `credentials` because
      // settings and credentials have different lifecycles: settings survive
      // disconnect/reconnect, credentials do not (disconnectConnector nulls credentials
      // only). Encrypted as one JSON blob, same approach as `credentials`.
      db.exec(`ALTER TABLE connectors ADD COLUMN settings TEXT;`);
    },
  },
  {
    version: 27,
    up: (db) => {
      // decryptSecret only unwraps values prefixed "nodeCrypto:" (the AES-256-GCM scheme
      // this app has always used to write these two keys) and returns anything else
      // unchanged, so a stale/foreign-format value (e.g. an old Electron safeStorage
      // blob) gets handed to the provider as a garbage "API key" instead of failing
      // loudly. Clear any chatApiKey/voiceApiKey row that isn't in the current format so
      // getDecryptedKey's "No API key configured" error fires instead, sending the user
      // back to Settings to re-enter it.
      const rows = db
        .prepare(
          "SELECT setting_name, setting_value FROM settings WHERE setting_name IN (?, ?)"
        )
        .all("appSettings.chatApiKey", "appSettings.voiceApiKey") as {
        setting_name: string;
        setting_value: string;
      }[];
      for (const row of rows) {
        const value = JSON.parse(row.setting_value) as unknown;
        if (typeof value !== "string" || !value.startsWith("nodeCrypto:")) {
          db.prepare("DELETE FROM settings WHERE setting_name = ?").run(row.setting_name);
        }
      }
    },
  },
  {
    version: 28,
    up: (db) => {
      // Task Manager: reminders and recurring/one-shot prompt runs. `prompt` NULL means a
      // plain reminder (just fires a notification); non-NULL means the scheduler runs it
      // through an agent. `prompt_target_agent_id` is nullable with ON DELETE SET NULL (not
      // CASCADE) so deleting the target agent falls back to running against the
      // orchestrator instead of silently destroying the task — same "one bad reference
      // must not take down user data" precedent as agent_data's cascade, just the opposite
      // direction since here the task, not the agent-scoped data, is the thing worth keeping.
      // `recurrence_interval_ms` NULL = one-shot; otherwise the scheduler reschedules
      // `next_run_at` by this many ms after each run. `recurrence_params` is a JSON object
      // of dynamic placeholder values substituted into `prompt` the same {{key}} way
      // renderPrompt() already does for {{agentName}}/{{userName}} in ai/agents.ts.
      db.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          notes TEXT,
          due_at TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          prompt TEXT,
          prompt_target_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          recurrence_interval_ms INTEGER,
          recurrence_params TEXT NOT NULL DEFAULT '{}',
          next_run_at TEXT,
          last_run_at TEXT,
          last_result TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.exec(`CREATE INDEX idx_tasks_next_run_at ON tasks (next_run_at);`);
    },
  },
  {
    version: 29,
    up: (db) => {
      // taskAgent's default display name renamed 'Keeper' → 'Chrono'. Conditional, same
      // pattern as v13's Forge→Cipher/Lore→Atlas renames, so a user's own custom name is
      // never clobbered.
      db.prepare("UPDATE agents SET name = ? WHERE id = ? AND name = ?").run("Chrono", "taskAgent", "Keeper");
    },
  },
  {
    version: 30,
    up: (db) => {
      // Orchestrator's default display name renamed 'Aixon' → 'Orbit'. Conditional on the
      // stored value still being the prior default, same as v13's Alex→Aixon rename, so a
      // name the user chose during onboarding is never clobbered.
      db.prepare("UPDATE settings SET setting_value = ? WHERE setting_name = ? AND setting_value = ?").run(
        JSON.stringify("Orbit"),
        "appSettings.agentName",
        JSON.stringify("Aixon")
      );
    },
  },
  {
    version: 31,
    up: (db, { knowledgeFilesDir, legacyKnowledgeFilesDirs }) => {
      // Companion to appDirs.migrateLegacyUserData(), which moves the files themselves at
      // startup before this runs. That move relocates the knowledge-files directory; this
      // re-points the absolute paths stored against it. Without both halves, the files are
      // in the right place but every row still names the old one.
      if (!knowledgeFilesDir || !legacyKnowledgeFilesDirs?.length) return;
      rewriteKnowledgeFilePaths(db, knowledgeFilesDir, legacyKnowledgeFilesDirs);
    },
  },
  {
    version: 32,
    up: (db) => {
      // token_usage already carries a trace_id grouping the LLM calls of one run, but the
      // value was a randomUUID() generated inline at the call site and thrown away, so no
      // message could ever be joined back to what it cost. This is the other half of that
      // key: agent.ts now generates the id once per run and stamps it on the assistant
      // message it appends.
      //
      // Nullable with no default on purpose — rows written before this migration have an
      // unknowable trace, and NULL says that honestly. A '' default would claim every old
      // message shares one trace and make them all join to each other.
      db.exec(`ALTER TABLE messages ADD COLUMN trace_id TEXT;`);
      db.exec(`CREATE INDEX idx_messages_trace_id ON messages(trace_id);`);
    },
  },
  // Versions 33 and 34 are permanently unclaimed here. 33 belongs to the parallel feat/http-tools
  // branch (it creates http_tool_collections/http_tools) and 34 was consumed on a development
  // machine before the clash was spotted — the incident that motivated the schema_migrations ledger
  // documented at the top of this file. Both numbers stay reserved because real databases already
  // record them as applied; reusing either would mean a migration that never runs there.
  //
  // Gaps are harmless — selection is by absence from the ledger, not by ordering. New migrations
  // should use `id: "YYYYMMDDHHMMSS"` rather than continuing this sequence at all.
  {
    version: 35,
    up: (db) => {
      // Distinguishes what a knowledge_files row actually *is*, now that granted folders live
      // here too. 'file' and 'url' rows own a copy of their content in app storage; a 'folder'
      // row owns nothing — it is a handle to a path the user granted, read live on demand, and
      // its content/content_hash stay empty. Defaulting to 'file' keeps every existing insert
      // that omits the column working unchanged.
      db.exec(`ALTER TABLE knowledge_files ADD COLUMN kind TEXT NOT NULL DEFAULT 'file';`);
      // v19 gave source_url a '' default, so a non-empty value is an exact test for the URL
      // rows seeded before this column existed — including each part of a split page, since
      // the predicate is per-row.
      db.exec(`UPDATE knowledge_files SET kind = 'url' WHERE source_url != '';`);
      db.exec(`CREATE INDEX idx_knowledge_files_kind ON knowledge_files(kind);`);
    },
  },
  {
    version: 36,
    up: (db) => {
      // ensureDefaultAgentsSeeded skips rows that already exist, so an agent's prompt and
      // description are copied out of prompts/*.md and defaultAgents.json exactly once, at
      // first run, and never re-read. Editing those files therefore only reaches fresh
      // installs — every existing install would keep telling the model that granted folders
      // live in a "Folders widget" that no longer exists, and that they are separate from the
      // Knowledgebase. (The orchestrator prompt needs no equivalent: it is read live from its
      // ?raw import on every build, see getOrchestratorPromptTemplate.)
      //
      // Targeted replace() rather than overwriting the whole prompt: it leaves any other
      // edit the user made intact, and is a no-op when the phrase is absent, so re-running
      // it can't corrupt an already-migrated or hand-edited prompt.
      const replacePhrase = db.prepare(
        "UPDATE agents SET prompt = replace(prompt, ?, ?) WHERE id = 'knowledgeAgent'"
      );
      replacePhrase.run("via the Folders widget", "in the Knowledge widget");
      replacePhrase.run(
        " (separate from the Knowledgebase library)",
        " — these are attached folders in the Knowledgebase, read live rather than copied"
      );

      // Guarded on the exact prior default so a description the user edited is never clobbered,
      // same reasoning as v29/v30's conditional renames.
      db.prepare("UPDATE agents SET description = ? WHERE id = 'knowledgeAgent' AND description = ?").run(
        "Reads and searches the documents (Markdown, text, CSV, PDF, Word, Excel, PowerPoint, HTML, OpenDocument, legacy .doc/.xls, and code/data files) you've added to the knowledge base, and browses the folders you've attached to it.",
        "Reads and searches the documents (Markdown, text, CSV, PDF, Word, Excel, PowerPoint, HTML, OpenDocument, legacy .doc/.xls, and code/data files) you've added to the knowledge base."
      );
    },
  },
  {
    // Timestamp id rather than the `version: 33` this branch was written against. The
    // schema_migrations ledger records every integer from 1 to a pre-ledger database's
    // user_version when it adopts one, so 33 already reads as applied on installs that never
    // ran this — the reason main reserves 33 and 34 permanently. A fresh id is the only key
    // that still selects here.
    //
    // The DDL is written idempotently for the converse case: the development machine that
    // consumed 33 really does have these tables, and this must be a no-op there.
    id: "20260801045451",
    up: (db) => {
      // User-defined HTTP tools: a third way to give an agent tools, alongside v20's MCP
      // servers (local stdio processes) and v25's connectors (code-authored third-party
      // services). Unlike both, these are authored entirely by the user at runtime — one
      // collection per API, holding the base URL and any shared auth headers, with one row
      // per endpoint underneath it.
      //
      // headers values are individually encrypted (encryptSecret/decryptSecret), same
      // per-key approach as mcp_servers.env, because an Authorization header is a secret
      // in exactly the way an env var is.
      db.exec(`
        CREATE TABLE IF NOT EXISTS http_tool_collections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          base_url TEXT NOT NULL,
          headers TEXT NOT NULL DEFAULT '{}',
          enabled INTEGER NOT NULL DEFAULT 1,
          allow_private_hosts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // FK + cascade so deleting a collection can't leave orphaned endpoints behind,
      // same reasoning as v24's agent_data.
      //
      // tool_name is the snake_case id the model actually calls and is globally unique:
      // two collections both exposing "get_post" would collide in one agent's tool list,
      // where the SDK resolves tools by name alone.
      db.exec(`
        CREATE TABLE IF NOT EXISTS http_tools (
          id TEXT PRIMARY KEY,
          collection_id TEXT NOT NULL REFERENCES http_tool_collections(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          tool_name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          method TEXT NOT NULL DEFAULT 'GET',
          path TEXT NOT NULL DEFAULT '',
          headers TEXT NOT NULL DEFAULT '{}',
          body_template TEXT NOT NULL DEFAULT '',
          params TEXT NOT NULL DEFAULT '[]',
          requires_confirmation INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_http_tools_collection_id ON http_tools(collection_id);`);
      // Per-agent attachment, deliberately not global — same reasoning as v20's
      // mcp_server_ids and v25's connector_ids. Whole collections attach, not individual
      // endpoints: an API's endpoints are only useful together, and attaching at the
      // collection level keeps the picker one row per API instead of one per URL.
      if (!hasColumn(db, "agents", "http_tool_collection_ids")) {
        db.exec(`ALTER TABLE agents ADD COLUMN http_tool_collection_ids TEXT NOT NULL DEFAULT '[]';`);
      }
    },
  },
  {
    // Re-keyed off 34 for the same reason as the migration above.
    id: "20260801045452",
    up: (db) => {
      // Approval moved from a per-endpoint flag to a global, method-based policy: the user
      // decides once whether POST / PUT+PATCH / DELETE should pause and ask, rather than
      // ticking a box on every endpoint they ever add. That policy lives in the settings
      // table (appSettings.httpToolApproval*), so the column here has no reader left.
      //
      // Appended rather than folded into the migration above because that one has already run
      // on a real database — editing it would leave that install carrying a column fresh
      // installs never create, which is exactly the divergence append-only migrations prevent.
      //
      // Guarded because the original `version: 34` never ran anywhere: it was filtered out by
      // a user_version that a parallel branch had already pushed past. Re-keyed it now runs,
      // and the guard keeps it a no-op if any database did apply it.
      if (hasColumn(db, "http_tools", "requires_confirmation")) {
        db.exec(`ALTER TABLE http_tools DROP COLUMN requires_confirmation;`);
      }
    },
  },
];

/** Fails at import rather than at some user's next launch. A duplicate key would mean one of the two
 * migrations never runs — exactly the silent failure this ledger exists to remove — and the most
 * likely way to introduce one is merging two branches that each added an entry. */
(function assertUniqueMigrationIds() {
  const seen = new Set<string>();
  for (const migration of migrations) {
    const id = canonicalId(migration);
    if (seen.has(id)) {
      throw new Error(
        `Duplicate migration id "${id}". Two migrations cannot share a key — one of them would never ` +
          `run. If this appeared after a merge, give the newer migration a fresh ` +
          `id: "YYYYMMDDHHMMSS" instead of a sequential version.`
      );
    }
    seen.add(id);
  }
})();

function ensureLedgerTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
}

/** Adopts a database that predates the ledger, recording what `user_version` already implies.
 *
 * Marks **every integer from 1 to user_version**, not just the ids this branch happens to define.
 * That difference is load-bearing: a database can sit at a version whose migration lives on a branch
 * not merged yet (this repo's worktrees share one real database). Backfilling only the locally
 * defined ids would leave that number unrecorded, so when its branch does merge the migration would
 * re-run against a schema it has already been applied to — e.g. `ADD COLUMN kind` failing with
 * "duplicate column name". Recording the whole range makes the outcome identical no matter which
 * branch merges first. */
function bootstrapLedgerFromUserVersion(db: Database.Database): void {
  const alreadyRecorded = (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number }).n;
  if (alreadyRecorded > 0) return;
  const highWaterMark = db.pragma("user_version", { simple: true }) as number;
  if (highWaterMark <= 0) return;
  const insert = db.prepare("INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)");
  const backfill = db.transaction(() => {
    for (let version = 1; version <= highWaterMark; version++) {
      insert.run(String(version).padStart(MIGRATION_ID_WIDTH, "0"));
    }
  });
  backfill();
}

export function runMigrations(db: Database.Database, context: MigrationContext = {}) {
  ensureLedgerTable(db);
  bootstrapLedgerFromUserVersion(db);

  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((row) => row.id)
  );
  // Selected by absence from the ledger rather than by being greater than a high-water mark, so a
  // migration numbered below one that already ran still gets applied instead of being unreachable.
  const pending = migrations
    .filter((migration) => !applied.has(canonicalId(migration)))
    .sort((a, b) => canonicalId(a).localeCompare(canonicalId(b)));

  for (const migration of pending) {
    const id = canonicalId(migration);
    const applyMigration = db.transaction(() => {
      migration.up(db, context);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(id);
      // Compatibility bridge: keep user_version at the highest applied *numeric* version so that
      // reverting to the pre-ledger runner still sees a correct high-water mark. A timestamp id
      // cannot be represented here (PRAGMA user_version is a 32-bit int — 14 digits silently reads
      // back as 0), so this only holds while every migration is still numeric.
      if (migration.version !== undefined) {
        const current = db.pragma("user_version", { simple: true }) as number;
        if (migration.version > current) db.pragma(`user_version = ${migration.version}`);
      }
    });
    applyMigration();
  }
}
