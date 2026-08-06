import { BrowserWindow } from "electron";
import { devLog } from "../devLog";

/**
 * Shared with ipc/agent.ts, which also calls these unconditionally once at the end of every
 * agent run (covers any DB write this file's tools make that isn't followed by an immediate
 * call here — cheap, and simpler than introspecting which tool actually ran). Kept in its own
 * module rather than imported from ipc/agent.ts because that file imports from this one
 * (buildOrchestrator etc.) — importing back would be circular.
 */

// ConfigAgent's update_setting tool writes straight to the settings table, bypassing the
// settings:update IPC handler entirely — without this, the renderer's cached settings state
// (fetched once in useSettings.ts) never learns a setting changed from inside an agent run.
// Called directly from update_setting's execute (agents.ts) right after the write commits, so
// the change reaches the renderer as soon as it's durable rather than waiting for the whole
// turn to finish.
export function broadcastSettingsUpdate(): void {
  devLog("[agent] broadcasting settings:update to all windows");
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("settings:update");
  }
}

// ConfigAgent's connect_connector/disconnect_connector/attach_connector_to_agent/
// detach_connector_from_agent tools write straight to the connectors/agents tables, bypassing
// the connectors:connect/disconnect IPC handlers entirely — without this, useConnectors.ts's
// cached state (fetched once on mount) never learns a connector changed mid agent-run.
export function broadcastConnectorsUpdate(): void {
  devLog("[agent] broadcasting connectors:update to all windows");
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("connectors:update");
  }
}

// Chrono's create_task/update_task/complete_task/cancel_task/delete_task tools write straight
// to the tasks table, bypassing the tasks:* IPC handlers entirely — same reasoning as
// broadcastSettingsUpdate/broadcastConnectorsUpdate above, so useTasks.ts's cached state
// doesn't go stale after a chat conversation with Chrono.
export function broadcastTasksUpdate(): void {
  devLog("[agent] broadcasting tasks:update to all windows");
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("tasks:update");
  }
}
