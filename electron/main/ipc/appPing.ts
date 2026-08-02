import { ipcMain } from "electron";

export function registerAppPingHandler() {
  ipcMain.handle("app:ping", () => "pong");
}
