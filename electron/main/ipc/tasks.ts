import { ipcMain } from "electron";
import { createTask, deleteTask, listTasks, TaskCreateInput, TaskRow, TaskUpdatePatch, updateTask } from "../db/tasksStore";

export type { TaskRow, TaskCreateInput, TaskUpdatePatch } from "../db/tasksStore";

export function registerTaskHandlers() {
  ipcMain.handle("tasks:list", (): TaskRow[] => listTasks());

  ipcMain.handle("tasks:create", (_event, input: TaskCreateInput): TaskRow => createTask(input));

  ipcMain.handle("tasks:update", (_event, id: string, patch: TaskUpdatePatch): TaskRow => updateTask(id, patch));

  ipcMain.handle("tasks:complete", (_event, id: string): TaskRow => updateTask(id, { status: "done" }));

  ipcMain.handle("tasks:delete", (_event, id: string): void => deleteTask(id));
}
