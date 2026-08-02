/// <reference types="vite/client" />

/** Build-time release metadata, substituted by the `define` block in electron.vite.config.ts
 * (mirrored into vite.config.ts for `dev:web`). Resolved from the OpenOrbit repo's latest
 * release when the build runs; every one of these is "" — and the version "0.0.0" — when no
 * release exists or the build was offline, so consumers must handle the empty case. */
declare const __APP_RELEASE_VERSION__: string;
declare const __APP_RELEASE_DATE__: string;
declare const __APP_RELEASE_NOTES__: string;
declare const __APP_RELEASE_URL__: string;
declare const __APP_COMMIT__: string;

/** Build-time overrides for the About screen's outbound links (src/lib/appLinks.ts).
 * Declared explicitly so a typo is a type error — vite/client's index signature would
 * otherwise type every one of these as `any` and defeat the `?? fallback`. */
interface ImportMetaEnv {
  readonly VITE_APP_DOCS_URL?: string;
  readonly VITE_APP_BUG_URL?: string;
  readonly VITE_APP_PRIVACY_URL?: string;
  readonly VITE_APP_TERMS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface LaunchableApp {
  id: string;
  name: string;
  path: string;
}

interface SystemStats {
  cpuPct: number;
  ramPct: number;
  ramUsedGB: number;
  ramTotalGB: number;
  diskPct: number;
  diskUsedGB: number;
  diskTotalGB: number;
}

interface ChatMessageRecord {
  id: number;
  conversationId: number;
  role: string;
  text: string;
  agentId: string | null;
  /** Links to token_usage rows for the run that produced this message. Assistant messages
   * only, and null for anything written before migration 32. */
  traceId: string | null;
  createdAt: string;
}

interface ChatMessagePage {
  messages: ChatMessageRecord[];
  total: number;
}

interface MemoryRecord {
  id: number;
  agentId: string | null;
  kind: string;
  content: string;
  createdAt: string;
}

/** Mirrors KnowledgebaseKind in electron/main/ipc/knowledgeBase.ts. */
type KnowledgebaseKind = "file" | "url" | "folder";

interface KnowledgebaseFileRecord {
  id: number;
  path: string;
  title: string;
  originalName: string;
  category: string;
  syncedAt: string | null;
  createdAt: string;
  sourceUrl: string | null;
  /** 'file'/'url' rows own a copy of their content; a 'folder' row is a handle to a granted
   * directory, read live and browsed with fs.readDir rather than opened. */
  kind: KnowledgebaseKind;
}

interface DiscoveredLink {
  url: string;
  text: string;
}

interface DiscoveredLinks {
  seedUrl: string;
  title: string;
  sameDomainLinks: DiscoveredLink[];
  externalLinks: DiscoveredLink[];
}

interface AgentRow {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  prompt: string;
  model: string;
  tools: string;
  enabled: number;
  system: number;
  created_at: string;
  mcp_server_ids: string;
  connector_ids: string;
  /** JSON array of http_tool_collections.id attached to this agent. */
  http_tool_collection_ids: string;
}

/** AgentRow plus derived, non-persisted fields computed by listAgentsForDisplay()
 * (electron/main/ai/agents.ts) for the orbit UI's hover tooltip / info modal. */
interface AgentDisplayRow extends AgentRow {
  toolNames: string[];
  connectorToolCount: number;
}

interface McpServerRow {
  id: string;
  name: string;
  command: string;
  args: string;
  env: string;
  enabled: number;
  created_at: string;
}

interface McpSearchResult {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface ConnectorSettingsField {
  key: string;
  label: string;
  type: "text" | "password" | "readonly";
  required?: boolean;
  /** Static display value for type "readonly" fields — shown as a copyable row, never persisted. */
  defaultValue?: string;
}

interface ConnectorCatalogEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: "connected" | "disconnected";
  accountLabel: string | null;
  settingsFields: ConnectorSettingsField[];
  settingsConfigured: boolean;
  /** True for an entry that only holds shared settings for sibling connectors — no
   * Connect/Disconnect button should be shown for it. */
  credentialsOnly: boolean;
  /** Id of the entry this connector shares its settings with, or null when it owns its
   * own. Used by src/lib/connectorGroups.ts to nest siblings under that parent. */
  settingsSourceId: string | null;
}

/** Mirrors HttpToolParam in electron/main/db/httpToolsStore.ts — the renderer does not
 * import the main-process type, so `tsc` will NOT catch editing only one side. */
interface HttpToolParam {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  location: "path" | "query" | "header" | "body";
}

interface HttpToolCollectionRow {
  id: string;
  name: string;
  description: string;
  base_url: string;
  /** JSON-stringified Record<string, string>; values stay encrypted here — read them with
   * httpTools.getCollectionHeaders when editing. */
  headers: string;
  enabled: number;
  allow_private_hosts: number;
  created_at: string;
}

interface HttpToolRow {
  id: string;
  collection_id: string;
  name: string;
  /** The snake_case id the model actually calls. */
  tool_name: string;
  description: string;
  method: string;
  path: string;
  headers: string;
  body_template: string;
  /** JSON-stringified HttpToolParam[]. */
  params: string;
  enabled: number;
  created_at: string;
}

interface HttpToolTestResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  body?: string;
  error?: string;
}

interface HttpToolCollectionInput {
  name: string;
  description?: string;
  baseUrl: string;
  headers?: Record<string, string>;
  allowPrivateHosts?: boolean;
}

interface HttpToolCollectionPatch {
  name?: string;
  description?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  allowPrivateHosts?: boolean;
}

interface HttpToolInput {
  collectionId: string;
  name: string;
  description?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  params?: HttpToolParam[];
}

interface HttpToolPatch {
  name?: string;
  description?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  params?: HttpToolParam[];
  enabled?: boolean;
}

interface HttpToolTestInput {
  baseUrl: string;
  path?: string;
  method?: string;
  params?: HttpToolParam[];
  args?: Record<string, string | number | boolean | null>;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  allowPrivateHosts?: boolean;
}

interface TokenUsageFilter {
  range?: "today" | "week" | "all";
  model?: string | null;
}

interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  models: string[];
}

interface DailyTokenUsage {
  date: string;
  totalTokens: number;
}

interface TraceUsage {
  totalTokens: number;
  /** null while the async cost lookup hasn't backfilled yet — not the same as 0. */
  costUsd: number | null;
  calls: number;
}

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
  city?: string;
  country?: string;
}

/** See migrations.ts v28 (tasks table) / db/tasksStore.ts. `prompt === null` is a plain
 * reminder; otherwise the scheduler runs `prompt` through an agent when due. */
interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  status: "pending" | "done" | "cancelled";
  prompt: string | null;
  prompt_target_agent_id: string | null;
  recurrence_interval_ms: number | null;
  recurrence_params: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskCreateInput {
  title: string;
  notes?: string;
  dueAt?: string;
  prompt?: string;
  promptTargetAgentId?: string;
  recurrenceIntervalMs?: number;
  recurrenceParams?: Record<string, string>;
}

interface TaskUpdatePatch {
  title?: string;
  notes?: string;
  dueAt?: string;
  status?: "pending" | "done" | "cancelled";
  prompt?: string;
  promptTargetAgentId?: string;
  recurrenceIntervalMs?: number;
  recurrenceParams?: Record<string, string>;
}

interface AppInfo {
  name: string;
  packageVersion: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  osRelease: string;
  dataPath: string;
  databasePath: string;
}

interface AppStorageInfo {
  knowledgeFileCount: number;
  knowledgeBytes: number;
  databaseBytes: number;
  cacheBytes: number;
}

interface AppStats {
  messageCount: number;
}

interface Window {
  agentsAPI: {
    ping: () => Promise<string>;
    fs: {
      pickFolder: () => Promise<string | null>;
      listAllowedRoots: () => Promise<string[]>;
      removeAllowedRoot: (root: string) => Promise<string[]>;
      readDir: (dirPath: string) => Promise<FsEntry[]>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<void>;
      revealInFolder: (filePath: string) => Promise<void>;
      openPath: (filePath: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
    };
    apps: {
      list: () => Promise<LaunchableApp[]>;
      refresh: () => Promise<LaunchableApp[]>;
      launch: (appId: string) => Promise<void>;
    };
    window: {
      minimize: () => Promise<void>;
      close: () => Promise<void>;
      toggleFullscreen: () => Promise<void>;
      onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void;
    };
    system: {
      getStats: () => Promise<SystemStats>;
      onStatsUpdate: (callback: (stats: SystemStats) => void) => () => void;
    };
    location: {
      refresh: () => Promise<LocationData | null>;
      get: () => Promise<LocationData | null>;
    };
    providers: {
      list: () => Promise<{
        catalog: {
          id: string;
          label: string;
          baseUrl: string;
          defaultChatModel: string;
          api: string;
          modelsAuth: string;
          keyRequired: boolean;
          supportsVoice: boolean;
          defaultTranscriptionModel: string;
          defaultTtsModel: string;
        }[];
        configured: { id: string; apiUrl: string; keySet: boolean }[];
      }>;
      selectChat: (selection: {
        providerId: string;
        apiUrl?: string;
        apiKey?: string;
        model?: string;
      }) => Promise<{ providerId: string; model: string; updatedAgents: number }>;
    };
    settings: {
      get: () => Promise<Record<string, unknown>>;
      update: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>;
      reset: () => Promise<Record<string, unknown>>;
      testChat: () => Promise<{ ok: boolean; detail: string }>;
      testVoice: () => Promise<{ ok: boolean; detail: string }>;
      onUpdate: (callback: () => void) => () => void;
    };
    chat: {
      listMessagesPage: (limit: number, page: number, conversationId?: number) => Promise<ChatMessagePage>;
      appendMessage: (message: {
        role: string;
        text: string;
        agentId?: string | null;
        conversationId?: number;
      }) => Promise<ChatMessageRecord>;
    };
    memory: {
      list: (agentId?: string) => Promise<MemoryRecord[]>;
      add: (entry: { agentId?: string | null; kind: string; content: string }) => Promise<MemoryRecord>;
    };
    userInfo: {
      seedFacts: (facts: Array<{ question: string; answer: string }>) => Promise<void>;
      list: () => Promise<Array<{ question: string; answer: string; askedBy: string; createdAt: string }>>;
      setFact: (question: string, answer: string) => Promise<void>;
    };
    agent: {
      run: (input: string) => Promise<string>;
      runStream: (input: string, requestId: string, targetAgentName?: string) => Promise<string>;
      onStreamChunk: (callback: (payload: { requestId: string; chunk: string }) => void) => () => void;
      onStreamAgent: (callback: (payload: { requestId: string; agentName: string }) => void) => () => void;
      onStreamStep: (
        callback: (payload: {
          requestId: string;
          type: string;
          label: string;
          at?: number;
          toolName?: string;
          agentName?: string;
          callId?: string;
        }) => void
      ) => () => void;
      onStreamTrace: (callback: (payload: { requestId: string; traceId: string }) => void) => () => void;
      onToolApproval: (
        callback: (payload: {
          requestId: string;
          approvalId: string;
          toolName: string;
          agentName?: string;
          args?: string;
        }) => void
      ) => () => void;
      respondToApproval: (approvalId: string, approved: boolean) => Promise<void>;
      list: () => Promise<AgentDisplayRow[]>;
      update: (
        id: string,
        patch: {
          name?: string;
          tagline?: string;
          description?: string;
          model?: string;
          prompt?: string;
          enabled?: boolean;
          mcpServerIds?: string[];
          connectorIds?: string[];
          httpToolCollectionIds?: string[];
        }
      ) => Promise<AgentRow>;
      create: (input: {
        name: string;
        icon?: string;
        tagline?: string;
        description?: string;
        model?: string;
        prompt?: string;
      }) => Promise<AgentRow>;
      orchestratorPrompt: () => Promise<string>;
      delete: (id: string) => Promise<void>;
      exportToFile: (ids?: string[]) => Promise<{ canceled: boolean }>;
      importFromFile: () => Promise<AgentRow[]>;
    };
    knowledgebase: {
      list: () => Promise<KnowledgebaseFileRecord[]>;
      add: (filePath: string) => Promise<KnowledgebaseFileRecord>;
      pickAndAdd: () => Promise<{ added: KnowledgebaseFileRecord[]; failed: { path: string; error: string }[] }>;
      remove: (id: number) => Promise<void>;
      sync: (id?: number) => Promise<{ updated: string[]; missing: { name: string; error: string }[] }>;
      updateCategory: (id: number, category: string) => Promise<void>;
      discoverLinks: (url: string) => Promise<DiscoveredLinks>;
      addUrls: (urls: string[]) => Promise<{ added: KnowledgebaseFileRecord[]; failed: { url: string; error: string }[] }>;
      getPathForFile: (file: File) => string;
    };
    mcp: {
      list: () => Promise<McpServerRow[]>;
      create: (input: { name: string; command: string; args?: string[]; env?: Record<string, string> }) => Promise<McpServerRow>;
      update: (
        id: string,
        patch: { name?: string; command?: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }
      ) => Promise<McpServerRow>;
      delete: (id: string) => Promise<void>;
      getEnv: (id: string) => Promise<Record<string, string>>;
      test: (input: { name: string; command: string; args?: string[]; env?: Record<string, string> }) => Promise<{ tools: string[] }>;
      search: (query: string) => Promise<McpSearchResult[]>;
    };
    connectors: {
      list: () => Promise<ConnectorCatalogEntry[]>;
      connect: (id: string) => Promise<ConnectorCatalogEntry[]>;
      disconnect: (id: string) => Promise<ConnectorCatalogEntry[]>;
      test: (id: string) => Promise<{ ok: boolean; error?: string }>;
      getSettings: (id: string) => Promise<Record<string, string>>;
      saveSettings: (id: string, settings: Record<string, string>) => Promise<ConnectorCatalogEntry[]>;
      onUpdate: (callback: () => void) => () => void;
    };
    httpTools: {
      listCollections: () => Promise<HttpToolCollectionRow[]>;
      listTools: (collectionId?: string) => Promise<HttpToolRow[]>;
      createCollection: (input: HttpToolCollectionInput) => Promise<HttpToolCollectionRow>;
      updateCollection: (id: string, patch: HttpToolCollectionPatch) => Promise<HttpToolCollectionRow>;
      deleteCollection: (id: string) => Promise<void>;
      createTool: (input: HttpToolInput) => Promise<HttpToolRow>;
      updateTool: (id: string, patch: HttpToolPatch) => Promise<HttpToolRow>;
      deleteTool: (id: string) => Promise<void>;
      getCollectionHeaders: (id: string) => Promise<Record<string, string>>;
      getToolHeaders: (id: string) => Promise<Record<string, string>>;
      testTool: (input: HttpToolTestInput) => Promise<HttpToolTestResult>;
    };
    voice: {
      transcribe: (base64Audio: string, format: string) => Promise<string>;
      synthesize: (text: string) => Promise<{ audio: string; format: string }>;
    };
    tokenUsage: {
      get: (filter: TokenUsageFilter) => Promise<TokenUsageSummary>;
      daily: () => Promise<DailyTokenUsage[]>;
      byTraces: (traceIds: string[]) => Promise<Record<string, TraceUsage>>;
      onUpdate: (callback: () => void) => () => void;
    };
    tasks: {
      list: () => Promise<TaskRow[]>;
      create: (input: TaskCreateInput) => Promise<TaskRow>;
      update: (id: string, patch: TaskUpdatePatch) => Promise<TaskRow>;
      complete: (id: string) => Promise<TaskRow>;
      delete: (id: string) => Promise<void>;
      onUpdate: (callback: () => void) => () => void;
    };
    appInfo: {
      get: () => Promise<AppInfo>;
      storage: () => Promise<AppStorageInfo>;
      stats: () => Promise<AppStats>;
      clearCache: () => Promise<number>;
    };
    dev: {
      log: (...args: unknown[]) => void;
    };
  };
}
