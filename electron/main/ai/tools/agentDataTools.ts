/**
 * Generic per-agent data store, exposed as tools so any agent (built-in or a user-created
 * custom agent, e.g. a "budget agent") can save/retrieve/list/delete its own structured
 * data across turns and conversations — see db/agentDataStore.ts (agent_data table).
 *
 * Bound to the calling agent's own id via createXAgentDataTool(agentId) factories (same
 * pattern as createSaveUserInfoTool in userInfoTools.ts), so the LLM can only ever pass a
 * key/value — never another agent's id — which is what enforces per-agent isolation.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { deleteAgentData, getAgentData, listAgentData, setAgentData } from "../../db/agentDataStore";

export function createSaveAgentDataTool(agentId: string) {
  return tool({
    name: "save_agent_data",
    description:
      "Save a piece of your own data under a key, so you can retrieve it later in this or a future conversation. " +
      "Overwrites any existing value for that key. Only you can read this data back — other agents cannot see it.",
    parameters: z.object({
      key: z.string().min(1).max(200).describe("A short identifier for this piece of data, e.g. 'monthly_budget'."),
      value: z.string().min(1).describe("The data to save, as a string (JSON-encode it yourself if it's structured)."),
    }),
    execute: async ({ key, value }) => {
      setAgentData(agentId, key, value);
      return "Saved.";
    },
  });
}

export function createGetAgentDataTool(agentId: string) {
  return tool({
    name: "get_agent_data",
    description: "Retrieve one piece of your own data by key, previously saved with save_agent_data.",
    parameters: z.object({
      key: z.string().min(1).max(200).describe("The key previously used with save_agent_data."),
    }),
    execute: async ({ key }) => {
      const value = getAgentData<string | null>(agentId, key, null);
      return value === null ? `No data found for key "${key}".` : value;
    },
  });
}

export function createListAgentDataTool(agentId: string) {
  return tool({
    name: "list_agent_data",
    description: "List every key/value pair you've saved for yourself with save_agent_data.",
    parameters: z.object({}),
    execute: async () => listAgentData(agentId),
  });
}

export function createDeleteAgentDataTool(agentId: string) {
  return tool({
    name: "delete_agent_data",
    description: "Delete one piece of your own data by key.",
    parameters: z.object({
      key: z.string().min(1).max(200).describe("The key previously used with save_agent_data."),
    }),
    execute: async ({ key }) => {
      deleteAgentData(agentId, key);
      return "Deleted.";
    },
  });
}
