import { ipcMain, BrowserWindow } from "electron";

function getWin(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerWindowControlHandlers() {
  ipcMain.handle("window:minimize", (event) => {
    getWin(event)?.minimize();
  });

  ipcMain.handle("window:close", (event) => {
    getWin(event)?.close();
  });

  ipcMain.handle("window:toggleFullscreen", (event) => {
    const win = getWin(event);
    if (!win) return;
    win.setFullScreen(!win.isFullScreen());
  });
}

export function attachWindowStateEvents(win: BrowserWindow) {
  const send = (channel: string) => win.webContents.send(channel);
  win.on("enter-full-screen", () => send("window:entered-fullscreen"));
  win.on("leave-full-screen", () => send("window:left-fullscreen"));
}
