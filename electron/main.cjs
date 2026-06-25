const { app, BrowserWindow, Notification, ipcMain } = require("electron");
const path = require("node:path");

const isDev = !app.isPackaged;
let mainWindow = null;
let currentRecordingState = "idle";
const activeRecordingStates = new Set(["recording", "paused"]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 660,
    title: "工作記憶助理 Work Memory Agent",
    backgroundColor: "#f6f3ee",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/preload.js")
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

function getMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return createWindow();
  }

  return mainWindow;
}

function showMainWindow() {
  const window = getMainWindow();

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();

  return window;
}

function sendToRenderer(channel) {
  const window = showMainWindow();
  const send = () => window.webContents.send(channel);

  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

function showMorningNotification() {
  if (!Notification.isSupported()) {
    sendToRenderer("schedule:open-today");
    return;
  }

  const notification = new Notification({
    title: "工作記憶助理",
    body: "是否開始今日工作記錄？"
  });

  notification.on("click", () => {
    sendToRenderer("schedule:open-today");
  });

  notification.show();
}

function stopRecordingIfNeeded() {
  if (!activeRecordingStates.has(currentRecordingState)) {
    return;
  }

  sendToRenderer("schedule:auto-stop");
}

function getDelayUntil(hour, minute) {
  const now = new Date();
  const next = new Date(now);

  next.setHours(hour, minute, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

function scheduleDaily(hour, minute, callback) {
  const scheduleNextRun = () => {
    const timer = setTimeout(() => {
      callback();
      scheduleNextRun();
    }, getDelayUntil(hour, minute));
  };

  scheduleNextRun();
}

function setupSchedules() {
  if (process.env.WMA_TEST_SCHEDULE === "1") {
    setTimeout(showMorningNotification, 5000);
    setTimeout(stopRecordingIfNeeded, 15000);
    return;
  }

  scheduleDaily(10, 0, showMorningNotification);
  scheduleDaily(19, 0, stopRecordingIfNeeded);
}

app.whenReady().then(() => {
  ipcMain.on("recording-state:changed", (_event, state) => {
    if (["idle", "recording", "paused", "stopped"].includes(state)) {
      currentRecordingState = state;
    }
  });

  createWindow();
  setupSchedules();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
