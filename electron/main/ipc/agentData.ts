import { ipcMain } from "electron";
import { deleteAgentData, getAgentData, listAgentData, setAgentData } from "../db/agentDataStore";

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`agentData: ${name} must be a non-empty string`);
  }
  return value;
}

export function registerAgentDataHandlers() {
  ipcMain.handle("agentData:get", (_event, agentId: unknown, key: unknown): unknown => {
    return getAgentData(requireString(agentId, "agentId"), requireString(key, "key"), null);
  });

  ipcMain.handle("agentData:set", (_event, agentId: unknown, key: unknown, value: unknown): void => {
    setAgentData(requireString(agentId, "agentId"), requireString(key, "key"), value);
  });

  ipcMain.handle("agentData:list", (_event, agentId: unknown): Record<string, unknown> => {
    return listAgentData(requireString(agentId, "agentId"));
  });

  ipcMain.handle("agentData:delete", (_event, agentId: unknown, key: unknown): void => {
    deleteAgentData(requireString(agentId, "agentId"), requireString(key, "key"));
  });
}
