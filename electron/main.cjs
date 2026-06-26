const { app, BrowserWindow, Notification, ipcMain, shell, safeStorage, clipboard } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const isDev = !app.isPackaged;
let mainWindow = null;
let currentRecordingState = "idle";
const activeRecordingStates = new Set(["recording", "paused"]);
const execFileAsync = promisify(execFile);

function isBrokenPipeError(error) {
  return error?.code === "EPIPE";
}

function ignoreBrokenPipe(error) {
  if (!isBrokenPipeError(error)) {
    throw error;
  }
}

process.stdout?.on?.("error", ignoreBrokenPipe);
process.stderr?.on?.("error", ignoreBrokenPipe);

process.on("uncaughtException", (error) => {
  if (isBrokenPipeError(error)) {
    return;
  }

  throw error;
});

const defaultSettings = {
  transcriptionProvider: "local-whisper",
  apiProvider: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  modelName: "whisper-1",
  summaryModelName: "gpt-4o-mini",
  localWhisperCommand: "",
  localWhisperModel: "base",
  localWhisperModelPath: "",
  transcriptionLanguage: "mixed",
  transcriptionPrompt: "這是工作討論錄音，內容可能包含繁體中文、英文專有名詞、產品名稱、工程術語、Kenny、PM、LIFF、API。請保留英文術語並使用繁體中文標點。"
};

function getConfigPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function getHistoryPath() {
  return path.join(app.getPath("userData"), "history.json");
}

function getTranscriptMarkdown(transcript, recording, settings) {
  const startedAt = recording?.startedAt ? new Date(recording.startedAt) : new Date();
  const endedAt = recording?.endedAt ? new Date(recording.endedAt) : null;
  const date = startedAt.toISOString().slice(0, 10);
  const startedTime = startedAt.toTimeString().slice(0, 5);
  const endedTime = endedAt ? endedAt.toTimeString().slice(0, 5) : "";
  const mode =
    settings.transcriptionProvider === "local-whisper"
      ? "Local Whisper"
      : settings.apiProvider === "custom"
        ? "Custom API endpoint"
        : "OpenAI-compatible API";
  const lines = [
    "# 工作討論逐字稿",
    "",
    `日期：${date}`,
    `時間：${endedTime ? `${startedTime} - ${endedTime}` : startedTime}`,
    `轉錄方式：${mode}`,
    "",
    "## 逐字稿",
    ""
  ];

  for (const segment of transcript?.segments ?? []) {
    lines.push(`[${segment.time}] ${segment.text}`);
  }

  if (!transcript?.segments?.length && transcript?.text) {
    lines.push(transcript.text);
  }

  return lines.join("\n");
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallbackValue;
    }

    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function encryptApiKey(apiKey) {
  if (!apiKey) {
    return "";
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("目前系統不支援安全儲存 API key");
  }

  return safeStorage.encryptString(apiKey).toString("base64");
}

function decryptApiKey(encryptedApiKey) {
  if (!encryptedApiKey) {
    return "";
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return "";
  }

  return safeStorage.decryptString(Buffer.from(encryptedApiKey, "base64"));
}

async function loadSettingsWithSecret() {
  const saved = await readJsonFile(getConfigPath(), {});
  const apiKey = decryptApiKey(saved.encryptedApiKey);

  return {
    ...defaultSettings,
    ...saved,
    apiKey,
    hasApiKey: Boolean(apiKey),
    encryptedApiKey: undefined
  };
}

async function loadSettingsForRenderer() {
  const settings = await loadSettingsWithSecret();
  const { apiKey, ...safeSettings } = settings;

  return safeSettings;
}

async function saveSettingsFromRenderer(input) {
  const current = await readJsonFile(getConfigPath(), {});
  const next = {
    ...defaultSettings,
    ...current,
    transcriptionProvider: input.transcriptionProvider ?? defaultSettings.transcriptionProvider,
    apiProvider: input.apiProvider ?? defaultSettings.apiProvider,
    baseUrl: input.baseUrl ?? defaultSettings.baseUrl,
    modelName: input.modelName ?? defaultSettings.modelName,
    summaryModelName: input.summaryModelName ?? defaultSettings.summaryModelName,
    localWhisperCommand: input.localWhisperCommand ?? "",
    localWhisperModel: input.localWhisperModel ?? defaultSettings.localWhisperModel,
    localWhisperModelPath: input.localWhisperModelPath ?? "",
    transcriptionLanguage: input.transcriptionLanguage ?? defaultSettings.transcriptionLanguage,
    transcriptionPrompt: input.transcriptionPrompt ?? defaultSettings.transcriptionPrompt
  };

  if (Object.prototype.hasOwnProperty.call(input, "apiKey")) {
    next.encryptedApiKey = encryptApiKey(input.apiKey);
  }

  await writeJsonFile(getConfigPath(), next);
  return loadSettingsForRenderer();
}

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

function parseRecordingDateFromFilename(filename) {
  const match = filename.match(/work-memory-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);

  if (!match) {
    return null;
  }

  return new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}`);
}

function getMimeTypeFromExtension(extension) {
  if (extension === ".m4a" || extension === ".mp4") {
    return "audio/mp4";
  }

  if (extension === ".ogg") {
    return "audio/ogg";
  }

  return "audio/webm";
}

function getWhisperLanguageCode(settings) {
  if (settings.transcriptionLanguage === "zh") {
    return "zh";
  }

  if (settings.transcriptionLanguage === "en") {
    return "en";
  }

  return "";
}

function getTranscriptionPrompt(settings) {
  return settings.transcriptionPrompt?.trim() || defaultSettings.transcriptionPrompt;
}

async function listSavedRecordings() {
  const recordingsDir = path.join(app.getPath("userData"), "recordings");

  await fs.mkdir(recordingsDir, { recursive: true });

  const files = await fs.readdir(recordingsDir);
  const recordings = [];

  for (const filename of files) {
    const extension = path.extname(filename);

    if (![".webm", ".m4a", ".mp4", ".ogg"].includes(extension)) {
      continue;
    }

    const filePath = path.join(recordingsDir, filename);
    const stats = await fs.stat(filePath);
    const recordedAt = parseRecordingDateFromFilename(filename) ?? stats.mtime;

    recordings.push({
      id: filePath,
      filename,
      filePath,
      mimeType: getMimeTypeFromExtension(extension),
      startedAt: recordedAt.toISOString(),
      endedAt: "",
      date: recordedAt.toISOString().slice(0, 10),
      time: recordedAt.toTimeString().slice(0, 8),
      size: stats.size,
      title: `${recordedAt.toISOString().slice(0, 10)} ${recordedAt.toTimeString().slice(0, 5)}`
    });
  }

  return recordings.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
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

async function resolveCommandPath(command) {
  if (!command) {
    return "";
  }

  const expandedCommand = command.replace(/^~/, os.homedir());

  if (path.isAbsolute(expandedCommand) || expandedCommand.includes("/")) {
    return expandedCommand;
  }

  const pathEnv = [
    path.join(os.homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH
  ]
    .filter(Boolean)
    .join(":");

  try {
    const { stdout } = await execFileAsync(
      "zsh",
      ["-lc", 'command -v -- "$1"', "zsh", expandedCommand],
      {
        env: {
          ...process.env,
          PATH: pathEnv
        },
        timeout: 3000
      }
    );

    return stdout.trim();
  } catch {
    return "";
  }
}

function getWhisperExecutionEnv() {
  return {
    ...process.env,
    PATH: [
      path.join(os.homedir(), ".local/bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      process.env.PATH
    ]
      .filter(Boolean)
      .join(":")
  };
}

async function execWhisper(command, args) {
  const commandPath = await resolveCommandPath(command);

  if (!commandPath) {
    throw new Error(`找不到 Local Whisper 指令：${command}`);
  }

  return execFileAsync(commandPath, args, {
    env: getWhisperExecutionEnv(),
    timeout: 30 * 60 * 1000
  });
}

async function getCommandCheck(command) {
  const commandPath = await resolveCommandPath(command);

  return {
    installed: Boolean(commandPath),
    path: commandPath
  };
}

async function commandExists(command) {
  try {
    return Boolean(await resolveCommandPath(command));
  } catch {
    return false;
  }
}

async function detectLocalWhisperTools() {
  const candidates = [
    {
      id: "whisper-cli",
      label: "whisper.cpp whisper-cli",
      command: "whisper-cli",
      install: [
        "brew install whisper-cpp",
        "下載模型，例如：curl -L -o ~/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        "在設定頁填入 Local model path，例如 ~/ggml-base.bin"
      ]
    },
    {
      id: "whisper",
      label: "OpenAI Whisper Python CLI",
      command: "whisper",
      install: ["pipx install openai-whisper", "或使用 pip install -U openai-whisper"]
    },
    {
      id: "mlx_whisper",
      label: "MLX Whisper",
      command: "mlx_whisper",
      install: ["pipx install mlx-whisper", "適合 Apple Silicon 的本機轉錄方案"]
    }
  ];
  const checked = [];

  for (const candidate of candidates) {
    const commandCheck = await getCommandCheck(candidate.command);

    checked.push({
      ...candidate,
      installed: commandCheck.installed,
      path: commandCheck.path
    });
  }

  return {
    installed: checked.filter((tool) => tool.installed),
    checked
  };
}

async function createApiTranscript({ apiKey, filePath, mimeType, settings }) {
  const audioBuffer = await fs.readFile(filePath);
  const formData = new FormData();
  const baseUrl = (settings.baseUrl || defaultSettings.baseUrl).replace(/\/$/, "");

  formData.append(
    "file",
    new Blob([audioBuffer], { type: mimeType || "audio/webm" }),
    path.basename(filePath)
  );
  formData.append("model", settings.modelName || defaultSettings.modelName);
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");

  const languageCode = getWhisperLanguageCode(settings);
  const prompt = getTranscriptionPrompt(settings);

  if (languageCode) {
    formData.append("language", languageCode);
  }

  if (prompt) {
    formData.append("prompt", prompt);
  }

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
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

function parseVttOrSrt(text) {
  const blocks = text.split(/\n\s*\n/);
  const segments = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const timeLine = lines.find((line) => line.includes("-->"));

    if (!timeLine) {
      continue;
    }

    const body = lines.filter((line) => !line.includes("-->") && !/^\d+$/.test(line)).join(" ");
    const start = timeLine.split("-->")[0].trim().replace(",", ".");
    const match = start.match(/(?:(\d+):)?(\d+):(\d+)/);

    if (body && match) {
      const hours = Number(match[1] ?? 0);
      const minutes = Number(match[2] ?? 0);
      const seconds = Number(match[3] ?? 0);
      segments.push({
        start: hours * 3600 + minutes * 60 + seconds,
        end: 0,
        time: formatSeconds(hours * 3600 + minutes * 60 + seconds),
        text: body
      });
    }
  }

  return segments;
}

async function createLocalWhisperTranscript({ filePath, settings }) {
  const detection = await detectLocalWhisperTools();
  const preferredCommand =
    settings.localWhisperCommand || detection.installed[0]?.command || "";

  if (!preferredCommand) {
    const installs = detection.checked
      .map((tool) => `${tool.label}: ${tool.install.join("；")}`)
      .join("\n");

    throw new Error(`尚未安裝 Local Whisper 工具。可安裝其中一種：\n${installs}`);
  }

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-memory-transcript-"));
  const outputPrefix = path.join(outputDir, "transcript");
  const commandName = path.basename(preferredCommand);
  const languageCode = getWhisperLanguageCode(settings);
  const prompt = getTranscriptionPrompt(settings);

  if (commandName === "whisper") {
    const args = [
      filePath,
      "--model",
      settings.localWhisperModel || "base",
      "--output_format",
      "vtt",
      "--output_dir",
      outputDir
    ];

    if (languageCode) {
      args.push("--language", languageCode);
    }

    if (prompt) {
      args.push("--initial_prompt", prompt);
    }

    await execWhisper(preferredCommand, args);
  } else if (commandName === "mlx_whisper") {
    const args = [
      filePath,
      "--model",
      settings.localWhisperModel || "mlx-community/whisper-base",
      "--output-format",
      "vtt",
      "--output-dir",
      outputDir
    ];

    if (languageCode) {
      args.push("--language", languageCode);
    }

    if (prompt) {
      args.push("--initial-prompt", prompt);
    }

    await execWhisper(preferredCommand, args);
  } else {
    if (!settings.localWhisperModelPath) {
      throw new Error("whisper.cpp 需要在設定頁填入 Local model path，例如 ~/ggml-base.bin");
    }

    const args = [
      "-m",
      settings.localWhisperModelPath.replace(/^~/, os.homedir()),
      "-f",
      filePath,
      "-ovtt",
      "-of",
      outputPrefix
    ];

    if (languageCode) {
      args.push("-l", languageCode);
    }

    if (prompt) {
      args.push("--prompt", prompt);
    }

    await execWhisper(preferredCommand, args);
  }

  const files = await fs.readdir(outputDir);
  const transcriptFile = files.find((file) => file.endsWith(".vtt") || file.endsWith(".srt") || file.endsWith(".txt"));

  if (!transcriptFile) {
    throw new Error("Local Whisper 已執行，但沒有找到輸出的逐字稿檔案");
  }

  const transcriptText = await fs.readFile(path.join(outputDir, transcriptFile), "utf8");
  const segments = parseVttOrSrt(transcriptText);

  return {
    text: segments.length ? segments.map((segment) => segment.text).join(" ") : transcriptText.trim(),
    segments: segments.length ? segments : [{ start: 0, end: 0, time: "00:00", text: transcriptText.trim() }]
  };
}

async function createTranscript({ apiKey, recording, settings }) {
  if (settings.transcriptionProvider === "local-whisper") {
    return createLocalWhisperTranscript({
      filePath: recording.filePath,
      settings
    });
  }

  if (!apiKey?.trim()) {
    throw new Error("API 模式需要先在設定頁儲存 API key");
  }

  return createApiTranscript({
    apiKey,
    filePath: recording.filePath,
    mimeType: recording.mimeType,
    settings
  });
}

async function createAiSummary({ apiKey, transcriptSegments, settings }) {
  const baseUrl = (settings.baseUrl || defaultSettings.baseUrl).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.summaryModelName || defaultSettings.summaryModelName,
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

function createBasicLocalSummary(transcriptSegments) {
  return {
    discussionSummary: transcriptSegments.map((segment) => ({
      text: segment.text,
      sourceTime: segment.time
    })),
    stakeholderRequests: [],
    kennyTasks: [],
    otherTasks: [],
    decisionsMade: [],
    undecidedItems: [],
    risksAndBlockers: [],
    tomorrowReminders: []
  };
}

async function loadHistory() {
  return readJsonFile(getHistoryPath(), []);
}

async function saveHistoryRecord(record) {
  const history = await loadHistory();
  const nextRecord = {
    ...record,
    id: record.id || `record-${Date.now()}`,
    createdAt: record.createdAt || new Date().toISOString()
  };
  const nextHistory = [nextRecord, ...history.filter((item) => item.id !== nextRecord.id)];

  await writeJsonFile(getHistoryPath(), nextHistory);
  return nextRecord;
}

async function deleteHistoryRecord(recordId) {
  const history = await loadHistory();
  const target = history.find((item) => item.id === recordId);
  const nextHistory = history.filter((item) => item.id !== recordId);

  await writeJsonFile(getHistoryPath(), nextHistory);

  if (target?.transcriptMarkdownPath) {
    try {
      await fs.unlink(target.transcriptMarkdownPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return nextHistory;
}

async function saveTranscriptMarkdown(recording, transcript, settings) {
  const markdown = getTranscriptMarkdown(transcript, recording, settings);
  const transcriptsDir = path.join(app.getPath("userData"), "transcripts");
  const startedAt = recording?.startedAt ? new Date(recording.startedAt) : new Date();
  const filename = `transcript-${startedAt.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "")}.md`;
  const filePath = path.join(transcriptsDir, filename);

  await fs.mkdir(transcriptsDir, { recursive: true });
  await fs.writeFile(filePath, markdown, "utf8");

  return {
    markdown,
    filePath,
    filename
  };
}

async function downloadMarkdown(markdown, suggestedName = "work-memory-transcript.md") {
  const downloadsDir = app.getPath("downloads");
  const safeName = suggestedName.replace(/[/:]/g, "-");
  const filePath = path.join(downloadsDir, safeName.endsWith(".md") ? safeName : `${safeName}.md`);

  await fs.writeFile(filePath, markdown, "utf8");
  shell.showItemInFolder(filePath);

  return { filePath };
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

  ipcMain.handle("recording:list", async () => listSavedRecordings());

  ipcMain.handle("ai:process-recording", async (_event, request) => {
    const { recording } = request ?? {};
    const settings = await loadSettingsWithSecret();
    const apiKey = settings.apiKey;

    if (!recording?.filePath || !path.isAbsolute(recording.filePath)) {
      throw new Error("找不到可整理的本機音訊檔");
    }

    const transcript = await createTranscript({
      apiKey,
      recording,
      settings
    });
    const markdownFile = await saveTranscriptMarkdown(recording, transcript, settings);
    let summary = createBasicLocalSummary(transcript.segments);

    if (settings.transcriptionProvider !== "local-whisper" || apiKey) {
      summary = await createAiSummary({
        apiKey,
        transcriptSegments: transcript.segments,
        settings
      });
    }

    const historyRecord = await saveHistoryRecord({
      title: `工作逐字稿 ${new Date(recording.startedAt ?? Date.now()).toLocaleString("zh-TW")}`,
      date: new Date(recording.startedAt ?? Date.now()).toISOString().slice(0, 10),
      recording,
      transcript,
      transcriptMarkdown: markdownFile.markdown,
      transcriptMarkdownPath: markdownFile.filePath,
      summary,
      provider: settings.transcriptionProvider,
      status: "completed"
    });

    return {
      transcript,
      summary,
      transcriptMarkdown: markdownFile.markdown,
      transcriptMarkdownPath: markdownFile.filePath,
      historyRecord
    };
  });

  ipcMain.handle("settings:load", async () => loadSettingsForRenderer());

  ipcMain.handle("settings:save", async (_event, settings) =>
    saveSettingsFromRenderer(settings)
  );

  ipcMain.handle("settings:clear-api-key", async () => {
    const current = await readJsonFile(getConfigPath(), {});
    delete current.encryptedApiKey;
    await writeJsonFile(getConfigPath(), current);
    return loadSettingsForRenderer();
  });

  ipcMain.handle("settings:test-connection", async (_event, settingsInput) => {
    const settings = {
      ...(await loadSettingsWithSecret()),
      ...settingsInput
    };

    if (settings.transcriptionProvider === "local-whisper") {
      const detection = await detectLocalWhisperTools();

      if (!detection.installed.length) {
        throw new Error("尚未偵測到 Local Whisper 工具");
      }

      return { ok: true, message: `已偵測到 ${detection.installed[0].label}` };
    }

    if (!settings.apiKey?.trim()) {
      throw new Error("請先輸入並儲存 API key");
    }

    const baseUrl = (settings.baseUrl || defaultSettings.baseUrl).replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${settings.apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`連線測試失敗：HTTP ${response.status}`);
    }

    return { ok: true, message: "API 連線成功" };
  });

  ipcMain.handle("whisper:detect", async () => detectLocalWhisperTools());

  ipcMain.handle("history:list", async () => loadHistory());

  ipcMain.handle("history:delete", async (_event, recordId) => {
    if (!recordId) {
      throw new Error("缺少逐字稿紀錄 ID");
    }

    return deleteHistoryRecord(recordId);
  });

  ipcMain.handle("markdown:copy", async (_event, markdown) => {
    clipboard.writeText(markdown || "");
    return true;
  });

  ipcMain.handle("markdown:download", async (_event, { markdown, filename }) =>
    downloadMarkdown(markdown, filename)
  );

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
