import { ipcMain } from "electron";
import { getChecklistForTrace } from "../db/checklistStore";

export type { ChecklistItemRow, ChecklistItemStatus } from "../db/checklistStore";

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`checklist: ${name} must be a non-empty string`);
  }
  return value;
}

export function registerChecklistHandlers() {
  // Read-only on purpose — the only writer is the write_checklist tool (see
  // ai/tools/checklistTools.ts), called by the model, never by the renderer directly. The
  // renderer triggers a fetch here when it sees that tool's tool_output arrive over the
  // existing agent:stream-step pipe (see AgentsApp.tsx), rather than this pushing updates
  // itself — no new streaming mechanism needed.
  ipcMain.handle("checklist:get", (_event, traceId: unknown) => {
    return getChecklistForTrace(requireString(traceId, "traceId"));
  });
}
