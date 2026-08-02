import { ipcMain } from "electron";
import {
  listMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  testMcpServer,
  searchMcpRegistry,
  getDecryptedEnv,
  McpServerInput,
  McpServerUpdatePatch,
} from "../ai/mcp";

export type { McpServerRow, McpSearchResult } from "../ai/mcp";

function assertPlainObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
}

// args/env end up JSON.stringify'd straight into the DB (see ai/mcp.ts) with no shape
// check downstream — a malformed value here would only surface much later as a silent
// "failed to connect" when buildStdioServer tries to JSON.parse it back out.
function assertArgsAndEnvShape(value: { args?: unknown; env?: unknown }, prefix: string): void {
  if (value.args !== undefined) {
    if (!Array.isArray(value.args) || value.args.some((v) => typeof v !== "string")) {
      throw new Error(`${prefix} args must be an array of strings`);
    }
  }
  if (value.env !== undefined) {
    if (
      typeof value.env !== "object" ||
      value.env === null ||
      Array.isArray(value.env) ||
      Object.values(value.env).some((v) => typeof v !== "string")
    ) {
      throw new Error(`${prefix} env must be an object of string values`);
    }
  }
}

export function registerMcpHandlers() {
  ipcMain.handle("mcp:list", () => listMcpServers());

  ipcMain.handle("mcp:create", (_event, input: McpServerInput) => {
    assertPlainObject(input, "mcp:create requires a plain object input");
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new Error("mcp:create requires a non-empty name");
    }
    if (typeof input.command !== "string" || input.command.trim().length === 0) {
      throw new Error("mcp:create requires a non-empty command");
    }
    assertArgsAndEnvShape(input, "mcp:create");
    return createMcpServer(input);
  });

  ipcMain.handle("mcp:update", (_event, id: string, patch: McpServerUpdatePatch) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("mcp:update requires a non-empty server id");
    }
    assertPlainObject(patch, "mcp:update requires a plain object patch");
    assertArgsAndEnvShape(patch, "mcp:update");
    return updateMcpServer(id, patch);
  });

  ipcMain.handle("mcp:delete", (_event, id: string) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("mcp:delete requires a non-empty server id");
    }
    deleteMcpServer(id);
  });

  ipcMain.handle("mcp:test", (_event, input: McpServerInput) => {
    assertPlainObject(input, "mcp:test requires a plain object input");
    if (typeof input.command !== "string" || input.command.trim().length === 0) {
      throw new Error("mcp:test requires a non-empty command");
    }
    assertArgsAndEnvShape(input, "mcp:test");
    return testMcpServer(input);
  });

  ipcMain.handle("mcp:getEnv", (_event, id: string) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("mcp:getEnv requires a non-empty server id");
    }
    return getDecryptedEnv(id);
  });

  ipcMain.handle("mcp:search", (_event, query: string) => {
    if (typeof query !== "string") {
      throw new Error("mcp:search requires a string query");
    }
    return searchMcpRegistry(query);
  });
}
