const { app, BrowserWindow, Notification, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = !app.isPackaged;
let mainWindow = null;
let currentRecordingState = "idle";
const activeRecordingStates = new Set(["recording", "paused"]);

function getRecordingExtension(mimeType) {
  if (mimeType?.includes("mp4")) {
    return "m4a";
  }

  if (mimeType?.includes("ogg")) {
    return "ogg";
  }

  return "webm";
}

function getRecordingFilename(startedAt, mimeType) {
  const date = startedAt ? new Date(startedAt) : new Date();
  const timestamp = date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "");
  const extension = getRecordingExtension(mimeType);

  return `work-memory-${timestamp}.${extension}`;
}

function formatSeconds(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "00:00";
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getSummarySchema() {
  const itemSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      text: {
        type: "string",
        description: "整理後的重點內容"
      },
      sourceTime: {
        type: "string",
        description: "來源時間點，例如 03:12"
      }
    },
    required: ["text", "sourceTime"]
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      discussionSummary: { type: "array", items: itemSchema },
      stakeholderRequests: { type: "array", items: itemSchema },
      kennyTasks: { type: "array", items: itemSchema },
      otherTasks: { type: "array", items: itemSchema },
      decisionsMade: { type: "array", items: itemSchema },
      undecidedItems: { type: "array", items: itemSchema },
      risksAndBlockers: { type: "array", items: itemSchema },
      tomorrowReminders: { type: "array", items: itemSchema }
    },
    required: [
      "discussionSummary",
      "stakeholderRequests",
      "kennyTasks",
      "otherTasks",
      "decisionsMade",
      "undecidedItems",
      "risksAndBlockers",
      "tomorrowReminders"
    ]
  };
}

function getSummaryPrompt(transcriptSegments) {
  const transcriptText = transcriptSegments
    .map((segment) => `[${segment.time}] ${segment.text}`)
    .join("\n");

  return `請用繁體中文整理以下工作討論逐字稿。每一個任務或重點都必須保留最接近的來源時間點，來源時間點請從逐字稿方括號中選取。

請整理成這 8 類：
1. 今日討論摘要
2. 主管 / 利害關係人交辦事項
3. Kenny 待處理任務
4. 其他人待處理任務
5. 已決策事項
6. 尚未決策事項
7. 風險與阻塞
8. 明日提醒

如果某一類沒有內容，回傳空陣列。

逐字稿：
${transcriptText}`;
}

function extractResponseText(responseJson) {
  if (typeof responseJson.output_text === "string") {
    return responseJson.output_text;
  }

  const textParts = [];

  for (const outputItem of responseJson.output ?? []) {
    for (const contentItem of outputItem.content ?? []) {
      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        textParts.push(contentItem.text);
      }
    }
  }

  return textParts.join("\n");
}

async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text();

  if (!response.ok) {
    let detail = text;

    try {
      detail = JSON.parse(text).error?.message ?? text;
    } catch {
      // Keep the raw text if the API did not return JSON.
    }

    throw new Error(`${fallbackMessage}：${detail}`);
  }

  return JSON.parse(text);
}

async function createTranscript({ apiKey, filePath, mimeType }) {
  const audioBuffer = await fs.readFile(filePath);
  const formData = new FormData();

  formData.append(
    "file",
    new Blob([audioBuffer], { type: mimeType || "audio/webm" }),
    path.basename(filePath)
  );
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });

  const transcription = await readJsonResponse(response, "逐字稿產生失敗");
  const segments = (transcription.segments ?? []).map((segment) => ({
    start: segment.start,
    end: segment.end,
    time: formatSeconds(segment.start),
    text: String(segment.text ?? "").trim()
  }));

  if (!segments.length && transcription.text) {
    segments.push({
      start: 0,
      end: 0,
      time: "00:00",
      text: String(transcription.text).trim()
    });
  }

  return {
    text: transcription.text ?? segments.map((segment) => segment.text).join(" "),
    segments
  };
}

async function createAiSummary({ apiKey, transcriptSegments }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.5",
      input: [
        {
          role: "system",
          content:
            "你是謹慎的工作記憶助理。只根據逐字稿整理，不要編造沒有出現的事項。"
        },
        {
          role: "user",
          content: getSummaryPrompt(transcriptSegments)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "work_memory_summary",
          strict: true,
          schema: getSummarySchema()
        }
      }
    })
  });

  const responseJson = await readJsonResponse(response, "AI 整理失敗");
  const responseText = extractResponseText(responseJson);

  if (!responseText) {
    throw new Error("AI 整理失敗：沒有收到整理結果");
  }

  return JSON.parse(responseText);
}

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

  ipcMain.handle("recording:save", async (_event, recording) => {
    const { audioData, mimeType, startedAt, endedAt } = recording ?? {};

    if (!audioData) {
      throw new Error("沒有收到錄音資料");
    }

    const recordingsDir = path.join(app.getPath("userData"), "recordings");
    const filename = getRecordingFilename(startedAt, mimeType);
    const filePath = path.join(recordingsDir, filename);
    const buffer = Buffer.from(audioData);

    await fs.mkdir(recordingsDir, { recursive: true });
    await fs.writeFile(filePath, buffer);

    return {
      filePath,
      filename,
      mimeType,
      startedAt,
      endedAt
    };
  });

  ipcMain.handle("recording:show-in-folder", async (_event, filePath) => {
    if (!filePath || !path.isAbsolute(filePath)) {
      throw new Error("音訊檔路徑不正確");
    }

    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("ai:process-recording", async (_event, request) => {
    const { apiKey, recording } = request ?? {};

    if (!apiKey?.trim()) {
      throw new Error("請先到設定頁貼上 API key");
    }

    if (!recording?.filePath || !path.isAbsolute(recording.filePath)) {
      throw new Error("找不到可整理的本機音訊檔");
    }

    const transcript = await createTranscript({
      apiKey: apiKey.trim(),
      filePath: recording.filePath,
      mimeType: recording.mimeType
    });
    const summary = await createAiSummary({
      apiKey: apiKey.trim(),
      transcriptSegments: transcript.segments
    });

    return {
      transcript,
      summary
    };
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
