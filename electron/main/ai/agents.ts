import type Database from "better-sqlite3";
import { Agent, MCPServerStdio, tool, type Tool } from "@openai/agents";
import { z } from "zod";
import orchestratorPrompt from "./prompts/orchestrator.md?raw";
import configAgentPrompt from "./prompts/configAgent.md?raw";
import knowledgeAgentPrompt from "./prompts/knowledgeAgent.md?raw";
import explorerPrompt from "./prompts/explorer.md?raw";
import taskAgentPrompt from "./prompts/taskAgent.md?raw";
import { listKnowledgebaseFilesTool, readKnowledgebaseFileTool } from "./tools/knowledgeAgentTools";
import { webSearchTool, fetchWebContentTool } from "./tools/explorerAgentTools";
import { searchHistoryTool } from "./tools/history";
import { listGrantedFoldersTool, listFolderContentsTool, readFolderFileTool } from "./tools/folderAccessTools";
import { findSkillTool } from "./tools/skillFinderTool";
import { createSaveUserInfoTool } from "./tools/userInfoTools";
import {
  createDeleteAgentDataTool,
  createGetAgentDataTool,
  createListAgentDataTool,
  createSaveAgentDataTool,
} from "./tools/agentDataTools";
import {
  cancelTaskTool,
  completeTaskTool,
  createTaskTool,
  deleteTaskTool,
  listTasksTool,
  updateTaskTool,
} from "./tools/taskAgentTools";
import { formatUserInfoForPrompt, readUserInfoFacts } from "./userInfoStore";
import defaultAgentsConfig from "./defaultAgents.json";
import { getDb } from "../db";
import { getSetting, setSetting } from "../db/settingsStore";
import { MODEL_ID_PATTERN, validateSettingValue } from "../settingsSchema";
import { getCurrentLocation } from "../ipc/location";
import { encryptSecret } from "../security/secretStorage";
import { connectMcpServersForAgent } from "./mcp";
import { buildHttpToolsForCollectionIds, buildHttpToolsPromptBlock } from "./httpTools";
import { devLog } from "../devLog";
import { CONNECTOR_REGISTRY, getConnectorDefinition } from "../connectors/registry";
import { runOAuthFlow } from "../connectors/oauthFlow";
import {
  listConnectors,
  getConnector,
  getDecryptedCredentials,
  getDecryptedSettings,
  saveConnectorCredentials,
  disconnectConnector,
} from "../db/connectorsStore";

export const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_AGENT_DESCRIPTION = "Your personal AI orchestrator.";
// Mirrors the same-named private constants in provider.ts (not exported from there,
// and importing them would pull provider.ts's OpenAI-client setup into this module for
// no reason) — only used here as get_settings' display defaults, same values.
const DEFAULT_VOICE_TRANSCRIPTION_MODEL = "whisper-1";
const DEFAULT_VOICE_TTS_MODEL = "tts-1";

// Prompts are seeded/imported with {{agentName}}/{{userName}}/{{currentDateTime}}
// placeholders still in them so a rename doesn't require rewriting stored prompt text —
// substitution happens live at Agent-build time, using whatever settings currently hold.
function renderPrompt(
  template: string,
  vars: { agentName: string; userName: string; currentDateTime: string }
): string {
  return template
    .replace(/{{agentName}}/g, vars.agentName)
    .replace(/{{userName}}/g, vars.userName || "the user")
    .replace(/{{currentDateTime}}/g, vars.currentDateTime);
}

// Uses the machine's own locale/timezone (the same one the user is sitting in) rather
// than UTC or a hardcoded locale — this is what actually fixes the model reporting a
// stale training-cutoff date instead of today's real date.
function getCurrentDateTime(): string {
  return new Date().toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Accepts a plain native model id ("gpt-4.1-mini") or an OpenRouter-style "provider/model"
// id — a loose shape check, not an allowlist of real providers/models, since a user can
// point the Chat section at OpenAI, OpenRouter, or any other OpenAI-compatible host.
// Defined in settingsSchema.ts so the settings model fields and an agent's own `model` column
// are held to one shape rather than two copies of the same regex drifting apart.

// Prompt .md files are statically imported (required by the `?raw` Vite transform,
// which can't resolve a dynamic path) and looked up here by the `promptKey` each
// default-agent config entry declares in defaultAgents.json.
const PROMPTS_BY_KEY: Record<string, string> = {
  configAgent: configAgentPrompt,
  knowledgeAgent: knowledgeAgentPrompt,
  explorerAgent: explorerPrompt,
  taskAgent: taskAgentPrompt,
};

interface DefaultAgentConfig {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  model: string;
  tools: string[];
  promptKey: string;
  system: boolean;
}

export interface AgentRow {
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
  http_tool_collection_ids: string;
}

export interface AgentUpdatePatch {
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

export interface AgentCreateInput {
  name: string;
  icon?: string;
  tagline?: string;
  description?: string;
  model?: string;
  prompt?: string;
}

// Portable, machine-independent agent definition used by export/import — deliberately
// excludes id/system/enabled/created_at/mcp_server_ids so an exported file never carries
// this install's ids or MCP server attachments (which wouldn't resolve on another machine).
export interface AgentExport {
  name: string;
  icon: string;
  tagline: string;
  description: string;
  model: string;
  prompt: string;
}

// Loops over defaultAgents.json rather than one hardcoded INSERT per agent — new
// default agents are added by extending that file (+ a prompt .md + a PROMPTS_BY_KEY
// entry), not by editing this function. Idempotent per-agent, same as the old
// single-agent guard, so it's safe to call on every read for both fresh and
// already-seeded installs.
function ensureDefaultAgentsSeeded(db: Database.Database): void {
  const insert = db.prepare(
    "INSERT INTO agents (id, name, icon, tagline, description, prompt, model, tools, system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const entry of defaultAgentsConfig as DefaultAgentConfig[]) {
    const existing = db.prepare("SELECT id FROM agents WHERE id = ?").get(entry.id);
    if (existing) continue;
    const prompt = PROMPTS_BY_KEY[entry.promptKey];
    if (!prompt) {
      throw new Error(`No prompt registered for promptKey "${entry.promptKey}" (agent "${entry.id}")`);
    }
    insert.run(
      entry.id,
      entry.name,
      entry.icon,
      entry.tagline,
      entry.description,
      prompt,
      entry.model,
      JSON.stringify(entry.tools),
      entry.system ? 1 : 0
    );
  }
}

// Only attached to ConfigAgent's Agent instance below — the orchestrator has no tools
// of its own, so it structurally cannot call this even if it wanted to; it can only
// hand off to ConfigAgent. orchestratorEnabled is deliberately absent — the
// orchestrator can't be disabled (see ipc/settings.ts).
// Every user-facing toggle/field in AgentsSettings (src/lib/settings.ts) belongs here
// except onboardingDone (internal lifecycle flag, not a user setting) and
// orchestratorEnabled (permanently locked — see ipc/settings.ts's LOCKED_KEYS) — anything
// missing from this list is invisible/unreachable to Cipher regardless of what the user
// asks for, which is exactly the bug this list previously had (bgMusicEnabled,
// soundFxEnabled, voiceOutputEnabled, voiceTranscriptionModel, voiceTtsModel were all
// silently absent).
const ALLOWED_SETTING_KEYS = [
  "voiceInputEnabled",
  "typeAnywhereEnabled",
  "locationEnabled",
  "bgMusicEnabled",
  "soundFxEnabled",
  "voiceOutputEnabled",
  "chatApiKey",
  "chatApiUrl",
  "voiceApiKey",
  "voiceApiUrl",
  "voiceTranscriptionModel",
  "voiceTtsModel",
  "agentName",
  "agentDescription",
  "userName",
  "orchestratorModel",
  "httpToolApprovalPost",
  "httpToolApprovalPutPatch",
  "httpToolApprovalDelete",
  "toolApprovalDisplay",
] as const;

const SENSITIVE_SETTING_KEYS = ["chatApiKey", "voiceApiKey"];

// What a valid value looks like for each key — booleans, enums like toolApprovalDisplay, and
// the model-id fields — now lives in settingsSchema.ts, shared with the settings:update IPC
// handler. The list above stays here because it is this path's own concern: what ConfigAgent is
// allowed to touch is a much shorter list than what the user can edit in Settings.

const getSettingsTool = tool({
  name: "get_settings",
  description:
    "View the app's current settings: voiceInputEnabled, typeAnywhereEnabled, locationEnabled, bgMusicEnabled, soundFxEnabled, voiceOutputEnabled, agentName, agentDescription, userName, orchestratorModel, voiceTranscriptionModel, voiceTtsModel, chatApiUrl, voiceApiUrl, whether the Chat/Voice API keys are set (the key values themselves are never exposed), and the HTTP-tool approval policy (httpToolApprovalPost, httpToolApprovalPutPatch, httpToolApprovalDelete, toolApprovalDisplay).",
  parameters: z.object({}),
  execute: async () => {
    devLog("[get_settings] called");
    const agentName = getSetting<string>("appSettings.agentName", "Orbit");
    const agentDescription = getSetting<string>("appSettings.agentDescription", DEFAULT_AGENT_DESCRIPTION);
    const userName = getSetting<string>("appSettings.userName", "");
    const orchestratorModel = getSetting<string>("appSettings.orchestratorModel", DEFAULT_MODEL) || DEFAULT_MODEL;
    const voiceInputEnabled = getSetting<boolean>("appSettings.voiceInputEnabled", false);
    const typeAnywhereEnabled = getSetting<boolean>("appSettings.typeAnywhereEnabled", false);
    const locationEnabled = getSetting<boolean>("appSettings.locationEnabled", false);
    const bgMusicEnabled = getSetting<boolean>("appSettings.bgMusicEnabled", false);
    const soundFxEnabled = getSetting<boolean>("appSettings.soundFxEnabled", true);
    const voiceOutputEnabled = getSetting<boolean>("appSettings.voiceOutputEnabled", true);
    const voiceTranscriptionModel = getSetting<string>("appSettings.voiceTranscriptionModel", DEFAULT_VOICE_TRANSCRIPTION_MODEL);
    const voiceTtsModel = getSetting<string>("appSettings.voiceTtsModel", DEFAULT_VOICE_TTS_MODEL);
    const chatApiUrl = getSetting<string>("appSettings.chatApiUrl", "");
    const voiceApiUrl = getSetting<string>("appSettings.voiceApiUrl", "");
    const chatApiKey = getSetting<string | null>("appSettings.chatApiKey", null);
    const voiceApiKey = getSetting<string | null>("appSettings.voiceApiKey", null);
    const httpToolApprovalPost = getSetting<boolean>("appSettings.httpToolApprovalPost", true);
    const httpToolApprovalPutPatch = getSetting<boolean>("appSettings.httpToolApprovalPutPatch", true);
    const httpToolApprovalDelete = getSetting<boolean>("appSettings.httpToolApprovalDelete", true);
    const toolApprovalDisplay = getSetting<string>("appSettings.toolApprovalDisplay", "modal");
    return {
      httpToolApprovalPost,
      httpToolApprovalPutPatch,
      httpToolApprovalDelete,
      toolApprovalDisplay,
      agentName,
      agentDescription,
      userName,
      orchestratorModel,
      voiceInputEnabled,
      typeAnywhereEnabled,
      locationEnabled,
      bgMusicEnabled,
      soundFxEnabled,
      voiceOutputEnabled,
      voiceTranscriptionModel,
      voiceTtsModel,
      chatApiUrl,
      voiceApiUrl,
      chatApiKeySet: Boolean(chatApiKey),
      voiceApiKeySet: Boolean(voiceApiKey),
    };
  },
});

const updateSettingTool = tool({
  name: "update_setting",
  description:
    "Update one of the app's settings: voiceInputEnabled, typeAnywhereEnabled, locationEnabled, bgMusicEnabled, soundFxEnabled, voiceOutputEnabled, chatApiKey, chatApiUrl, voiceApiKey, voiceApiUrl, voiceTranscriptionModel, voiceTtsModel, agentName, agentDescription, userName, orchestratorModel, httpToolApprovalPost, httpToolApprovalPutPatch, httpToolApprovalDelete (whether that HTTP method pauses to ask the user first), toolApprovalDisplay (\"modal\" or \"inline\").",
  parameters: z.object({
    key: z.enum(ALLOWED_SETTING_KEYS),
    value: z.union([z.string(), z.boolean()]),
  }),
  execute: async ({ key, value }) => {
    const isSensitive = SENSITIVE_SETTING_KEYS.includes(key);
    devLog(`[update_setting] called with key=${key} value=${isSensitive ? "(redacted)" : value}`);

    // One shared definition of a valid value, so a value this path would reject cannot get in
    // through settings:update instead — which is exactly what used to happen, since that
    // handler validated nothing at all.
    const result = validateSettingValue(key, value);
    if (!result.ok) throw new Error(`${key} ${result.reason}.`);

    // An extra rule for this path only: the schema treats "" as a legal way to clear a field,
    // but an agent must not be able to blank a setting. Wiping an API key or a prompt is a
    // deliberate act that belongs in Settings, not something a misread instruction can do.
    if (typeof result.value === "string" && result.value.length === 0) {
      throw new Error(`${key} cannot be empty.`);
    }

    const stored = isSensitive && typeof result.value === "string" ? encryptSecret(result.value) : result.value;
    setSetting(`appSettings.${key}`, stored);
    // Never log the raw value for an API key — only confirm the write happened.
    devLog(`[update_setting] appSettings.${key} = ${isSensitive ? "(redacted)" : result.value}`);
    return `Updated ${key}.`;
  },
});

const createAgentTool = tool({
  name: "create_agent",
  description:
    "Create a new custom agent with a name, tagline, description, and a full system prompt you've already drafted. Only call this after confirming a plain-language summary of the new agent with the user.",
  parameters: z.object({
    name: z.string(),
    tagline: z.string(),
    description: z.string(),
    prompt: z.string(),
    model: z.string().nullable(),
  }),
  execute: async ({ name, tagline, description, prompt, model }) => {
    devLog(`[create_agent] called with name="${name}" model=${model ?? "(default)"}`);
    const created = createAgent({
      name,
      tagline,
      description,
      prompt,
      model: model ?? undefined,
    });
    devLog(`[create_agent] created id=${created.id}`);
    return { id: created.id, name: created.name };
  },
});

interface UpdateAgentToolArgs {
  name: string | null;
  tagline: string | null;
  description: string | null;
  prompt: string | null;
  model: string | null;
  enabled: boolean | null;
  mcpServerIds: string[] | null;
  connectorIds: string[] | null;
}

// The update_agent tool's params are all nullable (rather than optional) because the
// zod-to-JSON-schema conversion requires every top-level key present — `null` is how
// the model expresses "leave this field untouched", translated here into the `undefined`
// that AgentUpdatePatch actually treats as "don't touch". Exported/pure so this mapping
// is unit-testable without invoking the SDK's tool-calling machinery.
export function buildUpdateAgentPatch(args: UpdateAgentToolArgs): AgentUpdatePatch {
  const patch: AgentUpdatePatch = {};
  if (args.name !== null) patch.name = args.name;
  if (args.tagline !== null) patch.tagline = args.tagline;
  if (args.description !== null) patch.description = args.description;
  if (args.prompt !== null) patch.prompt = args.prompt;
  if (args.model !== null) patch.model = args.model;
  if (args.enabled !== null) patch.enabled = args.enabled;
  if (args.mcpServerIds !== null) patch.mcpServerIds = args.mcpServerIds;
  if (args.connectorIds !== null) patch.connectorIds = args.connectorIds;
  return patch;
}

const updateAgentTool = tool({
  name: "update_agent",
  description:
    "Update an existing agent's name, tagline, description, prompt, model, enabled state, connected MCP servers, or connected connectors (e.g. Gmail). Only call this after confirming the specific change(s) with the user in plain language. Use list_agents first if you need to find the agent's id or see its current fields. Note: system agents cannot be disabled.",
  parameters: z.object({
    id: z.string(),
    name: z.string().nullable(),
    tagline: z.string().nullable(),
    description: z.string().nullable(),
    prompt: z.string().nullable(),
    model: z.string().nullable(),
    enabled: z.boolean().nullable(),
    mcpServerIds: z.array(z.string()).nullable(),
    connectorIds: z.array(z.string()).nullable(),
  }),
  execute: async ({ id, ...rest }) => {
    const patch = buildUpdateAgentPatch(rest);
    devLog(`[update_agent] called with id="${id}" fields=${Object.keys(patch).join(",")}`);
    const updated = updateAgent(id, patch);
    devLog(`[update_agent] updated id=${updated.id}`);
    return { id: updated.id, name: updated.name };
  },
});

const listAgentsTool = tool({
  name: "list_agents",
  description:
    "List all agents (system and custom) with their id, name, tagline, description, model, enabled state, MCP server ids, and connector ids. Use this to find an agent's id before calling update_agent, or to check its current details.",
  parameters: z.object({}),
  execute: async () => {
    const db = getDb();
    return db
      .prepare(
        "SELECT id, name, tagline, description, model, enabled, system, mcp_server_ids, connector_ids FROM agents"
      )
      .all();
  },
});

const listConnectorsTool = tool({
  name: "list_connectors",
  description:
    "List every available connector (e.g. Gmail) with its connection status and, if connected, which account. Use this before connect_connector/disconnect_connector or attach_connector_to_agent.",
  parameters: z.object({}),
  execute: async () => {
    const connected = new Map(listConnectors().map((row) => [row.id, row]));
    return CONNECTOR_REGISTRY.map((def) => {
      const row = connected.get(def.id);
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        status: row?.status ?? "disconnected",
        accountLabel: row?.account_label ?? null,
      };
    });
  },
});

const connectConnectorTool = tool({
  name: "connect_connector",
  description:
    "Start connecting a service (e.g. Gmail) by opening the OAuth consent screen in the user's system browser and waiting for them to approve it. Only call this after confirming with the user which service to connect. Does not attach the connector to any agent — use attach_connector_to_agent afterward.",
  parameters: z.object({ connectorId: z.string() }),
  execute: async ({ connectorId }) => {
    const definition = getConnectorDefinition(connectorId);
    if (!definition) {
      throw new Error(`Unknown connector: ${connectorId}`);
    }
    devLog(`[connect_connector] starting OAuth flow for ${connectorId}`);
    if (!definition.buildOAuthConfig) {
      throw new Error(`Connector "${connectorId}" is authType "oauth2" but has no buildOAuthConfig — this is a connector implementation bug.`);
    }
    const config = definition.buildOAuthConfig(getDecryptedSettings(connectorId));
    const tokens = await runOAuthFlow(config);
    saveConnectorCredentials(definition.id, definition.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    });
    devLog(`[connect_connector] ${connectorId} connected`);
    return `${definition.name} connected.`;
  },
});

const disconnectConnectorTool = tool({
  name: "disconnect_connector",
  description:
    "Disconnect a previously-connected service (e.g. Gmail). Removes it from every agent it was attached to.",
  parameters: z.object({ connectorId: z.string() }),
  execute: async ({ connectorId }) => {
    const definition = getConnectorDefinition(connectorId);
    if (!definition) {
      throw new Error(`Unknown connector: ${connectorId}`);
    }
    disconnectConnector(connectorId);
    devLog(`[disconnect_connector] ${connectorId} disconnected`);
    return `${definition.name} disconnected.`;
  },
});

function patchAgentConnectorIds(agentId: string, mutate: (ids: string[]) => string[]): AgentRow {
  const existing = listAgents().find((row) => row.id === agentId);
  if (!existing) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
  const current = parseConnectorIds(existing);
  return updateAgent(agentId, { connectorIds: mutate(current) });
}

const attachConnectorToAgentTool = tool({
  name: "attach_connector_to_agent",
  description:
    "Attach an already-connected connector (e.g. Gmail) to a specific agent, giving that agent's chat turns access to its tools (e.g. sending email). The connector must already be connected — use connect_connector first if it isn't. Use list_agents to find the target agent's id.",
  parameters: z.object({ agentId: z.string(), connectorId: z.string() }),
  execute: async ({ agentId, connectorId }) => {
    if (!getConnectorDefinition(connectorId)) {
      throw new Error(`Unknown connector: ${connectorId}`);
    }
    if (!getConnector(connectorId) || getConnector(connectorId)?.status !== "connected") {
      throw new Error(`${connectorId} isn't connected yet — call connect_connector first.`);
    }
    const updated = patchAgentConnectorIds(agentId, (ids) => (ids.includes(connectorId) ? ids : [...ids, connectorId]));
    devLog(`[attach_connector_to_agent] attached ${connectorId} to ${agentId}`);
    return { id: updated.id, name: updated.name, connectorIds: JSON.parse(updated.connector_ids) };
  },
});

const detachConnectorFromAgentTool = tool({
  name: "detach_connector_from_agent",
  description: "Remove a connector from a specific agent, without disconnecting the service itself.",
  parameters: z.object({ agentId: z.string(), connectorId: z.string() }),
  execute: async ({ agentId, connectorId }) => {
    const updated = patchAgentConnectorIds(agentId, (ids) => ids.filter((id) => id !== connectorId));
    devLog(`[detach_connector_from_agent] detached ${connectorId} from ${agentId}`);
    return { id: updated.id, name: updated.name, connectorIds: JSON.parse(updated.connector_ids) };
  },
});

const getCurrentLocationTool = tool({
  name: "get_current_location",
  description:
    "Get the user's approximate last known location (city-level latitude/longitude, from an IP-based lookup — not GPS-precise), if location access is enabled in Settings.",
  parameters: z.object({}),
  execute: async () => {
    const enabled = getSetting<boolean>("appSettings.locationEnabled", false);
    if (!enabled) return "Location access is disabled in Settings.";
    const location = getCurrentLocation();
    if (!location) return "No location available yet — the app hasn't captured the user's location this session.";
    return location;
  },
});

/** Returns the user's saved override if set (via Settings → Agents), else the built-in orchestrator.md template. */
function getOrchestratorPromptTemplate(): string {
  const override = getSetting<string>("appSettings.orchestratorPromptOverride", "");
  return override.trim().length > 0 ? override : orchestratorPrompt;
}

export function getOrchestratorPrompt(): string {
  const agentName = getSetting<string>("appSettings.agentName", "Orbit");
  const userName = getSetting<string>("appSettings.userName", "");
  return renderPrompt(getOrchestratorPromptTemplate(), { agentName, userName, currentDateTime: getCurrentDateTime() });
}

export function listAgents(): AgentRow[] {
  const db = getDb();
  ensureDefaultAgentsSeeded(db);
  return db.prepare("SELECT * FROM agents").all() as AgentRow[];
}

/** listAgentsForDisplay()'s return shape: every AgentRow field plus derived,
 * non-persisted fields for the orbit UI's hover tooltip / info modal. */
export interface AgentDisplayRow extends AgentRow {
  toolNames: string[];
  connectorToolCount: number;
}

// Stored prompts keep {{agentName}}/{{userName}}/{{currentDateTime}} placeholders
// literally (see renderPrompt) — rendered here so the read-only Settings → AI display
// shows the live name instead of the raw template.
export function listAgentsForDisplay(): AgentDisplayRow[] {
  const agentName = getSetting<string>("appSettings.agentName", "Orbit");
  const userName = getSetting<string>("appSettings.userName", "");
  const currentDateTime = getCurrentDateTime();
  return listAgents().map((row) => ({
    ...row,
    prompt: renderPrompt(row.prompt, { agentName, userName, currentDateTime }),
    toolNames: getBuiltinToolNamesForRole(row),
    connectorToolCount:
      parseMcpServerIds(row).length + parseConnectorIds(row).length + parseHttpToolCollectionIds(row).length,
  }));
}

export function updateAgent(id: string, patch: AgentUpdatePatch): AgentRow {
  const db = getDb();
  ensureDefaultAgentsSeeded(db);
  const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    throw new Error(`Unknown agent: ${id}`);
  }
  // System agents (Cipher, Atlas) can't be disabled — name/tagline/prompt are otherwise
  // fully editable for every agent, system or not.
  if (patch.enabled === false && existing.system) {
    throw new Error(`${existing.name} is a system agent and cannot be disabled.`);
  }
  // Blank model field means "use the default" rather than being rejected; anything
  // else must match the same shape createAgent enforces, otherwise a bad model id
  // silently persists here and only surfaces later as an opaque provider-side error.
  const nextModel = patch.model === undefined ? existing.model : patch.model.trim() || DEFAULT_MODEL;
  if (!MODEL_ID_PATTERN.test(nextModel)) {
    throw new Error(`"${nextModel}" doesn't look like a valid model ID (expected "model" or "provider/model").`);
  }
  // Unlike the other optional fields, an explicitly-supplied but blank name is rejected
  // rather than silently kept — otherwise a caller (e.g. Cipher's update_agent tool)
  // could report success while actually leaving the name unchanged.
  if (patch.name !== undefined && patch.name.trim().length === 0) {
    throw new Error("Agent name cannot be blank.");
  }
  const next = {
    name: patch.name === undefined ? existing.name : patch.name.trim(),
    tagline: patch.tagline === undefined ? existing.tagline : patch.tagline.trim(),
    description: patch.description === undefined ? existing.description : patch.description.trim(),
    prompt: patch.prompt === undefined ? existing.prompt : patch.prompt,
    model: nextModel,
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
    mcp_server_ids: patch.mcpServerIds === undefined ? existing.mcp_server_ids : JSON.stringify(patch.mcpServerIds),
    connector_ids: patch.connectorIds === undefined ? existing.connector_ids : JSON.stringify(patch.connectorIds),
    http_tool_collection_ids:
      patch.httpToolCollectionIds === undefined
        ? existing.http_tool_collection_ids
        : JSON.stringify(patch.httpToolCollectionIds),
  };
  db.prepare(
    "UPDATE agents SET name = ?, tagline = ?, description = ?, prompt = ?, model = ?, enabled = ?, mcp_server_ids = ?, connector_ids = ?, http_tool_collection_ids = ? WHERE id = ?"
  ).run(
    next.name,
    next.tagline,
    next.description,
    next.prompt,
    next.model,
    next.enabled,
    next.mcp_server_ids,
    next.connector_ids,
    next.http_tool_collection_ids,
    id
  );
  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
}

// Generates a short, URL/id-safe slug from a display name (lowercase, hyphenated,
// stripped of anything outside [a-z0-9-]). Falls back to "agent" if the name has no
// usable characters (e.g. all emoji/symbols) so callers always get a non-empty base.
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agent";
}

// Custom agents are user-named, so collisions with existing ids (built-in or
// previously created) are expected — appends "-2", "-3", … until free.
function uniqueAgentId(db: Database.Database, base: string): string {
  let candidate = base;
  let suffix = 2;
  while (db.prepare("SELECT id FROM agents WHERE id = ?").get(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function createAgent(input: AgentCreateInput): AgentRow {
  const db = getDb();
  ensureDefaultAgentsSeeded(db);

  const name = input.name.trim();
  if (!name) {
    throw new Error("Agent name is required.");
  }
  const model = input.model?.trim() || DEFAULT_MODEL;
  if (!MODEL_ID_PATTERN.test(model)) {
    throw new Error(`"${model}" doesn't look like a valid model ID (expected "model" or "provider/model").`);
  }

  const id = uniqueAgentId(db, slugify(name));
  const icon = input.icon?.trim() || "ti-robot";
  const tagline = input.tagline?.trim() ?? "";
  const description = input.description?.trim() ?? "";
  const prompt = input.prompt?.trim() ?? "";

  db.prepare(
    "INSERT INTO agents (id, name, icon, tagline, description, prompt, model, tools, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, name, icon, tagline, description, prompt, model, "[]", 1);

  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
}

// System agents can't be deleted, mirroring the existing "can't be disabled" guard in
// updateAgent — deleting a built-in would break buildOrchestrator's hardcoded lookups.
export function deleteAgent(id: string): void {
  const db = getDb();
  ensureDefaultAgentsSeeded(db);
  const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    throw new Error(`Unknown agent: ${id}`);
  }
  if (existing.system) {
    throw new Error(`${existing.name} is a system agent and cannot be deleted.`);
  }
  db.prepare("DELETE FROM agents WHERE id = ?").run(id);
}

function toAgentExport(row: AgentRow): AgentExport {
  return {
    name: row.name,
    icon: row.icon,
    tagline: row.tagline,
    description: row.description,
    model: row.model,
    prompt: row.prompt,
  };
}

export function exportAgent(id: string): AgentExport {
  const db = getDb();
  ensureDefaultAgentsSeeded(db);
  const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    throw new Error(`Unknown agent: ${id}`);
  }
  if (existing.system) {
    throw new Error(`${existing.name} is a system agent and cannot be exported.`);
  }
  return toAgentExport(existing);
}

export function exportAllAgents(): AgentExport[] {
  const db = getDb();
  ensureDefaultAgentsSeeded(db);
  // Filters on the `system` column itself (same source of truth deleteAgent/exportAgent/
  // updateAgent already guard on) rather than a hardcoded id list, so a future system
  // agent can't accidentally leak into "Export All" just because this list wasn't updated.
  const rows = db.prepare("SELECT * FROM agents WHERE system = 0").all() as AgentRow[];
  return rows.map(toAgentExport);
}

// Routed through createAgent rather than a raw insert so id generation, model
// validation, and defaults stay single-sourced — an imported file's own id/system/
// enabled fields (if present) are ignored, never trusted.
export function importAgent(input: AgentExport): AgentRow {
  return createAgent({
    name: input.name,
    icon: input.icon,
    tagline: input.tagline,
    description: input.description,
    model: input.model,
    prompt: input.prompt,
  });
}

function parseMcpServerIds(row: AgentRow): string[] {
  try {
    const ids = JSON.parse(row.mcp_server_ids) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function parseConnectorIds(row: AgentRow): string[] {
  try {
    const ids = JSON.parse(row.connector_ids) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function parseHttpToolCollectionIds(row: AgentRow): string[] {
  try {
    const ids = JSON.parse(row.http_tool_collection_ids) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Builds the real tool() objects for every HTTP tool collection attached to one agent
 * row — the HTTP-tool counterpart of attachConnectorsForRow. */
export function attachHttpToolsForRow(row: AgentRow): Tool[] {
  return buildHttpToolsForCollectionIds(parseHttpToolCollectionIds(row));
}

/** The prompt block naming this agent's attached HTTP tools. Appended to instructions the
 * same way userInfoBlock/agentDataContext are — attached tools otherwise reach the model
 * only as tool descriptions, with nothing in the prompt saying they exist. */
export function httpToolsPromptForRow(row: AgentRow): string {
  return buildHttpToolsPromptBlock(parseHttpToolCollectionIds(row));
}

/** Builds the real tool() objects for a list of connector ids. A connector id that's
 * attached but no longer connected (disconnected since, or an unknown/removed connector
 * type) is skipped rather than failing the whole agent build — same "one bad attachment
 * must never take down the run" precedent as connectMcpServersForAgent's per-server
 * try/catch. */
export function attachConnectorsForIds(connectorIds: string[]): Tool[] {
  const tools: Tool[] = [];
  for (const connectorId of connectorIds) {
    const definition = getConnectorDefinition(connectorId);
    if (!definition) continue;
    const credentials = getDecryptedCredentials(connectorId);
    if (!credentials) continue;
    tools.push(...definition.buildTools(credentials));
  }
  return tools;
}

/** Builds the real tool() objects for every connector attached to one agent row. */
export function attachConnectorsForRow(row: AgentRow): Tool[] {
  return attachConnectorsForIds(parseConnectorIds(row));
}

/** Static tool-name manifest for one agent row, mirroring the exact `tools: [...]`
 * arrays buildOrchestrator() hardcodes per role below — kept as `.name` lookups against
 * the same imported tool objects (not a separately maintained list) so it can't silently
 * drift out of sync with what an agent run actually attaches. Connector/MCP-attached
 * tools are excluded (those are only resolvable by live-connecting, see
 * attachConnectorsForRow) — callers show a separate attached-connector count instead. */
export function getBuiltinToolNamesForRole(row: AgentRow): string[] {
  if (row.id === "configAgent") {
    return [
      getSettingsTool,
      updateSettingTool,
      createAgentTool,
      updateAgentTool,
      listAgentsTool,
      findSkillTool,
      createSaveUserInfoTool(row.name),
      listConnectorsTool,
      connectConnectorTool,
      disconnectConnectorTool,
      attachConnectorToAgentTool,
      detachConnectorFromAgentTool,
    ].map((t) => t.name);
  }
  if (row.id === "knowledgeAgent") {
    return [
      listKnowledgebaseFilesTool,
      readKnowledgebaseFileTool,
      createSaveUserInfoTool(row.name),
      listGrantedFoldersTool,
      listFolderContentsTool,
      readFolderFileTool,
    ].map((t) => t.name);
  }
  if (row.id === "explorerAgent") {
    return [webSearchTool, fetchWebContentTool, createSaveUserInfoTool(row.name)].map((t) => t.name);
  }
  if (row.id === "taskAgent") {
    return [
      createTaskTool,
      listTasksTool,
      updateTaskTool,
      completeTaskTool,
      cancelTaskTool,
      deleteTaskTool,
      createSaveUserInfoTool(row.name),
    ].map((t) => t.name);
  }
  return [
    createSaveUserInfoTool(row.name),
    createSaveAgentDataTool(row.id),
    createGetAgentDataTool(row.id),
    createListAgentDataTool(row.id),
    createDeleteAgentDataTool(row.id),
  ].map((t) => t.name);
}

export interface BuiltOrchestrator {
  agent: Agent;
  mcpServers: MCPServerStdio[];
  /** Every agent (system + custom) built this pass, orchestrator excluded — lets a
   * caller run a single agent directly (deterministic `/agentname` routing) instead of
   * going through the orchestrator's own handoff judgment. Matched by name, case-insensitively,
   * by the caller (see electron/main/ipc/agent.ts's agent:runStream). */
  allAgents: Agent[];
}

/** Rebuilt fresh on every agent:run/agent:runStream call (nothing is cached across runs
 * — see electron/main/ipc/agent.ts). Any MCP server connected here for an agent's own
 * `mcp_server_ids` must be closed by the caller after the run completes (`mcpServers`
 * collects every server connected across every agent, orchestrator included, so one
 * `closeMcpServers(result.mcpServers)` in a `finally` covers all of them). */
export async function buildOrchestrator(): Promise<BuiltOrchestrator> {
  const db = getDb();
  ensureDefaultAgentsSeeded(db);

  const agentName = getSetting<string>("appSettings.agentName", "Orbit");
  const userName = getSetting<string>("appSettings.userName", "");
  const orchestratorModel = getSetting<string>("appSettings.orchestratorModel", DEFAULT_MODEL) || DEFAULT_MODEL;
  const orchestratorMcpServerIds = getSetting<string[]>("appSettings.orchestratorMcpServerIds", []);
  const orchestratorConnectorIds = getSetting<string[]>("appSettings.orchestratorConnectorIds", []);
  const orchestratorHttpToolCollectionIds = getSetting<string[]>(
    "appSettings.orchestratorHttpToolCollectionIds",
    []
  );
  const promptVars = { agentName, userName, currentDateTime: getCurrentDateTime() };

  const allConnected: MCPServerStdio[] = [];
  const connectForRow = async (row: AgentRow): Promise<MCPServerStdio[]> => {
    const servers = await connectMcpServersForAgent(parseMcpServerIds(row));
    allConnected.push(...servers);
    return servers;
  };

  // Accumulated facts the user has shared during past agent-creation sessions (see
  // ai/userInfoStore.ts), folded into every agent's instructions below — none of the
  // built-in prompt .md files have a placeholder for this, so it's appended here
  // rather than requiring every prompt template to declare a {{userInfo}} token.
  const userInfoBlock = formatUserInfoForPrompt(readUserInfoFacts());

  // Custom agents are drafted freeform by Cipher and have no guarantee their text
  // includes {{currentDateTime}} the way every built-in prompt .md file already does
  // (confirmed: orchestrator.md, configAgent.md, knowledgeAgent.md, explorer.md all
  // already embed it) — so only custom-agent instructions get an explicit date line
  // appended here, to guarantee it without duplicating a date the built-ins already state.
  const dateContext = `\n\nThe current date and time is ${promptVars.currentDateTime} — trust this over any assumption from training data about what day it is.`;

  // Unlike save_user_info (documented with an explicit line in every built-in prompt .md —
  // see orchestrator.md/configAgent.md/knowledgeAgent.md/explorer.md), the agent-data CRUD
  // tools have no .md file to add a line to since custom-agent prompts are freeform text
  // drafted by Cipher — so this nudge is appended the same way dateContext is, to guarantee
  // every custom agent actually knows it has a private store instead of relying solely on
  // the model noticing the tool descriptions in its tool list.
  const agentDataContext =
    "\n\nYou have your own private data store, visible only to you: call save_agent_data to remember something " +
    "(e.g. a saved entry, a running total, a preference specific to your job) under a short key, get_agent_data " +
    "to recall it by that key, list_agent_data to see everything you've saved, and delete_agent_data to remove " +
    "an entry. Use this whenever you need to persist your own data across turns or conversations — no other " +
    "agent can read or change it.";

  // handoffDescription (an @openai/agents field, distinct from `instructions`) is what
  // the orchestrator actually sees on each generated "transfer_to_X" handoff tool — it's
  // the SDK-native way to keep routing guidance in sync with which agents genuinely exist
  // right now, rather than relying solely on the static prose in orchestrator.md (which
  // only describes the three fixed built-ins and has no way to know about custom agents).
  const configAgentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get("configAgent") as AgentRow;
  const configAgent = new Agent({
    name: configAgentRow.name,
    instructions: renderPrompt(configAgentRow.prompt, promptVars) + httpToolsPromptForRow(configAgentRow) + userInfoBlock,
    handoffDescription:
      "Manages app configuration: onboarding, settings (agent names, models, API keys, toggles) — including reading/checking a setting's current value, not just changing it — and creating new custom agents.",
    model: configAgentRow.model || DEFAULT_MODEL,
    tools: [
      getSettingsTool,
      updateSettingTool,
      createAgentTool,
      updateAgentTool,
      listAgentsTool,
      findSkillTool,
      createSaveUserInfoTool(configAgentRow.name),
      listConnectorsTool,
      connectConnectorTool,
      disconnectConnectorTool,
      attachConnectorToAgentTool,
      detachConnectorFromAgentTool,
      ...attachConnectorsForRow(configAgentRow),
      ...attachHttpToolsForRow(configAgentRow),
    ],
    mcpServers: await connectForRow(configAgentRow),
  });

  const knowledgeAgentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get("knowledgeAgent") as AgentRow;
  const knowledgeAgent = new Agent({
    name: knowledgeAgentRow.name,
    instructions:
      renderPrompt(knowledgeAgentRow.prompt, promptVars) + httpToolsPromptForRow(knowledgeAgentRow) + userInfoBlock,
    handoffDescription:
      "Reads and searches the user's knowledge base documents (resumes, notes, reference material) for anything a personal document might answer, and browses/reads the local folders the user has granted via the Folders widget.",
    model: knowledgeAgentRow.model || DEFAULT_MODEL,
    tools: [
      listKnowledgebaseFilesTool,
      readKnowledgebaseFileTool,
      createSaveUserInfoTool(knowledgeAgentRow.name),
      listGrantedFoldersTool,
      listFolderContentsTool,
      readFolderFileTool,
      ...attachConnectorsForRow(knowledgeAgentRow),
      ...attachHttpToolsForRow(knowledgeAgentRow),
    ],
    mcpServers: await connectForRow(knowledgeAgentRow),
  });

  const explorerAgentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get("explorerAgent") as AgentRow;
  const explorerAgent = new Agent({
    name: explorerAgentRow.name,
    instructions:
      renderPrompt(explorerAgentRow.prompt, promptVars) + httpToolsPromptForRow(explorerAgentRow) + userInfoBlock,
    handoffDescription:
      "Searches the live web for current information: news, comparisons, products, or anything about the outside world that needs up-to-date data rather than the user's own documents.",
    model: explorerAgentRow.model || DEFAULT_MODEL,
    tools: [
      webSearchTool,
      fetchWebContentTool,
      createSaveUserInfoTool(explorerAgentRow.name),
      ...attachConnectorsForRow(explorerAgentRow),
      ...attachHttpToolsForRow(explorerAgentRow),
    ],
    mcpServers: await connectForRow(explorerAgentRow),
  });

  // Any other enabled row is a user-created custom agent — no built-in tools of its own
  // (unlike ConfigAgent/KnowledgeAgent/Explorer above) beyond save_user_info and its own
  // private agent-data CRUD tools, just a plain delegate built from its stored prompt/model,
  // plus whatever MCP servers the user attached to it. Without this, an agent like a
  // user-created "Astrologer" had no way to persist a fact it depends on (e.g. birth date)
  // and would re-ask for it every single conversation — save_user_info lets it save that
  // once, for itself and every other agent, while the agent-data tools (save/get/list/delete,
  // bound to row.id) give it a private per-agent store for its own structured data (e.g. a
  // budget agent's saved entries) that other agents can't read.
  // Its handoffDescription comes straight from whatever the user (via Cipher) set as its
  // tagline/description, so routing guidance appears/disappears with the agent itself —
  // no orchestrator.md edits needed as custom agents are added, edited, or removed.
  const taskAgentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get("taskAgent") as AgentRow;
  const taskAgent = new Agent({
    name: taskAgentRow.name,
    instructions: renderPrompt(taskAgentRow.prompt, promptVars) + httpToolsPromptForRow(taskAgentRow) + userInfoBlock,
    handoffDescription:
      "Manages reminders and prompt tasks — one-shot or recurring, with dynamic parameters substituted at run time — and notifies the user when they're due.",
    model: taskAgentRow.model || DEFAULT_MODEL,
    tools: [
      createTaskTool,
      listTasksTool,
      updateTaskTool,
      completeTaskTool,
      cancelTaskTool,
      deleteTaskTool,
      createSaveUserInfoTool(taskAgentRow.name),
      ...attachConnectorsForRow(taskAgentRow),
      ...attachHttpToolsForRow(taskAgentRow),
    ],
    mcpServers: await connectForRow(taskAgentRow),
  });

  const customRows = db
    .prepare(
      "SELECT * FROM agents WHERE id NOT IN ('configAgent', 'knowledgeAgent', 'explorerAgent', 'taskAgent') AND enabled = 1"
    )
    .all() as AgentRow[];
  const customAgents = await Promise.all(
    customRows.map(async (row) => {
      const mcpServers = await connectForRow(row);
      return new Agent({
        name: row.name,
        instructions:
          renderPrompt(row.prompt, promptVars) +
          dateContext +
          agentDataContext +
          httpToolsPromptForRow(row) +
          userInfoBlock,
        handoffDescription: row.description || row.tagline || `Handles requests related to ${row.name}.`,
        model: row.model || DEFAULT_MODEL,
        tools: [
          createSaveUserInfoTool(row.name),
          createSaveAgentDataTool(row.id),
          createGetAgentDataTool(row.id),
          createListAgentDataTool(row.id),
          createDeleteAgentDataTool(row.id),
          ...attachConnectorsForRow(row),
          ...attachHttpToolsForRow(row),
        ],
        mcpServers,
      });
    })
  );

  const orchestratorMcpServers = await connectMcpServersForAgent(orchestratorMcpServerIds);
  allConnected.push(...orchestratorMcpServers);

  const orchestrator = new Agent({
    name: agentName,
    instructions:
      renderPrompt(getOrchestratorPromptTemplate(), promptVars) +
      buildHttpToolsPromptBlock(orchestratorHttpToolCollectionIds) +
      userInfoBlock,
    model: orchestratorModel,
    tools: [
      searchHistoryTool,
      getCurrentLocationTool,
      createSaveUserInfoTool(agentName),
      ...attachConnectorsForIds(orchestratorConnectorIds),
      ...buildHttpToolsForCollectionIds(orchestratorHttpToolCollectionIds),
    ],
    mcpServers: orchestratorMcpServers,
    handoffs: [configAgent, knowledgeAgent, explorerAgent, taskAgent, ...customAgents],
  });

  return {
    agent: orchestrator,
    mcpServers: allConnected,
    allAgents: [configAgent, knowledgeAgent, explorerAgent, taskAgent, ...customAgents],
  };
}
