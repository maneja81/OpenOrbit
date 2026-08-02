import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { FsEntry } from "../main/ipc/filesystem";
import type { LaunchableApp } from "../main/ipc/appLauncher";
import type { SystemStats } from "../main/ipc/systemStats";
import type { LocationData } from "../main/ipc/location";
import type { ChatMessageRecord, ChatMessagePage } from "../main/ipc/chatHistory";
import type { MemoryRecord } from "../main/ipc/memory";
import type { AgentRow, AgentDisplayRow } from "../main/ipc/agent";
import type { TokenUsageFilter, TokenUsageSummary, DailyTokenUsage, TraceUsage } from "../main/ipc/tokenUsage";
import type { KnowledgebaseFileRecord } from "../main/ipc/knowledgeBase";
import type { DiscoveredLinks } from "../main/ipc/knowledgeUrlDiscovery";
import type { McpServerRow, McpSearchResult } from "../main/ipc/mcp";
import type { ConnectorCatalogEntry } from "../main/ipc/connectors";
import type { HttpToolCollectionRow, HttpToolRow, HttpToolParam } from "../main/ipc/httpTools";
import type { TaskCreateInput, TaskRow, TaskUpdatePatch } from "../main/ipc/tasks";
import type { AppInfo, AppStorageInfo, AppStats } from "../main/ipc/appInfo";

function subscribe(channel: string, callback: () => void): () => void {
  const listener = () => callback();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function subscribeWithPayload<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const agentsAPI = {
  ping: (): Promise<string> => ipcRenderer.invoke("app:ping"),

  fs: {
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke("fs:pickFolder"),
    listAllowedRoots: (): Promise<string[]> => ipcRenderer.invoke("fs:listAllowedRoots"),
    removeAllowedRoot: (root: string): Promise<string[]> => ipcRenderer.invoke("fs:removeAllowedRoot", root),
    readDir: (dirPath: string): Promise<FsEntry[]> => ipcRenderer.invoke("fs:readDir", dirPath),
    readFile: (filePath: string): Promise<string> => ipcRenderer.invoke("fs:readFile", filePath),
    writeFile: (filePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke("fs:writeFile", filePath, content),
    revealInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke("fs:revealInFolder", filePath),
    openPath: (filePath: string): Promise<void> => ipcRenderer.invoke("fs:openPath", filePath),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("fs:openExternal", url),
  },

  apps: {
    list: (): Promise<LaunchableApp[]> => ipcRenderer.invoke("apps:list"),
    refresh: (): Promise<LaunchableApp[]> => ipcRenderer.invoke("apps:refresh"),
    launch: (appId: string): Promise<void> => ipcRenderer.invoke("apps:launch", appId),
  },

  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
    close: (): Promise<void> => ipcRenderer.invoke("window:close"),
    toggleFullscreen: (): Promise<void> => ipcRenderer.invoke("window:toggleFullscreen"),
    onFullscreenChange: (callback: (isFullscreen: boolean) => void): (() => void) => {
      const unsubEnter = subscribe("window:entered-fullscreen", () => callback(true));
      const unsubLeave = subscribe("window:left-fullscreen", () => callback(false));
      return () => {
        unsubEnter();
        unsubLeave();
      };
    },
  },

  system: {
    getStats: (): Promise<SystemStats> => ipcRenderer.invoke("system:stats"),
    onStatsUpdate: (callback: (stats: SystemStats) => void): (() => void) =>
      subscribeWithPayload<SystemStats>("system:stats-update", callback),
  },

  location: {
    refresh: (): Promise<LocationData | null> => ipcRenderer.invoke("location:refresh"),
    get: (): Promise<LocationData | null> => ipcRenderer.invoke("location:get"),
  },

  providers: {
    /** Registry + which providers have credentials. Key values never cross this boundary. */
    list: (): Promise<{
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
    }> => ipcRenderer.invoke("providers:list"),
    /** Credentials for a provider that is not the Chat slot — otherwise an agent could be
     * pinned to one that could never be given a key. */
    save: (input: { providerId: string; apiUrl?: string; apiKey?: string }): Promise<
      { id: string; apiUrl: string; keySet: boolean }[]
    > => ipcRenderer.invoke("providers:save", input),
    /** One call on purpose: saving credentials, pointing the Chat slot and re-aligning the agents
     * that follow it are a single change — see electron/main/ai/selectProvider.ts. */
    selectChat: (selection: {
      providerId: string;
      apiUrl?: string;
      apiKey?: string;
      model?: string;
    }): Promise<{ providerId: string; model: string; updatedAgents: number }> =>
      ipcRenderer.invoke("providers:selectChat", selection),
  },
  settings: {
    get: (): Promise<Record<string, unknown>> => ipcRenderer.invoke("settings:get"),
    update: (patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke("settings:update", patch),
    reset: (): Promise<Record<string, unknown>> => ipcRenderer.invoke("settings:reset"),
    testChat: (): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke("settings:testChat"),
    testVoice: (): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke("settings:testVoice"),
    // Fires after an agent run completes, since a sub-agent's update_setting tool call
    // writes straight to the DB without going through settings:update — this is the only
    // way the renderer learns settings may have changed mid-run.
    onUpdate: (callback: () => void): (() => void) => subscribe("settings:update", callback),
  },

  agentData: {
    get: (agentId: string, key: string): Promise<unknown> => ipcRenderer.invoke("agentData:get", agentId, key),
    set: (agentId: string, key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke("agentData:set", agentId, key, value),
    list: (agentId: string): Promise<Record<string, unknown>> => ipcRenderer.invoke("agentData:list", agentId),
    delete: (agentId: string, key: string): Promise<void> => ipcRenderer.invoke("agentData:delete", agentId, key),
  },

  chat: {
    /** One page counted back from the newest message — page 0 is the most recent `limit`.
     * Rows come back oldest-first within the page. */
    listMessagesPage: (limit: number, page: number, conversationId?: number): Promise<ChatMessagePage> =>
      ipcRenderer.invoke("chat:listMessagesPage", limit, page, conversationId),
    appendMessage: (message: {
      role: string;
      text: string;
      agentId?: string | null;
      conversationId?: number;
    }): Promise<ChatMessageRecord> => ipcRenderer.invoke("chat:appendMessage", message),
  },

  memory: {
    list: (agentId?: string): Promise<MemoryRecord[]> => ipcRenderer.invoke("memory:list", agentId),
    add: (entry: { agentId?: string | null; kind: string; content: string }): Promise<MemoryRecord> =>
      ipcRenderer.invoke("memory:add", entry),
  },

  userInfo: {
    seedFacts: (facts: Array<{ question: string; answer: string }>): Promise<void> =>
      ipcRenderer.invoke("userInfo:seedFacts", facts),
    list: (): Promise<Array<{ question: string; answer: string; askedBy: string; createdAt: string }>> =>
      ipcRenderer.invoke("userInfo:list"),
    setFact: (question: string, answer: string): Promise<void> =>
      ipcRenderer.invoke("userInfo:setFact", question, answer),
  },

  agent: {
    run: (input: string): Promise<string> => ipcRenderer.invoke("agent:run", input),
    runStream: (input: string, requestId: string, targetAgentName?: string): Promise<string> =>
      ipcRenderer.invoke("agent:runStream", input, requestId, targetAgentName),
    onStreamChunk: (callback: (payload: { requestId: string; chunk: string }) => void): (() => void) =>
      subscribeWithPayload("agent:stream-chunk", callback),
    onStreamAgent: (callback: (payload: { requestId: string; agentName: string }) => void): (() => void) =>
      subscribeWithPayload("agent:stream-agent", callback),
    // toolName/agentName/callId/at are best-effort (see extractRunItemMeta) — a consumer
    // must fall back to `label` when they are absent. Mirrored in src/vite-env.d.ts.
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
    ): (() => void) => subscribeWithPayload("agent:stream-step", callback),
    /** Fires once per run, before the model is called — carries the id that links this
     * turn's message to its rows in token_usage. */
    onStreamTrace: (callback: (payload: { requestId: string; traceId: string }) => void): (() => void) =>
      subscribeWithPayload("agent:stream-trace", callback),
    /** Fires when a tool marked "requires confirmation" is about to run. The run is paused
     * (and its timeout clock stopped) until respondToApproval is called with the same
     * approvalId. `args` is the raw JSON argument string, when the SDK exposes one. */
    onToolApproval: (
      callback: (payload: {
        requestId: string;
        approvalId: string;
        toolName: string;
        agentName?: string;
        args?: string;
      }) => void
    ): (() => void) => subscribeWithPayload("agent:stream-approval", callback),
    respondToApproval: (approvalId: string, approved: boolean): Promise<void> =>
      ipcRenderer.invoke("agent:approveTool", approvalId, approved),
    list: (): Promise<AgentDisplayRow[]> => ipcRenderer.invoke("agent:list"),
    update: (
      id: string,
      patch: {
        name?: string;
        tagline?: string;
        description?: string;
        model?: string;
        providerId?: string;
        prompt?: string;
        enabled?: boolean;
        mcpServerIds?: string[];
        connectorIds?: string[];
        httpToolCollectionIds?: string[];
      }
    ): Promise<AgentRow> => ipcRenderer.invoke("agent:update", id, patch),
    create: (input: {
      name: string;
      icon?: string;
      tagline?: string;
      description?: string;
      model?: string;
        providerId?: string;
      prompt?: string;
    }): Promise<AgentRow> => ipcRenderer.invoke("agent:create", input),
    orchestratorPrompt: (): Promise<string> => ipcRenderer.invoke("agent:orchestratorPrompt"),
    delete: (id: string): Promise<void> => ipcRenderer.invoke("agent:delete", id),
    exportToFile: (ids?: string[]): Promise<{ canceled: boolean }> => ipcRenderer.invoke("agent:exportToFile", ids),
    importFromFile: (): Promise<AgentRow[]> => ipcRenderer.invoke("agent:importFromFile"),
  },

  knowledgebase: {
    list: (): Promise<KnowledgebaseFileRecord[]> => ipcRenderer.invoke("knowledgebase:list"),
    add: (filePath: string): Promise<KnowledgebaseFileRecord> => ipcRenderer.invoke("knowledgebase:add", filePath),
    pickAndAdd: (): Promise<{ added: KnowledgebaseFileRecord[]; failed: { path: string; error: string }[] }> =>
      ipcRenderer.invoke("knowledgebase:pickAndAdd"),
    remove: (id: number): Promise<void> => ipcRenderer.invoke("knowledgebase:remove", id),
    sync: (id?: number): Promise<{ updated: string[]; missing: { name: string; error: string }[] }> =>
      ipcRenderer.invoke("knowledgebase:sync", id),
    updateCategory: (id: number, category: string): Promise<void> =>
      ipcRenderer.invoke("knowledgebase:updateCategory", id, category),
    discoverLinks: (url: string): Promise<DiscoveredLinks> => ipcRenderer.invoke("knowledgebase:discoverLinks", url),
    addUrls: (urls: string[]): Promise<{ added: KnowledgebaseFileRecord[]; failed: { url: string; error: string }[] }> =>
      ipcRenderer.invoke("knowledgebase:addUrls", urls),
    // Dropped File objects no longer expose a usable `.path` in modern Electron;
    // webUtils.getPathForFile is the replacement, only callable from preload/main.
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  },

  mcp: {
    list: (): Promise<McpServerRow[]> => ipcRenderer.invoke("mcp:list"),
    create: (input: { name: string; command: string; args?: string[]; env?: Record<string, string> }): Promise<McpServerRow> =>
      ipcRenderer.invoke("mcp:create", input),
    update: (
      id: string,
      patch: { name?: string; command?: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }
    ): Promise<McpServerRow> => ipcRenderer.invoke("mcp:update", id, patch),
    delete: (id: string): Promise<void> => ipcRenderer.invoke("mcp:delete", id),
    getEnv: (id: string): Promise<Record<string, string>> => ipcRenderer.invoke("mcp:getEnv", id),
    test: (input: {
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }): Promise<{ tools: string[] }> => ipcRenderer.invoke("mcp:test", input),
    search: (query: string): Promise<McpSearchResult[]> => ipcRenderer.invoke("mcp:search", query),
  },

  connectors: {
    list: (): Promise<ConnectorCatalogEntry[]> => ipcRenderer.invoke("connectors:list"),
    connect: (id: string): Promise<ConnectorCatalogEntry[]> => ipcRenderer.invoke("connectors:connect", id),
    disconnect: (id: string): Promise<ConnectorCatalogEntry[]> => ipcRenderer.invoke("connectors:disconnect", id),
    test: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("connectors:test", id),
    getSettings: (id: string): Promise<Record<string, string>> => ipcRenderer.invoke("connectors:getSettings", id),
    saveSettings: (id: string, settings: Record<string, string>): Promise<ConnectorCatalogEntry[]> =>
      ipcRenderer.invoke("connectors:saveSettings", id, settings),
    // Fires after an agent run completes, since ConfigAgent's connect_connector/
    // disconnect_connector/attach_connector_to_agent/detach_connector_from_agent tools
    // write straight to the DB without going through the connectors:connect/disconnect
    // handlers — this is the only way the renderer learns connectors may have changed
    // mid-run. Same pattern as settings.onUpdate above.
    onUpdate: (callback: () => void): (() => void) => subscribe("connectors:update", callback),
  },

  httpTools: {
    listCollections: (): Promise<HttpToolCollectionRow[]> => ipcRenderer.invoke("httpTools:listCollections"),
    listTools: (collectionId?: string): Promise<HttpToolRow[]> =>
      ipcRenderer.invoke("httpTools:listTools", collectionId),
    createCollection: (input: {
      name: string;
      description?: string;
      baseUrl: string;
      headers?: Record<string, string>;
      allowPrivateHosts?: boolean;
    }): Promise<HttpToolCollectionRow> => ipcRenderer.invoke("httpTools:createCollection", input),
    updateCollection: (
      id: string,
      patch: {
        name?: string;
        description?: string;
        baseUrl?: string;
        headers?: Record<string, string>;
        enabled?: boolean;
        allowPrivateHosts?: boolean;
      }
    ): Promise<HttpToolCollectionRow> => ipcRenderer.invoke("httpTools:updateCollection", id, patch),
    deleteCollection: (id: string): Promise<void> => ipcRenderer.invoke("httpTools:deleteCollection", id),
    createTool: (input: {
      collectionId: string;
      name: string;
      description?: string;
      method?: string;
      path?: string;
      headers?: Record<string, string>;
      bodyTemplate?: string;
      params?: HttpToolParam[];
    }): Promise<HttpToolRow> => ipcRenderer.invoke("httpTools:createTool", input),
    updateTool: (
      id: string,
      patch: {
        name?: string;
        description?: string;
        method?: string;
        path?: string;
        headers?: Record<string, string>;
        bodyTemplate?: string;
        params?: HttpToolParam[];
          enabled?: boolean;
      }
    ): Promise<HttpToolRow> => ipcRenderer.invoke("httpTools:updateTool", id, patch),
    deleteTool: (id: string): Promise<void> => ipcRenderer.invoke("httpTools:deleteTool", id),
    getCollectionHeaders: (id: string): Promise<Record<string, string>> =>
      ipcRenderer.invoke("httpTools:getCollectionHeaders", id),
    getToolHeaders: (id: string): Promise<Record<string, string>> =>
      ipcRenderer.invoke("httpTools:getToolHeaders", id),
    testTool: (input: {
      baseUrl: string;
      path?: string;
      method?: string;
      params?: HttpToolParam[];
      args?: Record<string, string | number | boolean | null>;
      headers?: Record<string, string>;
      bodyTemplate?: string;
      allowPrivateHosts?: boolean;
    }): Promise<{ ok: boolean; status?: number; statusText?: string; body?: string; error?: string }> =>
      ipcRenderer.invoke("httpTools:testTool", input),
  },

  voice: {
    transcribe: (base64Audio: string, format: string): Promise<string> =>
      ipcRenderer.invoke("voice:transcribe", base64Audio, format),
    synthesize: (text: string): Promise<{ audio: string; format: string }> =>
      ipcRenderer.invoke("voice:synthesize", text),
  },

  tasks: {
    list: (): Promise<TaskRow[]> => ipcRenderer.invoke("tasks:list"),
    create: (input: TaskCreateInput): Promise<TaskRow> => ipcRenderer.invoke("tasks:create", input),
    update: (id: string, patch: TaskUpdatePatch): Promise<TaskRow> => ipcRenderer.invoke("tasks:update", id, patch),
    complete: (id: string): Promise<TaskRow> => ipcRenderer.invoke("tasks:complete", id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke("tasks:delete", id),
    // Fires after an agent run completes or the scheduler processes a due task, since
    // Chrono's create_task/update_task/etc. tools and the scheduler's recordTaskRun both
    // write straight to the tasks table without going through the tasks:* handlers above —
    // same pattern as connectors.onUpdate above.
    onUpdate: (callback: () => void): (() => void) => subscribe("tasks:update", callback),
  },

  tokenUsage: {
    get: (filter: TokenUsageFilter): Promise<TokenUsageSummary> => ipcRenderer.invoke("tokenUsage:get", filter),
    daily: (): Promise<DailyTokenUsage[]> => ipcRenderer.invoke("tokenUsage:daily"),
    /** Usage per run, keyed by trace id. A trace with no logged calls is absent from the
     * result rather than zero-filled — see queryUsageByTraceIds. */
    byTraces: (traceIds: string[]): Promise<Record<string, TraceUsage>> =>
      ipcRenderer.invoke("tokenUsage:byTraces", traceIds),
    onUpdate: (callback: () => void): (() => void) => subscribe("tokenUsage:update", callback),
  },

  // Named appInfo rather than app: `ping` above already owns the app:ping channel, and a
  // bare `app` namespace reads as Electron's app object rather than facts about this build.
  appInfo: {
    get: (): Promise<AppInfo> => ipcRenderer.invoke("app:info"),
    storage: (): Promise<AppStorageInfo> => ipcRenderer.invoke("app:storageInfo"),
    stats: (): Promise<AppStats> => ipcRenderer.invoke("app:stats"),
    /** Resolves with the cache size remaining after the clear, so the UI can update in place. */
    clearCache: (): Promise<number> => ipcRenderer.invoke("app:clearCache"),
  },

  // Forwards renderer-side debug logs into the same userData/debug.log the main process
  // writes to, so a single file has the full story of a run in call order.
  dev: {
    log: (...args: unknown[]): void => {
      void ipcRenderer.invoke("devLog:write", ...args);
    },
  },
};

contextBridge.exposeInMainWorld("agentsAPI", agentsAPI);

export type AgentsAPI = typeof agentsAPI;
