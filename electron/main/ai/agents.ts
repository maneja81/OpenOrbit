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
import { createWriteChecklistTool } from "./tools/checklistTools";
import { createAskUserTool, type RequestAnswerFn } from "./tools/askUserTools";
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
import { modelForAgent } from "./provider";
import { findProvider } from "./providers";
import { formatUserInfoForPrompt, readUserInfoFacts } from "./userInfoStore";
import defaultAgentsConfig from "./defaultAgents.json";
import { getDb } from "../db";
import { setSetting } from "../db/settingsStore";
import { MODEL_ID_PATTERN, SETTING_DEFAULTS, validateSettingValue } from "../settingsSchema";
import { readAppSetting } from "../appSettings";
import { getCurrentLocation } from "../ipc/location";
import { encryptSecret } from "../security/secretStorage";
import { connectMcpServersForAgent } from "./mcp";
import { buildHttpToolsForCollectionIds, buildHttpToolsPromptBlock } from "./httpTools";
import { devLog } from "../devLog";
import { broadcastSettingsUpdate } from "./broadcastEvents";
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
import { parseIdList } from "../db/jsonColumn";

// Derived rather than re-declared: this used to be a fourth hand-maintained copy of the same
// string. Still exported because ipc/settings.ts uses it as the "blank means default" fallback
// when a model field is cleared. (skillDistill.ts keeps its own copy — that's finding S7.)
export const DEFAULT_MODEL = SETTING_DEFAULTS.orchestratorModel;
// The agent-description and voice-model defaults that used to live here — duplicated from
// provider.ts, with a comment saying so — are now read from SETTING_DEFAULTS along with
// everything else. That duplication is what finding S1 was about.

/**
 * The model an agent should carry when its Model ID field is left blank.
 *
 * "Blank means the default" is only meaningful once you say *whose* default. Both writers below
 * used DEFAULT_MODEL — the *static* `SETTING_DEFAULTS.orchestratorModel`, i.e. the literal
 * "gpt-4.1-mini" — which is neither the model the Chat slot is currently on nor one the agent's
 * own provider serves. So clearing the field on a Claude-backed install stored an OpenAI id and
 * the next run 404'd against Anthropic. That is the exact failure ai/selectProvider.ts exists to
 * prevent, in the one path it did not cover.
 *
 * A pinned agent takes its own provider's default. An agent inheriting the Chat slot (`""`), or
 * one naming a provider from a build that offered it and this one doesn't, takes the *live*
 * orchestrator model — which is also what selectChatProvider writes across every inheriting agent,
 * so a blank save and a provider switch agree by construction rather than by coincidence.
 *
 * A provider with no default of its own is refused rather than filled in. `local` is the only one,
 * and the Chat slot's model is the wrong answer for it: on a default install that stores
 * `gpt-4.1-mini` against an Ollama server, which 404s — the same failure this function exists to
 * stop, arrived at from the other direction. There is no id anyone but the user can supply, so
 * asking is the honest move. Same wording, and same reasoning, as selectChatProvider.
 */
export function resolveAgentModel(providerId: string): string {
  const provider = findProvider(providerId.trim());
  if (provider && provider.defaultChatModel === "") {
    throw new Error(`${provider.label} needs a model id — there is no default to fall back on.`);
  }
  return provider?.defaultChatModel || readAppSetting("orchestratorModel");
}

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
  /** Registry id from ./providers, or "" to follow the Chat slot. */
  provider_id: string;
}

export interface AgentUpdatePatch {
  name?: string;
  /**
   * Which provider this agent runs on; "" means "follow the Chat slot".
   *
   * Deliberately absent from buildUpdateAgentPatch, so ConfigAgent's update_agent tool cannot
   * set it. Choosing a provider chooses the host a request and its key are sent to, which is the
   * same reasoning that keeps chatApiUrl and chatProviderId out of the agent's reach: a reply is
   * assembled from text this app did not author, and "point the research agent at
   * https://attacker/v1" is a sentence that can appear in it.
   */
  providerId?: string;
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
  /** Registry id this agent runs on, or "" / omitted to follow the Chat slot — the same meaning
   * `provider_id` carries on the row and that updateAgent's patch uses. */
  providerId?: string;
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
  /** Registry id, or "" to follow the Chat slot. Optional because files written before per-agent
   * providers existed don't have it.
   *
   * Unlike the ids this type deliberately omits, a provider id is *portable* — it names an entry
   * in a registry every install compiles in, not a row in this one's database. Leaving it out
   * while keeping `model` was the unsafe half of the pair: an agent exported on Claude arrived
   * carrying `claude-haiku-4-5-20251001` and following whatever the importing machine's Chat slot
   * was, so every run asked OpenAI for a Claude model. */
  providerId?: string;
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
      // The orchestrator's configured model rather than the one baked into defaultAgents.json.
      //
      // Those entries all say "gpt-4.1-mini", which was harmless while OpenAI was the only
      // provider and is broken now: seed onto Claude or a local Ollama and all four system agents
      // ask that host for an OpenAI model. Observed live — `404 model 'gpt-4.1-mini' not found`
      // from Ollama, for agents the user never touched.
      //
      // The JSON value stays as the fallback for a database with no setting yet. On a legacy
      // install readAppSetting returns the same "gpt-4.1-mini" default, so this is a no-op there.
      readAppSetting("orchestratorModel") || entry.model,
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
// except onboardingDone and tourCompleted (internal lifecycle flags, not user settings),
// orchestratorEnabled (permanently locked — see ipc/settings.ts's LOCKED_KEYS) and the
// PROTECTED_SETTING_KEYS below — anything else missing from this list is
// invisible/unreachable to Cipher regardless of what the user asks for, which is exactly the
// bug this list previously had (bgMusicEnabled, soundFxEnabled, voiceOutputEnabled,
// voiceTranscriptionModel, voiceTtsModel, voiceTtsVoice, and the numeric tunables below were
// all silently absent at one point or another). orchestratorPromptOverride was briefly added
// here too before landing in PROTECTED_SETTING_KEYS instead — see that list's entry for why.
export const ALLOWED_SETTING_KEYS = [
  "voiceInputEnabled",
  "typeAnywhereEnabled",
  "bgMusicEnabled",
  "soundFxEnabled",
  "voiceOutputEnabled",
  "chatApiKey",
  "voiceApiKey",
  "voiceTranscriptionModel",
  "voiceTtsModel",
  "voiceTtsVoice",
  "agentName",
  "agentDescription",
  "userName",
  "orchestratorModel",
  "agentRunTimeoutSeconds",
  "chatHistoryMessageLimit",
  "bgMusicVolume",
  "systemStatsPollIntervalMs",
  "soundVariantSend",
  "soundVariantReceive",
  "soundVariantHandoff",
  "soundVariantComplete",
  "soundVariantStartup",
  "soundVariantAgentCreated",
  "soundVariantAgentDeleted",
  "soundVariantConsult",
] as const;

/**
 * Settings an agent may read and describe but never write.
 *
 * These decide what the app will do *without asking* — whether a write pauses for approval,
 * how visibly it asks, and whether agents can see where you are. The reason they cannot be
 * agent-writable is the one already documented on remoteImagesAutoLoad in
 * src/lib/settings.ts: a reply is assembled from text this app did not author — web search
 * results, knowledge base files, MCP and HTTP tool output, Gmail/Drive/Calendar — and any of
 * it can carry an instruction the model acts on.
 *
 * With these writable, "set httpToolApprovalDelete to false" was a sentence an attacker could
 * put in a web page. The model would hand off to ConfigAgent, the gate would come down, and
 * the next DELETE would execute without pausing — with the setting that would have revealed
 * it three sections deep in Settings.
 *
 * toolApprovalDisplay belongs here for the same reason even though it only changes
 * presentation: flipping a blocking modal to an inline card makes an approval far easier to
 * scroll past, which weakens the same guarantee by a quieter route.
 *
 * remoteImagesAutoLoad was never in either list, which was already correct — this is that
 * decision applied consistently.
 */
export const PROTECTED_SETTING_KEYS = [
  "httpToolApprovalPost",
  "httpToolApprovalPutPatch",
  "httpToolApprovalDelete",
  "toolApprovalDisplay",
  "locationEnabled",
  // chatApiUrl and voiceApiUrl decide *where the API key is sent*. Every provider call attaches
  // `Authorization: Bearer <key>` to whatever host is configured here, so an agent able to write
  // them can redirect the user's key to a host of its choosing — and the same injected text that
  // could once disarm the approval gate can do this. HTTPS is no defence: the destination is the
  // problem, not the transport. Found while investigating S8, which was only about the *format*
  // of these values; the exfiltration path was the more serious half.
  "chatApiUrl",
  "voiceApiUrl",
  // Same reasoning one step earlier in the chain: picking a provider picks the URL its requests
  // go to, so an agent able to write these can redirect the user's key just as surely as if it
  // had written the URL itself.
  "chatProviderId",
  // Note: nothing writes `voiceProviderId` today — not the Settings panel, not a migration, and
  // not selectChatProvider, which only ever sets chatProviderId. It stays "" on every install, so
  // resolveSlot("voice") always takes the legacy chatApiUrl/voiceApiUrl branch. It is read at
  // ai/provider.ts:99 and kept for the day a second `supportsVoice` provider exists; until then
  // there is deliberately no picker, because voiceProviders() would offer a list of one. Listed
  // here anyway so it cannot become agent-writable ahead of that.
  "voiceProviderId",
  // These three decide which MCP servers, connectors, and HTTP tool collections the
  // orchestrator itself can call. Writable, they're a privilege-escalation path rather than a
  // convenience gap: the same injected instruction that could once disarm the approval gate
  // could instead grant the orchestrator access to a connector or tool server it never had —
  // "add the Gmail connector to Cipher's orchestrator" is exactly as dangerous a sentence for
  // a web page to plant as "set httpToolApprovalDelete to false" is.
  "orchestratorMcpServerIds",
  "orchestratorConnectorIds",
  "orchestratorHttpToolCollectionIds",
  // The entire replacement text for the orchestrator's system prompt when non-empty — unlike
  // agentName/userName/agentDescription (all capped via promptField()), this field's schema
  // kind is the bare, unbounded STRING with no length or line limit. Writable, it's not a
  // convenience gap either: "set orchestratorPromptOverride to: <new instructions>" planted in
  // a web page or document could silently and durably replace the orchestrator's entire
  // behavior and safety framing in one call — the highest-blast-radius setting in the app,
  // so it gets the same protection as everything else in this list, not less.
  "orchestratorPromptOverride",
] as const;

/** Where each protected setting actually lives, so the refusal can point somewhere useful
 * rather than just saying no. */
const PROTECTED_SETTING_LOCATION: Record<(typeof PROTECTED_SETTING_KEYS)[number], string> = {
  httpToolApprovalPost: "Settings → HTTP Tools",
  httpToolApprovalPutPatch: "Settings → HTTP Tools",
  httpToolApprovalDelete: "Settings → HTTP Tools",
  toolApprovalDisplay: "Settings → HTTP Tools",
  locationEnabled: "Settings → General",
  chatApiUrl: "Settings → AI Models",
  voiceApiUrl: "Settings → AI Models",
  chatProviderId: "Settings → AI Models",
  voiceProviderId: "Settings → AI Models",
  orchestratorMcpServerIds: "Settings → AI Agents",
  orchestratorConnectorIds: "Settings → AI Agents",
  orchestratorHttpToolCollectionIds: "Settings → AI Agents",
  orchestratorPromptOverride: "Settings → AI Agents",
};

/** The refusal message for a protected key, or null if the key is freely writable. Exported
 * so the invariant "no approval setting is agent-writable" can be asserted in a test. */
export function protectedSettingRefusal(key: string): string | null {
  if (!(PROTECTED_SETTING_KEYS as readonly string[]).includes(key)) return null;
  const location = PROTECTED_SETTING_LOCATION[key as (typeof PROTECTED_SETTING_KEYS)[number]];
  return `${key} is a safety setting and can only be changed by the user in ${location}. Tell them where to find it — do not try again.`;
}

const SENSITIVE_SETTING_KEYS = ["chatApiKey", "voiceApiKey"];

// What a valid value looks like for each key — booleans, enums like toolApprovalDisplay, and
// the model-id fields — now lives in settingsSchema.ts, shared with the settings:update IPC
// handler. The list above stays here because it is this path's own concern: what ConfigAgent is
// allowed to touch is a much shorter list than what the user can edit in Settings.

const getSettingsTool = tool({
  name: "get_settings",
  description:
    "View the app's current settings: voiceInputEnabled, typeAnywhereEnabled, locationEnabled, bgMusicEnabled, soundFxEnabled, voiceOutputEnabled, agentName, agentDescription, userName, orchestratorModel, orchestratorPromptOverride, voiceTranscriptionModel, voiceTtsModel, voiceTtsVoice, chatProviderId and voiceProviderId (which AI provider each slot uses — openrouter, openai, anthropic for Claude, or local), chatApiUrl, voiceApiUrl, whether the Chat/Voice API keys are set (the key values themselves are never exposed), the HTTP-tool approval policy (httpToolApprovalPost, httpToolApprovalPutPatch, httpToolApprovalDelete, toolApprovalDisplay), the orchestrator's own tool grants (orchestratorMcpServerIds, orchestratorConnectorIds, orchestratorHttpToolCollectionIds), agentRunTimeoutSeconds, chatHistoryMessageLimit, bgMusicVolume, systemStatsPollIntervalMs, and the soundVariant* picks.",
  parameters: z.object({}),
  execute: async () => {
    devLog("[get_settings] called");
    const agentName = readAppSetting("agentName");
    const agentDescription = readAppSetting("agentDescription");
    const userName = readAppSetting("userName");
    const orchestratorModel = readAppSetting("orchestratorModel") || DEFAULT_MODEL;
    const voiceInputEnabled = readAppSetting("voiceInputEnabled");
    const typeAnywhereEnabled = readAppSetting("typeAnywhereEnabled");
    const locationEnabled = readAppSetting("locationEnabled");
    const bgMusicEnabled = readAppSetting("bgMusicEnabled");
    const soundFxEnabled = readAppSetting("soundFxEnabled");
    const voiceOutputEnabled = readAppSetting("voiceOutputEnabled");
    const voiceTranscriptionModel = readAppSetting("voiceTranscriptionModel");
    const voiceTtsModel = readAppSetting("voiceTtsModel");
    const voiceTtsVoice = readAppSetting("voiceTtsVoice");
    const chatApiUrl = readAppSetting("chatApiUrl");
    const voiceApiUrl = readAppSetting("voiceApiUrl");
    // Reported but not writable — see PROTECTED_SETTING_KEYS. Being able to *say* which provider
    // is in use is the difference between an agent that can answer "what model am I?" and one
    // that invents an answer, which is exactly what a small local model did in testing.
    const chatProviderId = readAppSetting("chatProviderId");
    const voiceProviderId = readAppSetting("voiceProviderId");
    const chatApiKey = readAppSetting("chatApiKey");
    const voiceApiKey = readAppSetting("voiceApiKey");
    const httpToolApprovalPost = readAppSetting("httpToolApprovalPost");
    const httpToolApprovalPutPatch = readAppSetting("httpToolApprovalPutPatch");
    const httpToolApprovalDelete = readAppSetting("httpToolApprovalDelete");
    const toolApprovalDisplay = readAppSetting("toolApprovalDisplay");
    const orchestratorPromptOverride = readAppSetting("orchestratorPromptOverride");
    const orchestratorMcpServerIds = readAppSetting("orchestratorMcpServerIds");
    const orchestratorConnectorIds = readAppSetting("orchestratorConnectorIds");
    const orchestratorHttpToolCollectionIds = readAppSetting("orchestratorHttpToolCollectionIds");
    const agentRunTimeoutSeconds = readAppSetting("agentRunTimeoutSeconds");
    const chatHistoryMessageLimit = readAppSetting("chatHistoryMessageLimit");
    const bgMusicVolume = readAppSetting("bgMusicVolume");
    const systemStatsPollIntervalMs = readAppSetting("systemStatsPollIntervalMs");
    const soundVariantSend = readAppSetting("soundVariantSend");
    const soundVariantReceive = readAppSetting("soundVariantReceive");
    const soundVariantHandoff = readAppSetting("soundVariantHandoff");
    const soundVariantComplete = readAppSetting("soundVariantComplete");
    const soundVariantStartup = readAppSetting("soundVariantStartup");
    const soundVariantAgentCreated = readAppSetting("soundVariantAgentCreated");
    const soundVariantAgentDeleted = readAppSetting("soundVariantAgentDeleted");
    const soundVariantConsult = readAppSetting("soundVariantConsult");
    return {
      httpToolApprovalPost,
      httpToolApprovalPutPatch,
      httpToolApprovalDelete,
      toolApprovalDisplay,
      agentName,
      agentDescription,
      userName,
      orchestratorModel,
      orchestratorPromptOverride,
      // Reported but not writable — same reasoning as chatProviderId/voiceProviderId above.
      orchestratorMcpServerIds,
      orchestratorConnectorIds,
      orchestratorHttpToolCollectionIds,
      voiceInputEnabled,
      typeAnywhereEnabled,
      locationEnabled,
      bgMusicEnabled,
      soundFxEnabled,
      voiceOutputEnabled,
      voiceTranscriptionModel,
      voiceTtsModel,
      voiceTtsVoice,
      chatApiUrl,
      voiceApiUrl,
      chatProviderId,
      voiceProviderId,
      chatApiKeySet: Boolean(chatApiKey),
      voiceApiKeySet: Boolean(voiceApiKey),
      agentRunTimeoutSeconds,
      chatHistoryMessageLimit,
      bgMusicVolume,
      systemStatsPollIntervalMs,
      soundVariantSend,
      soundVariantReceive,
      soundVariantHandoff,
      soundVariantComplete,
      soundVariantStartup,
      soundVariantAgentCreated,
      soundVariantAgentDeleted,
      soundVariantConsult,
    };
  },
});

const updateSettingTool = tool({
  name: "update_setting",
  description:
    "Update one of the app's settings: voiceInputEnabled, typeAnywhereEnabled, bgMusicEnabled, soundFxEnabled, voiceOutputEnabled, chatApiKey, voiceApiKey, voiceTranscriptionModel, voiceTtsModel, voiceTtsVoice, agentName, agentDescription, userName, orchestratorModel, agentRunTimeoutSeconds, chatHistoryMessageLimit, bgMusicVolume, systemStatsPollIntervalMs, and the soundVariant* picks (Send/Receive/Handoff/Complete/Startup/AgentCreated/AgentDeleted/Consult, each 1-5). The approval settings (httpToolApprovalPost/PutPatch/Delete, toolApprovalDisplay), locationEnabled, the provider URLs (chatApiUrl, voiceApiUrl), the provider selectors (chatProviderId, voiceProviderId), the orchestrator's own tool grants (orchestratorMcpServerIds, orchestratorConnectorIds, orchestratorHttpToolCollectionIds), and orchestratorPromptOverride (the orchestrator's whole system prompt) are safety settings and cannot be changed here — they decide which host the user's API key is sent to, what the orchestrator can access, or its entire behavior, so only the user can change them, in Settings → AI Models or Settings → AI Agents.",
  parameters: z.object({
    // Protected keys stay nameable so a request to change one gets a real answer pointing at
    // Settings. Dropping them from the enum instead would surface as a schema error, which
    // reads as a broken tool rather than a deliberate refusal.
    key: z.enum([...ALLOWED_SETTING_KEYS, ...PROTECTED_SETTING_KEYS]),
    value: z.union([z.string(), z.boolean(), z.number()]),
  }),
  execute: async ({ key, value }) => {
    const isSensitive = SENSITIVE_SETTING_KEYS.includes(key);
    devLog(`[update_setting] called with key=${key} value=${isSensitive ? "(redacted)" : value}`);

    // Checked before anything else, and before the value is even looked at — a refusal must
    // not depend on the value happening to be well-formed.
    const refusal = protectedSettingRefusal(key);
    if (refusal) {
      devLog(`[update_setting] refused protected key ${key}`);
      throw new Error(refusal);
    }

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
    // Broadcast at the point of the write rather than waiting for ipc/agent.ts's end-of-run
    // broadcast — a multi-tool-call turn (e.g. update a setting, then look something up)
    // would otherwise leave the renderer's Settings panel stale until the whole turn finishes.
    broadcastSettingsUpdate();
    return `Updated ${key}.`;
  },
  // Without this the SDK replaces every failure with "An error occurred while running the
  // tool. Please try again." — which would turn the protected-key refusal into something that
  // reads as a glitch and invites the model to retry a call that can never succeed. Same
  // reasoning, and same fix, as the HTTP tools in ai/httpTools.ts.
  errorFunction: (_context, error) => (error instanceof Error ? error.message : String(error)),
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

// A rewritten prompt, or a newly attached MCP server/connector, outlasts the conversation
// that produced it — the same threat model PROTECTED_SETTING_KEYS documents above (a reply
// is assembled from text this app did not author, and any of it can carry an instruction the
// model acts on). Renaming an agent or flipping enabled/model carries no such persistence, so
// only the fields that grant durable capability or rewrite behavior pause for approval.
const SENSITIVE_UPDATE_AGENT_FIELDS = ["prompt", "mcpServerIds", "connectorIds"] as const;

export function updateAgentNeedsApproval(args: UpdateAgentToolArgs): boolean {
  return SENSITIVE_UPDATE_AGENT_FIELDS.some((key) => args[key] !== null);
}

const updateAgentTool = tool({
  name: "update_agent",
  description:
    "Update an existing agent's name, tagline, description, prompt, model, enabled state, connected MCP servers, or connected connectors (e.g. Gmail). Only call this after confirming the specific change(s) with the user in plain language. Use list_agents first if you need to find the agent's id or see its current fields. Note: system agents cannot be disabled, and which AI provider an agent runs on cannot be changed here — that decides where its API key is sent, so the user sets it in Settings → Agents. Changing the prompt, MCP servers, or connectors pauses for the user's approval.",
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
  // Same SDK-native human-in-the-loop as ai/httpTools.ts: the run stops with an interruption
  // before execute() ever runs, and only resumes once ipc/agent.ts approves it.
  needsApproval: async (_ctx, args) => updateAgentNeedsApproval(args),
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
    "Attach an already-connected connector (e.g. Gmail) to a specific agent, giving that agent's chat turns access to its tools (e.g. sending email). The connector must already be connected — use connect_connector first if it isn't. Use list_agents to find the target agent's id. Pauses for the user's approval before attaching.",
  parameters: z.object({ agentId: z.string(), connectorId: z.string() }),
  // Same reasoning as update_agent's prompt/mcpServerIds/connectorIds gate above: this grants
  // an agent durable access to a connected account (Gmail, Drive, Calendar), which outlasts
  // the conversation that requested it.
  needsApproval: async () => true,
  execute: async ({ agentId, connectorId }) => {
    if (!getConnectorDefinition(connectorId)) {
      throw new Error(`Unknown connector: ${connectorId}`);
    }
    if (!getConnector(connectorId) || getConnector(connectorId)?.status !== "connected") {
      throw new Error(`${connectorId} isn't connected yet — call connect_connector first.`);
    }
    const updated = patchAgentConnectorIds(agentId, (ids) => (ids.includes(connectorId) ? ids : [...ids, connectorId]));
    devLog(`[attach_connector_to_agent] attached ${connectorId} to ${agentId}`);
    return { id: updated.id, name: updated.name, connectorIds: parseIdList(`agents ${updated.id}/connector_ids`, updated.connector_ids) };
  },
});

const detachConnectorFromAgentTool = tool({
  name: "detach_connector_from_agent",
  description: "Remove a connector from a specific agent, without disconnecting the service itself.",
  parameters: z.object({ agentId: z.string(), connectorId: z.string() }),
  execute: async ({ agentId, connectorId }) => {
    const updated = patchAgentConnectorIds(agentId, (ids) => ids.filter((id) => id !== connectorId));
    devLog(`[detach_connector_from_agent] detached ${connectorId} from ${agentId}`);
    return { id: updated.id, name: updated.name, connectorIds: parseIdList(`agents ${updated.id}/connector_ids`, updated.connector_ids) };
  },
});

const getCurrentLocationTool = tool({
  name: "get_current_location",
  description:
    "Get the user's approximate last known location (city-level latitude/longitude, from an IP-based lookup — not GPS-precise), if location access is enabled in Settings.",
  parameters: z.object({}),
  execute: async () => {
    const enabled = readAppSetting("locationEnabled");
    if (!enabled) return "Location access is disabled in Settings.";
    const location = getCurrentLocation();
    if (!location) return "No location available yet — the app hasn't captured the user's location this session.";
    return location;
  },
});

/** Returns the user's saved override if set (via Settings → Agents), else the built-in orchestrator.md template. */
export function getOrchestratorPromptTemplate(): string {
  const override = readAppSetting("orchestratorPromptOverride");
  return override.trim().length > 0 ? override : orchestratorPrompt;
}

/**
 * The orchestrator prompt as the Settings panel should show it: the *template*, placeholders
 * intact.
 *
 * This used to return the rendered prompt, which quietly made editing it destructive. The panel
 * saves whatever the textarea holds as orchestratorPromptOverride, so a rendered prompt saved
 * back froze the substitutions permanently: {{agentName}} stopped following a rename, and
 * {{currentDateTime}} pinned the model to the date and time of the edit — reintroducing exactly
 * the stale-date bug getCurrentDateTime exists to prevent, for good, from one edit.
 *
 * Every sub-agent's prompt in the same list is its raw column, placeholders and all, so showing
 * the template here is also what makes the orchestrator consistent with them.
 *
 * Nothing else calls this: the agent build renders the template separately at build time.
 */
export function getOrchestratorPromptForEditing(): string {
  return getOrchestratorPromptTemplate();
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
  /** The exact tool name Orbit calls this agent by right now (see agentAsTool/
   * dedupeToolNames) — "" for a disabled agent, since those aren't wired as a tool at all.
   * Lets the renderer match a live `agent:stream-step` event's `toolName` back to the orbit
   * node it belongs to, without duplicating the dedup logic client-side. */
  orchestratorToolName: string;
}

/** Same built-ins-first ordering, and the same enabled-only filter for custom agents, that
 * buildOrchestrator uses when it calls dedupeToolNames — so a row's `orchestratorToolName`
 * here always matches what Orbit will actually call it by at run time. A disabled custom
 * agent is excluded (never wired as a tool), matching buildOrchestrator's own `customRows`
 * query (`... AND enabled = 1`). */
function assignOrchestratorToolNames(rows: AgentRow[]): Map<string, string> {
  const BUILTIN_IDS = ["configAgent", "knowledgeAgent", "explorerAgent", "taskAgent"];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const wired = [
    ...BUILTIN_IDS.map((id) => byId.get(id)).filter((r): r is AgentRow => Boolean(r)),
    ...rows.filter((r) => !BUILTIN_IDS.includes(r.id) && r.enabled),
  ];
  return dedupeToolNames(wired);
}

// Stored prompts keep {{agentName}}/{{userName}}/{{currentDateTime}} placeholders
// literally (see renderPrompt) — rendered here so the read-only Settings → AI display
// shows the live name instead of the raw template.
export function listAgentsForDisplay(): AgentDisplayRow[] {
  const agentName = readAppSetting("agentName");
  const userName = readAppSetting("userName");
  const currentDateTime = getCurrentDateTime();
  const rows = listAgents();
  const toolNames = assignOrchestratorToolNames(rows);
  return rows.map((row) => ({
    ...row,
    prompt: renderPrompt(row.prompt, { agentName, userName, currentDateTime }),
    toolNames: getBuiltinToolNamesForRole(row),
    orchestratorToolName: toolNames.get(row.id) ?? "",
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
  // Unlike the other optional fields, an explicitly-supplied but blank name is rejected
  // rather than silently kept — otherwise a caller (e.g. Cipher's update_agent tool)
  // could report success while actually leaving the name unchanged.
  if (patch.name !== undefined && patch.name.trim().length === 0) {
    throw new Error("Agent name cannot be blank.");
  }
  // Empty is a real value here — "follow the Chat slot" — so only a non-empty id is checked
  // against the registry. An unknown one is refused rather than stored, because a row naming a
  // provider this build has never heard of silently falls back at run time.
  //
  // Resolved before the model on purpose: a blank model means "this provider's default", so the
  // provider has to be settled first. Patching both at once — which is what the Settings panel
  // does when you change an agent's provider — must read the *incoming* id, not the stored one.
  //
  // Only what the *patch* supplies is checked. Applying it to a stored id as well made a row
  // naming a provider this build doesn't have permanently unmodifiable — it could not be renamed,
  // disabled, or re-pointed at a provider that does exist, which is the one action that would fix
  // it. Everywhere else an unrecognised stored id degrades to the Chat slot (see modelForAgent in
  // ai/provider.ts); refusing every write to the row is not that.
  const nextProviderId = patch.providerId === undefined ? existing.provider_id : patch.providerId.trim();
  if (patch.providerId !== undefined && nextProviderId !== "" && !findProvider(nextProviderId)) {
    throw new Error(`"${nextProviderId}" is not a provider this app knows about.`);
  }
  // Blank model field means "use the default" rather than being rejected; anything
  // else must match the same shape createAgent enforces, otherwise a bad model id
  // silently persists here and only surfaces later as an opaque provider-side error.
  const nextModel =
    patch.model === undefined ? existing.model : patch.model.trim() || resolveAgentModel(nextProviderId);
  if (!MODEL_ID_PATTERN.test(nextModel)) {
    throw new Error(`"${nextModel}" doesn't look like a valid model ID (expected "model" or "provider/model").`);
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
    provider_id: nextProviderId,
  };
  db.prepare(
    "UPDATE agents SET name = ?, tagline = ?, description = ?, prompt = ?, model = ?, enabled = ?, mcp_server_ids = ?, connector_ids = ?, http_tool_collection_ids = ?, provider_id = ? WHERE id = ?"
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
    next.provider_id,
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

/** The natural tool-name slug for a display name — what agentAsTool would register if no
 * other agent's name produced the same slug. Two agents can share a display name today by
 * design (uniqueAgentId already disambiguates the *id* for that exact case — e.g. importing
 * an agent config you already have under the same name), so this can't be enforced unique
 * at write time without breaking that. dedupeToolNames (below) is what actually resolves a
 * collision, at the one point it matters: assembling the orchestrator's tool list. */
function agentToolNameSlug(name: string): string {
  return slugify(name).replace(/-/g, "_");
}

/**
 * Assigns each row a unique tool name, preferring its own natural slug and appending `_2`,
 * `_3`, … only when that slug was already claimed earlier in `rows` — same
 * auto-disambiguate-rather-than-reject philosophy as uniqueAgentId, applied here because
 * nothing in the @openai/agents SDK itself detects or rejects a duplicate function-tool name
 * (checked: it only guards against duplicate names across MCP servers). Without this, two
 * agents sharing a display name — or a custom agent named the same as a built-in specialist
 * — would silently register two identically-named tools, and which one the model actually
 * reaches would be undefined SDK/provider behavior with no error surfaced anywhere.
 *
 * Callers must list the four built-in rows first so they always keep their plain slug
 * ("cipher", "atlas", …) — the exact names orchestrator.md's prompt hardcodes — and only a
 * colliding custom agent further down the list gets suffixed.
 */
export function dedupeToolNames(rows: { id: string; name: string }[]): Map<string, string> {
  const used = new Set<string>();
  const assigned = new Map<string, string>();
  for (const row of rows) {
    const base = agentToolNameSlug(row.name);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    assigned.set(row.id, candidate);
  }
  return assigned;
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
  // Empty means "follow the Chat slot"; anything else is checked against the registry, for the
  // same reason updateAgent checks it — a row naming a provider this build has never heard of
  // silently falls back at run time, so the refusal belongs at the write.
  const providerId = input.providerId?.trim() ?? "";
  if (providerId !== "" && !findProvider(providerId)) {
    throw new Error(`"${providerId}" is not a provider this app knows about.`);
  }
  // A blank model means whatever this agent's own provider defaults to — the Chat slot's current
  // model when it follows the slot, not the build's compile-time default, which is a different
  // provider's id the moment the user has pointed Chat anywhere but OpenAI.
  const model = input.model?.trim() || resolveAgentModel(providerId);
  if (!MODEL_ID_PATTERN.test(model)) {
    throw new Error(`"${model}" doesn't look like a valid model ID (expected "model" or "provider/model").`);
  }

  const id = uniqueAgentId(db, slugify(name));
  const icon = input.icon?.trim() || "ti-robot";
  const tagline = input.tagline?.trim() ?? "";
  const description = input.description?.trim() ?? "";
  const prompt = input.prompt?.trim() ?? "";

  db.prepare(
    "INSERT INTO agents (id, name, icon, tagline, description, prompt, model, tools, enabled, provider_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, name, icon, tagline, description, prompt, model, "[]", 1, providerId);

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
    providerId: row.provider_id,
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
  // An id this build doesn't recognise degrades to the Chat slot rather than failing the import.
  // The file came from another machine, possibly another version, and refusing the whole agent
  // over a provider it can be re-pointed at in two clicks is the wrong trade — the same
  // degrade-don't-throw posture modelForAgent takes for an unrecognised stored id.
  const providerId = input.providerId && findProvider(input.providerId) ? input.providerId : "";
  return createAgent({
    name: input.name,
    icon: input.icon,
    tagline: input.tagline,
    description: input.description,
    model: input.model,
    providerId,
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
// Throwaway — getBuiltinToolNamesForRole below only reads each tool's static `.name` for
// display, it never executes, so a no-op is fine (same reasoning as the "" traceId already
// used there for createWriteChecklistTool).
const NOOP_REQUEST_ANSWER: RequestAnswerFn = async () => "";

export function getBuiltinToolNamesForRole(row: AgentRow): string[] {
  // traceId is irrelevant here — this only reads each tool's static `.name` for display,
  // it never executes, so a throwaway value is fine (same reasoning as calling
  // createSaveUserInfoTool purely for its `.name` below).
  if (row.id === "configAgent") {
    return [
      getSettingsTool,
      updateSettingTool,
      createAgentTool,
      updateAgentTool,
      listAgentsTool,
      findSkillTool,
      createSaveUserInfoTool(row.name),
      createWriteChecklistTool(row.name, ""),
      createAskUserTool(row.name, NOOP_REQUEST_ANSWER),
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
      createWriteChecklistTool(row.name, ""),
      createAskUserTool(row.name, NOOP_REQUEST_ANSWER),
      listGrantedFoldersTool,
      listFolderContentsTool,
      readFolderFileTool,
    ].map((t) => t.name);
  }
  if (row.id === "explorerAgent") {
    return [
      webSearchTool,
      fetchWebContentTool,
      createSaveUserInfoTool(row.name),
      createWriteChecklistTool(row.name, ""),
      createAskUserTool(row.name, NOOP_REQUEST_ANSWER),
    ].map((t) => t.name);
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
      createWriteChecklistTool(row.name, ""),
      createAskUserTool(row.name, NOOP_REQUEST_ANSWER),
    ].map((t) => t.name);
  }
  return [
    createSaveUserInfoTool(row.name),
    createWriteChecklistTool(row.name, ""),
    createAskUserTool(row.name, NOOP_REQUEST_ANSWER),
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
   * going through the orchestrator. Matched by name, case-insensitively, by the caller
   * (see electron/main/ipc/agent.ts's agent:runStream). */
  allAgents: Agent[];
}

/**
 * Runs one specialist agent to completion for a single tool call and returns its final text
 * output. Supplied by the caller (ipc/agent.ts for an interactive chat turn,
 * tasks/scheduler.ts for a headless prompt-task run) because only the caller has the
 * approval-dialog / streaming machinery a nested run still needs — buildOrchestrator only
 * wires the specialist up as a callable tool, it doesn't execute anything itself.
 */
export type RunSubAgentFn = (agent: Agent, input: string, displayName: string) => Promise<string>;

/**
 * Wraps one specialist agent as a tool the orchestrator can call directly and get a text
 * result back from — replacing the old handoff-based `handoffs: [...]` wiring, which
 * transferred control away permanently and let the orchestrator use exactly one specialist
 * per message (see orchestrator.md's former "Sequencing reality check"). This lets Orbit call
 * several specialists in one turn, in sequence or based on each other's results, and
 * synthesize the final reply itself.
 *
 * Deliberately not the SDK's own `Agent.asTool()`: that helper runs the nested agent
 * internally and returns its text, but never inspects or resolves `interruptions` from that
 * nested run — a needsApproval tool inside it (Cipher's update_agent, Chrono's create_task,
 * any agent's approval-gated HTTP tool) would silently never execute, with no dialog and no
 * explanation. `runSubAgent` is built by the caller from the exact same approval-resolution
 * loop the top-level run uses (see ipc/agent.ts's runToCompletion / ai/runLoop.ts), so a
 * nested approval gets the identical dialog it always did.
 *
 * A specialist run this way is a fully independent nested `run()` — unlike a handoff, it
 * does not automatically receive the prior conversation, only the `input` string the
 * orchestrator's tool call supplies. The tool description says so explicitly so the model
 * doesn't assume otherwise.
 *
 * `toolName` is passed in rather than derived here from `row.name` — see dedupeToolNames,
 * which is what actually resolves two agents sharing a name (or a display name colliding
 * with a built-in) into two distinct tool names before any of these get built.
 */
function agentAsTool(
  row: AgentRow,
  agentInstance: Agent,
  description: string,
  toolName: string,
  runSubAgent: RunSubAgentFn
): Tool {
  return tool({
    name: toolName,
    description:
      `${description} This specialist does not see the rest of this conversation — write a ` +
      `self-contained request in "input" with every fact or prior finding it needs.`,
    parameters: z.object({
      input: z.string().describe("The full, self-contained request to hand to this specialist."),
    }),
    execute: async ({ input }) => runSubAgent(agentInstance, input, row.name),
  });
}

/** Rebuilt fresh on every agent:run/agent:runStream call (nothing is cached across runs
 * — see electron/main/ipc/agent.ts). Any MCP server connected here for an agent's own
 * `mcp_server_ids` must be closed by the caller after the run completes (`mcpServers`
 * collects every server connected across every agent, orchestrator included, so one
 * `closeMcpServers(result.mcpServers)` in a `finally` covers all of them). */
export async function buildOrchestrator(
  runSubAgent: RunSubAgentFn,
  traceId: string,
  requestAnswer: RequestAnswerFn
): Promise<BuiltOrchestrator> {
  const db = getDb();
  ensureDefaultAgentsSeeded(db);

  const agentName = readAppSetting("agentName");
  const userName = readAppSetting("userName");
  const orchestratorModel = readAppSetting("orchestratorModel") || DEFAULT_MODEL;
  const orchestratorMcpServerIds = readAppSetting("orchestratorMcpServerIds");
  const orchestratorConnectorIds = readAppSetting("orchestratorConnectorIds");
  const orchestratorHttpToolCollectionIds = readAppSetting("orchestratorHttpToolCollectionIds");
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

  // Appended to *every* agent — orchestrator, built-in specialists and custom agents alike.
  //
  // Orbit reported a balance of "340,000 INR" for a budget agent that held no records at
  // all: it made the figure up, then repeated it a turn later over that agent's own explicit
  // "I don't have a recorded balance yet". orchestrator.md now carries the full version of
  // this rule, but stating it only there leaves two holes. A specialist is usually the agent
  // that actually holds the records, so it is the one best placed to invent one — and Orbit
  // is told to trust what a specialist reports. And the orchestrator prompt is user-
  // replaceable (orchestratorPromptOverride), which would drop the rule entirely. Appending
  // it here is the one place that reaches every agent no matter how its prompt was authored.
  const groundingRule =
    "\n\nNever state a figure, total, balance, count, date or stored record unless a tool call in this same turn " +
    "returned it. Not from memory, not from earlier in the conversation, not by doing arithmetic on a number you " +
    "saw before, and never invented because a plausible-sounding one would answer the question. If you have no " +
    "record of something, say exactly that — \"I don't have that recorded\" is always a better answer than a " +
    "number you cannot point at. A figure you or another agent stated earlier is not a source. The same rule " +
    "covers people and quotes: never attribute a quote, comment, username, or handle to a person unless a tool " +
    "result in this same turn actually contains it verbatim. A search that came back with no forum or social " +
    "content does not become one by inventing a commenter — say the search found no such discussion instead.";

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
    "agent can read or change it. Before telling the user you have nothing recorded, call list_agent_data and " +
    "look — a get_agent_data miss only means that one key is unused, never that the store is empty, and answering " +
    "\"nothing saved yet\" off a single missed key is how a wrong total gets stated as fact. When you keep a series " +
    "of entries (expenses, log lines, anything that accumulates), give every key in that series the same prefix so " +
    "you can find the whole set again.";

  // This description feeds agentAsTool below — it's what the orchestrator actually sees on
  // the generated tool for this specialist, the same job handoffDescription used to do for
  // the generated "transfer_to_X" handoff tool, kept in sync with which agents genuinely
  // exist right now rather than relying solely on the static prose in orchestrator.md (which
  // only describes the four fixed built-ins and has no way to know about custom agents).
  const CONFIG_AGENT_TOOL_DESCRIPTION =
    "Manages app configuration: onboarding, settings (agent names, models, API keys, toggles) — including reading/checking a setting's current value, not just changing it — and creating new custom agents.";
  const configAgentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get("configAgent") as AgentRow;
  const configAgent = new Agent({
    name: configAgentRow.name,
    instructions:
      renderPrompt(configAgentRow.prompt, promptVars) + httpToolsPromptForRow(configAgentRow) + groundingRule + userInfoBlock,
    model: modelForAgent(configAgentRow),
    tools: [
      getSettingsTool,
      updateSettingTool,
      createAgentTool,
      updateAgentTool,
      listAgentsTool,
      findSkillTool,
      createSaveUserInfoTool(configAgentRow.name),
      createWriteChecklistTool(configAgentRow.name, traceId),
      createAskUserTool(configAgentRow.name, requestAnswer),
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

  const KNOWLEDGE_AGENT_TOOL_DESCRIPTION =
    "Reads and searches the user's knowledge base documents (resumes, notes, reference material) for anything a personal document might answer, and browses/reads the local folders the user has granted via the Folders widget.";
  const knowledgeAgentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get("knowledgeAgent") as AgentRow;
  const knowledgeAgent = new Agent({
    name: knowledgeAgentRow.name,
    instructions:
      renderPrompt(knowledgeAgentRow.prompt, promptVars) + httpToolsPromptForRow(knowledgeAgentRow) + groundingRule + userInfoBlock,
    model: modelForAgent(knowledgeAgentRow),
    tools: [
      listKnowledgebaseFilesTool,
      readKnowledgebaseFileTool,
      createSaveUserInfoTool(knowledgeAgentRow.name),
      createWriteChecklistTool(knowledgeAgentRow.name, traceId),
      createAskUserTool(knowledgeAgentRow.name, requestAnswer),
      listGrantedFoldersTool,
      listFolderContentsTool,
      readFolderFileTool,
      ...attachConnectorsForRow(knowledgeAgentRow),
      ...attachHttpToolsForRow(knowledgeAgentRow),
    ],
    mcpServers: await connectForRow(knowledgeAgentRow),
  });

  const EXPLORER_AGENT_TOOL_DESCRIPTION =
    "Searches the live web for current information: news, comparisons, products, or anything about the outside world that needs up-to-date data rather than the user's own documents.";
  const explorerAgentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get("explorerAgent") as AgentRow;
  const explorerAgent = new Agent({
    name: explorerAgentRow.name,
    instructions:
      renderPrompt(explorerAgentRow.prompt, promptVars) + httpToolsPromptForRow(explorerAgentRow) + groundingRule + userInfoBlock,
    model: modelForAgent(explorerAgentRow),
    tools: [
      webSearchTool,
      fetchWebContentTool,
      createSaveUserInfoTool(explorerAgentRow.name),
      createWriteChecklistTool(explorerAgentRow.name, traceId),
      createAskUserTool(explorerAgentRow.name, requestAnswer),
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
  // A custom agent's tool description comes straight from whatever the user (via Cipher) set
  // as its tagline/description, so routing guidance appears/disappears with the agent itself
  // — no orchestrator.md edits needed as custom agents are added, edited, or removed.
  const TASK_AGENT_TOOL_DESCRIPTION =
    "Manages reminders and prompt tasks — one-shot or recurring, with dynamic parameters substituted at run time — and notifies the user when they're due.";
  const taskAgentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get("taskAgent") as AgentRow;
  const taskAgent = new Agent({
    name: taskAgentRow.name,
    instructions:
      renderPrompt(taskAgentRow.prompt, promptVars) + httpToolsPromptForRow(taskAgentRow) + groundingRule + userInfoBlock,
    model: modelForAgent(taskAgentRow),
    tools: [
      createTaskTool,
      listTasksTool,
      updateTaskTool,
      completeTaskTool,
      cancelTaskTool,
      deleteTaskTool,
      createSaveUserInfoTool(taskAgentRow.name),
      createWriteChecklistTool(taskAgentRow.name, traceId),
      createAskUserTool(taskAgentRow.name, requestAnswer),
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
          groundingRule +
          httpToolsPromptForRow(row) +
          userInfoBlock,
        model: modelForAgent(row),
        tools: [
          createSaveUserInfoTool(row.name),
          createWriteChecklistTool(row.name, traceId),
          createAskUserTool(row.name, requestAnswer),
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

  // Every specialist is wired in as a callable tool, not a handoff target — Orbit can call
  // several of these in one turn, in sequence or based on each other's results, and
  // synthesize the final reply itself instead of transferring control away permanently. See
  // agentAsTool's own comment for why this isn't the SDK's built-in Agent.asTool().
  //
  // Built-ins listed first so dedupeToolNames always leaves their plain slug ("cipher",
  // "atlas", …) alone — the exact names orchestrator.md's prompt hardcodes — and only a
  // custom agent colliding with one of those (or with another custom agent's name) gets
  // suffixed.
  const specialistRows = [configAgentRow, knowledgeAgentRow, explorerAgentRow, taskAgentRow, ...customRows];
  const toolNames = dedupeToolNames(specialistRows);
  const specialistTools = [
    agentAsTool(configAgentRow, configAgent, CONFIG_AGENT_TOOL_DESCRIPTION, toolNames.get(configAgentRow.id)!, runSubAgent),
    agentAsTool(
      knowledgeAgentRow,
      knowledgeAgent,
      KNOWLEDGE_AGENT_TOOL_DESCRIPTION,
      toolNames.get(knowledgeAgentRow.id)!,
      runSubAgent
    ),
    agentAsTool(
      explorerAgentRow,
      explorerAgent,
      EXPLORER_AGENT_TOOL_DESCRIPTION,
      toolNames.get(explorerAgentRow.id)!,
      runSubAgent
    ),
    agentAsTool(taskAgentRow, taskAgent, TASK_AGENT_TOOL_DESCRIPTION, toolNames.get(taskAgentRow.id)!, runSubAgent),
    ...customRows.map((row, i) =>
      agentAsTool(
        row,
        customAgents[i],
        row.description || row.tagline || `Handles requests related to ${row.name}.`,
        toolNames.get(row.id)!,
        runSubAgent
      )
    ),
  ];

  const orchestrator = new Agent({
    name: agentName,
    instructions:
      renderPrompt(getOrchestratorPromptTemplate(), promptVars) +
      buildHttpToolsPromptBlock(orchestratorHttpToolCollectionIds) +
      groundingRule +
      userInfoBlock,
    model: modelForAgent({ model: orchestratorModel, provider_id: "" }),
    tools: [
      searchHistoryTool,
      getCurrentLocationTool,
      createSaveUserInfoTool(agentName),
      createWriteChecklistTool(agentName, traceId),
      createAskUserTool(agentName, requestAnswer),
      ...specialistTools,
      ...attachConnectorsForIds(orchestratorConnectorIds),
      ...buildHttpToolsForCollectionIds(orchestratorHttpToolCollectionIds),
    ],
    mcpServers: orchestratorMcpServers,
  });

  return {
    agent: orchestrator,
    mcpServers: allConnected,
    allAgents: [configAgent, knowledgeAgent, explorerAgent, taskAgent, ...customAgents],
  };
}
