import { app, BrowserWindow, ipcMain, screen, session, shell } from "electron";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { contentSecurityPolicy } from "./csp";
import { isOpenableExternally } from "./security/externalUrl";
import { initDevLog, devLog, devLogFromRenderer } from "./devLog";
import { registerAppPingHandler } from "./ipc/appPing";
import { registerFilesystemHandlers } from "./ipc/filesystem";
import { registerAppLauncherHandlers } from "./ipc/appLauncher";
import { registerWindowControlHandlers, attachWindowStateEvents } from "./ipc/windowControls";
import { registerSystemStatsHandlers, startSystemStatsBroadcast } from "./ipc/systemStats";
import { registerLocationHandlers } from "./ipc/location";
import { registerSettingsHandlers } from "./ipc/settings";
import { registerChatHistoryHandlers } from "./ipc/chatHistory";
import { registerMemoryHandlers } from "./ipc/memory";
import { registerAgentHandlers } from "./ipc/agent";
import { registerAgentDataHandlers } from "./ipc/agentData";
import { registerMcpHandlers } from "./ipc/mcp";
import { registerConnectorHandlers } from "./ipc/connectors";
import { registerHttpToolHandlers } from "./ipc/httpTools";
import { registerVoiceHandlers } from "./ipc/voice";
import { registerTokenUsageHandlers } from "./ipc/tokenUsage";
import { registerKnowledgeBaseHandlers } from "./ipc/knowledgeBase";
import { registerTaskHandlers } from "./ipc/tasks";
import { registerUserInfoHandlers } from "./ipc/userInfo";
import { registerAppInfoHandlers } from "./ipc/appInfo";
import { ensureAppDirectories, migrateLegacyUserData } from "./appDirs";
import { startExplorerDaemon, stopExplorerDaemon } from "./ai/webSearchDaemon";
import { startTaskScheduler, stopTaskScheduler } from "./tasks/scheduler";

function applyContentSecurityPolicy() {
  const policy = contentSecurityPolicy(is.dev);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [policy] },
    });
  });
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width,
    height,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    resizable: false,
    roundedCorners: false,
    backgroundColor: "#00060f",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  attachWindowStateEvents(win);

  // The renderer filters these too (ChatBubble, ChatImage), but main must not depend on it
  // having done so — one future unguarded window.open would otherwise hand a file:// or
  // smb:// URL straight to the OS. Refusals are logged rather than thrown: this handler's
  // contract is to return an action, and throwing here would surface as an Electron
  // internal error rather than anything the user could act on.
  win.webContents.setWindowOpenHandler((details) => {
    if (isOpenableExternally(details.url)) {
      shell.openExternal(details.url);
    } else {
      devLog("[security] refused to open external URL:", details.url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
    }
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  initDevLog();
  // Before createWindow(): the handler has to be registered on the session before the
  // renderer's own document is fetched, or the first load runs unprotected.
  applyContentSecurityPolicy();
  ipcMain.handle("devLog:write", (_event, ...args: unknown[]) => devLogFromRenderer(...args));
  // Before ensureAppDirectories(): empty directories at the new root would block the move.
  migrateLegacyUserData();
  ensureAppDirectories();
  registerAppPingHandler();
  registerFilesystemHandlers();
  registerAppLauncherHandlers();
  registerWindowControlHandlers();
  registerSystemStatsHandlers();
  startSystemStatsBroadcast();
  registerLocationHandlers();
  // Location now comes from a main-process IP lookup (electron/main/ipc/location.ts),
  // not Chromium's navigator.geolocation, so no permission type needs gating here anymore
  // — this just keeps Electron's implicit-allow default explicit for everything else
  // (e.g. microphone, used by voice input).
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true);
  });
  registerSettingsHandlers();
  registerChatHistoryHandlers();
  registerMemoryHandlers();
  registerAgentHandlers();
  registerAgentDataHandlers();
  registerMcpHandlers();
  registerConnectorHandlers();
  registerHttpToolHandlers();
  registerVoiceHandlers();
  registerTokenUsageHandlers();
  registerKnowledgeBaseHandlers();
  registerTaskHandlers();
  registerUserInfoHandlers();
  registerAppInfoHandlers();
  // Fire-and-forget: Explorer's tools await getExplorerDaemonPort() themselves, so a
  // slow/failed daemon start doesn't block app launch — it just fails that tool call later.
  void startExplorerDaemon();
  startTaskScheduler();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopExplorerDaemon();
  stopTaskScheduler();
});
