import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  KeyRound,
  ListChecks,
  Mic,
  Pause,
  Play,
  Search,
  ShieldCheck,
  Square,
  UsersRound
} from "lucide-react";

const todaySections = [
  {
    title: "今日討論摘要",
    items: [
      "釐清 Q3 客戶回訪流程，PM 希望先整理高價值客戶名單。",
      "工程師提醒資料同步規格還需要補上錯誤重試策略。"
    ]
  },
  {
    title: "主管 / 利害關係人交辦事項",
    items: [
      "主管請 Kenny 週五前整理專案風險清單。",
      "業務主管希望明天確認試用客戶的導入時間。"
    ]
  },
  {
    title: "Kenny 待處理任務",
    items: [
      "更新工作流程草稿。",
      "把資料匯出格式整理成 Markdown 範例。"
    ]
  },
  {
    title: "其他人待處理任務",
    items: [
      "PM 補齊需求優先順序。",
      "工程師評估錄音檔本機保存策略。"
    ]
  },
  {
    title: "已決策事項",
    items: [
      "第一版只做個人使用。",
      "第一版不做螢幕錄製、滑鼠監看與鍵盤記錄。"
    ]
  },
  {
    title: "尚未決策事項",
    items: [
      "摘要產出後是否需要人工確認才保存。",
      "歷史搜尋第一版要支援哪些篩選條件。"
    ]
  },
  {
    title: "風險與阻塞",
    items: [
      "錄音權限與通知權限需要清楚提示使用者手動同意。",
      "若 API key 未設定，AI 摘要功能之後需要有明確空狀態。"
    ]
  },
  {
    title: "明日提醒",
    items: [
      "上午確認主管交辦的風險清單格式。",
      "下午回覆 PM 關於匯出 Markdown 欄位。"
    ]
  }
];

const historyRecords = [
  {
    date: "2026-06-24",
    title: "客戶回訪節奏討論",
    summary: "確認優先聯絡高價值客戶，待 PM 補上名單欄位。",
    tags: ["PM", "客戶", "待辦"]
  },
  {
    date: "2026-06-23",
    title: "本機資料保存策略",
    summary: "決定第一版所有資料先保存在本機，不做團隊共享。",
    tags: ["決策", "隱私", "本機"]
  },
  {
    date: "2026-06-21",
    title: "主管 1:1",
    summary: "主管希望 Kenny 建立每天工作摘要與明日提醒。",
    tags: ["主管", "任務", "提醒"]
  }
];

const privacyRules = [
  "不做無感監控",
  "未手動確認前不錄音",
  "不記錄鍵盤輸入",
  "第一版不錄螢幕",
  "第一版不監看滑鼠操作",
  "資料先存在本機"
];

const aiSummarySections = [
  ["discussionSummary", "今日討論摘要"],
  ["stakeholderRequests", "主管 / 利害關係人交辦事項"],
  ["kennyTasks", "Kenny 待處理任務"],
  ["otherTasks", "其他人待處理任務"],
  ["decisionsMade", "已決策事項"],
  ["undecidedItems", "尚未決策事項"],
  ["risksAndBlockers", "風險與阻塞"],
  ["tomorrowReminders", "明日提醒"]
];

function getPreferredMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];

  if (!window.MediaRecorder?.isTypeSupported) {
    return "";
  }

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function App() {
  const [activeView, setActiveView] = useState("today");
  const [recordingState, setRecordingState] = useState("idle");
  const recordingStateRef = useRef(recordingState);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const mediaStreamRef = useRef(null);
  const recordingStartedAtRef = useRef(null);
  const [query, setQuery] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [schedulePrompt, setSchedulePrompt] = useState(null);
  const [recordingError, setRecordingError] = useState("");
  const [savedRecording, setSavedRecording] = useState(null);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const [aiStatus, setAiStatus] = useState("idle");
  const [aiError, setAiError] = useState("");
  const [transcript, setTranscript] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);

  useEffect(() => {
    recordingStateRef.current = recordingState;
    window.workMemorySchedule?.updateRecordingState(recordingState);
  }, [recordingState]);

  useEffect(() => {
    const scheduleApi = window.workMemorySchedule;

    if (!scheduleApi) {
      return undefined;
    }

    const removeOpenToday = scheduleApi.onOpenToday(() => {
      setActiveView("today");
      setSchedulePrompt({
        type: "morning",
        title: "是否開始今日工作記錄？",
        message: "請手動按「開始記錄」才會進入記錄中狀態。"
      });
    });

    const removeAutoStop = scheduleApi.onAutoStop(() => {
      const currentState = recordingStateRef.current;

      setActiveView("today");

      if (currentState === "recording" || currentState === "paused") {
        stopRecording({ showSummaryPrompt: true });
        return;
      }

      setSchedulePrompt(null);
    });

    return () => {
      removeOpenToday();
      removeAutoStop();
    };
  }, []);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return historyRecords;
    }

    return historyRecords.filter((record) => {
      const haystack = [
        record.date,
        record.title,
        record.summary,
        ...record.tags
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [query]);

  const statusLabel =
    recordingState === "recording"
      ? "記錄中"
      : recordingState === "paused"
        ? "已暫停"
        : recordingState === "stopped"
          ? "已停止，摘要已產生"
          : "尚未開始";

  const markdownPreview = useMemo(() => {
    const lines = ["# 2026-06-25 工作摘要", ""];

    todaySections.forEach((section) => {
      lines.push(`## ${section.title}`);
      section.items.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    });

    return lines.join("\n");
  }, []);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    };
  }, []);

  async function startRecording() {
    setRecordingError("");
    setSavedRecording(null);
    setAiStatus("idle");
    setAiError("");
    setTranscript(null);
    setAiSummary(null);
    setSchedulePrompt(null);
    setActiveView("today");

    if (recordingStateRef.current === "recording") {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingError("這個環境不支援麥克風錄音，請改用桌面 App 開啟。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      const mimeType = getPreferredMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      audioChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = new Date().toISOString();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setRecordingError("錄音時發生錯誤，請停止後再重新開始。");
      };

      recorder.onstop = async () => {
        const chunks = audioChunksRef.current;
        const recorderMimeType = recorder.mimeType || mimeType || "audio/webm";
        const startedAt = recordingStartedAtRef.current;
        const endedAt = new Date().toISOString();

        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        recordingStartedAtRef.current = null;

        if (!chunks.length) {
          setRecordingError("沒有收到可保存的音訊資料。");
          return;
        }

        if (!window.workMemoryAudio?.saveRecording) {
          setRecordingError("目前無法保存音訊檔，請用桌面 App 開啟。");
          return;
        }

        try {
          setIsSavingRecording(true);
          const audioBlob = new Blob(chunks, { type: recorderMimeType });
          const audioData = await audioBlob.arrayBuffer();
          const savedFile = await window.workMemoryAudio.saveRecording({
            audioData,
            mimeType: recorderMimeType,
            startedAt,
            endedAt
          });

          setSavedRecording(savedFile);

          if (apiKey.trim()) {
            processSavedRecording(savedFile);
          } else {
            setAiStatus("needs-key");
            setAiError("請先到設定頁貼上 API key，再回來產生 AI 整理。");
          }
        } catch (error) {
          setRecordingError(`音訊檔保存失敗：${error.message}`);
        } finally {
          setIsSavingRecording(false);
          audioChunksRef.current = [];
        }
      };

      recorder.start();
      setRecordingState("recording");
    } catch (error) {
      const guidance =
        error.name === "NotAllowedError" || error.name === "SecurityError"
          ? "麥克風權限未開啟。請到 macOS「系統設定 > 隱私權與安全性 > 麥克風」允許 Work Memory Agent，然後重新開啟 App。"
          : `無法開始錄音：${error.message}`;

      setRecordingError(guidance);
    }
  }

  function pauseRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
    }

    setRecordingState("paused");
  }

  function resumeRecording() {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
    }

    setRecordingState("recording");
  }

  function stopRecording(options = {}) {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    setRecordingState("stopped");
    setActiveView("today");

    if (options.showSummaryPrompt) {
      setSchedulePrompt({
        type: "ended",
        title: "今日記錄已結束，是否產生摘要？",
        message: "已在 19:00 自動停止。目前先保存音訊檔，尚未接 AI 轉文字。"
      });
    }
  }

  function dismissSchedulePrompt() {
    setSchedulePrompt(null);
  }

  function showSummaryFromPrompt() {
    setSchedulePrompt(null);
    setActiveView("today");
  }

  async function openRecordingFolder(filePath) {
    setRecordingError("");

    if (!window.workMemoryAudio?.showRecordingInFolder) {
      setRecordingError("目前無法開啟音訊檔資料夾，請用桌面 App 開啟。");
      return;
    }

    try {
      await window.workMemoryAudio.showRecordingInFolder(filePath);
    } catch (error) {
      setRecordingError(`無法開啟音訊檔資料夾：${error.message}`);
    }
  }

  async function processSavedRecording(recording = savedRecording) {
    setAiError("");

    if (!recording) {
      setAiError("請先完成一次錄音並保存音訊檔。");
      setAiStatus("error");
      return;
    }

    if (!apiKey.trim()) {
      setAiError("請先到設定頁貼上 API key。");
      setAiStatus("needs-key");
      setActiveView("settings");
      return;
    }

    if (!window.workMemoryAi?.processRecording) {
      setAiError("目前無法使用 AI 整理，請用桌面 App 開啟。");
      setAiStatus("error");
      return;
    }

    try {
      setAiStatus("processing");
      const result = await window.workMemoryAi.processRecording({
        apiKey,
        recording
      });

      setTranscript(result.transcript);
      setAiSummary(result.summary);
      setAiStatus("done");
      setActiveView("today");
    } catch (error) {
      setAiError(error.message);
      setAiStatus("error");
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">WM</div>
          <div>
            <h1>工作記憶助理</h1>
            <p>Work Memory Agent</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="主要功能">
          <button
            className={activeView === "today" ? "active" : ""}
            onClick={() => setActiveView("today")}
          >
            <CalendarDays size={18} />
            今日記錄
          </button>
          <button
            className={activeView === "history" ? "active" : ""}
            onClick={() => setActiveView("history")}
          >
            <Search size={18} />
            搜尋歷史
          </button>
          <button
            className={activeView === "export" ? "active" : ""}
            onClick={() => setActiveView("export")}
          >
            <Download size={18} />
            匯出 Markdown
          </button>
          <button
            className={activeView === "settings" ? "active" : ""}
            onClick={() => setActiveView("settings")}
          >
            <KeyRound size={18} />
            設定
          </button>
        </nav>

        <section className="privacy-panel" aria-label="隱私原則">
          <div className="panel-title">
            <ShieldCheck size={18} />
            隱私原則
          </div>
          <ul>
            {privacyRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </section>
      </aside>

      <section className="content-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">2026-06-25 星期四</p>
            <h2>今日工作記錄</h2>
          </div>
          <div className={`status-pill ${recordingState}`}>
            <Mic size={18} />
            {statusLabel}
          </div>
        </header>

        {activeView === "today" && (
          <TodayView
            recordingState={recordingState}
            schedulePrompt={schedulePrompt}
            recordingError={recordingError}
            savedRecording={savedRecording}
            isSavingRecording={isSavingRecording}
            aiStatus={aiStatus}
            aiError={aiError}
            transcript={transcript}
            aiSummary={aiSummary}
            onStart={startRecording}
            onPause={pauseRecording}
            onResume={resumeRecording}
            onStop={stopRecording}
            onDismissSchedulePrompt={dismissSchedulePrompt}
            onShowSummary={showSummaryFromPrompt}
            onOpenRecordingFolder={openRecordingFolder}
            onGenerateAiSummary={() => processSavedRecording()}
          />
        )}

        {activeView === "history" && (
          <HistoryView
            query={query}
            setQuery={setQuery}
            records={filteredRecords}
          />
        )}

        {activeView === "export" && (
          <ExportView markdownPreview={markdownPreview} />
        )}

        {activeView === "settings" && (
          <SettingsView apiKey={apiKey} setApiKey={setApiKey} />
        )}
      </section>
    </main>
  );
}

function TodayView({
  recordingState,
  schedulePrompt,
  recordingError,
  savedRecording,
  isSavingRecording,
  aiStatus,
  aiError,
  transcript,
  aiSummary,
  onStart,
  onPause,
  onResume,
  onStop,
  onDismissSchedulePrompt,
  onShowSummary,
  onOpenRecordingFolder,
  onGenerateAiSummary
}) {
  return (
    <div className="view-stack">
      <section className="control-band">
        <div>
          <p className="eyebrow">手動開始，不自動錄音</p>
          <h3>按下開始記錄後，才會請求麥克風並開始錄音</h3>
        </div>
        <div className="control-buttons">
          {recordingState === "idle" || recordingState === "stopped" ? (
            <button className="primary-action" onClick={onStart}>
              <Play size={18} />
              開始記錄
            </button>
          ) : null}

          {recordingState === "recording" ? (
            <button className="secondary-action" onClick={onPause}>
              <Pause size={18} />
              暫停
            </button>
          ) : null}

          {recordingState === "paused" ? (
            <button className="primary-action" onClick={onResume}>
              <Play size={18} />
              繼續
            </button>
          ) : null}

          {(recordingState === "recording" || recordingState === "paused") && (
            <button className="danger-action" onClick={onStop}>
              <Square size={18} />
              停止
            </button>
          )}
        </div>
      </section>

      <section className="recording-info">
        <div className="summary-title">
          <Mic size={18} />
          <h3>錄音狀態</h3>
        </div>
        <p>
          App 只會請求麥克風權限，不會錄螢幕，也不會記錄鍵盤輸入。
          第一次按「開始記錄」時，macOS 可能會跳出麥克風權限確認。
        </p>
        {(recordingState === "recording" || recordingState === "paused") ? (
          <div
            className={`recording-activity ${recordingState}`}
            aria-label={recordingState === "recording" ? "錄音正在進行" : "錄音已暫停"}
          >
            <span className="recording-dot" />
            <span className="recording-bars" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <strong>{recordingState === "recording" ? "錄音運行中" : "錄音已暫停"}</strong>
          </div>
        ) : null}
        {recordingState === "recording" ? (
          <p className="recording-live">記錄中：正在接收麥克風音訊。</p>
        ) : null}
        {recordingState === "paused" ? (
          <p className="recording-paused">已暫停：目前暫停寫入新的音訊片段。</p>
        ) : null}
        {isSavingRecording ? (
          <p className="recording-saving">正在保存音訊檔...</p>
        ) : null}
        {savedRecording ? (
          <p className="recording-saved">
            已保存音訊檔：
            <button
              className="recording-path-link"
              onClick={() => onOpenRecordingFolder(savedRecording.filePath)}
              type="button"
            >
              {savedRecording.filePath}
            </button>
          </p>
        ) : null}
        {savedRecording ? (
          <div className="ai-action-row">
            <button
              className="primary-action"
              disabled={aiStatus === "processing"}
              onClick={onGenerateAiSummary}
              type="button"
            >
              <ListChecks size={18} />
              {aiStatus === "processing" ? "AI 整理中..." : "產生 AI 整理"}
            </button>
            <span>
              {aiStatus === "done"
                ? "逐字稿與摘要已產生"
                : "會使用設定頁貼上的 API key"}
            </span>
          </div>
        ) : null}
        {aiError ? <p className="recording-error">{aiError}</p> : null}
        {recordingError ? (
          <p className="recording-error">{recordingError}</p>
        ) : null}
      </section>

      {(transcript || aiSummary) ? (
        <section className="ai-results">
          <div className="summary-title">
            <ListChecks size={18} />
            <h3>AI 整理結果</h3>
          </div>

          {transcript ? (
            <details className="transcript-panel">
              <summary>查看逐字稿與時間點</summary>
              <div className="transcript-list">
                {transcript.segments.map((segment) => (
                  <p key={`${segment.time}-${segment.text}`}>
                    <span>{segment.time}</span>
                    {segment.text}
                  </p>
                ))}
              </div>
            </details>
          ) : null}

          {aiSummary ? <AiSummaryGrid summary={aiSummary} /> : null}
        </section>
      ) : null}

      {schedulePrompt ? (
        <section className={`schedule-alert ${schedulePrompt.type}`}>
          <div>
            <p className="eyebrow">排程提醒</p>
            <h3>{schedulePrompt.title}</h3>
            <p>{schedulePrompt.message}</p>
          </div>
          <div className="control-buttons">
            {schedulePrompt.type === "ended" ? (
              <button className="primary-action" onClick={onShowSummary}>
                <ListChecks size={18} />
                產生摘要
              </button>
            ) : null}
            <button className="secondary-action" onClick={onDismissSchedulePrompt}>
              知道了
            </button>
          </div>
        </section>
      ) : null}

      <section className="schedule-grid">
        <InfoTile
          icon={<Bell size={20} />}
          title="10:00 提醒"
          detail="每天早上提醒開始今日工作記錄"
        />
        <InfoTile
          icon={<Clock3 size={20} />}
          title="19:00 自動停止"
          detail="若正在記錄，晚間自動停止並產生摘要"
        />
        <InfoTile
          icon={<UsersRound size={20} />}
          title="個人使用"
          detail="第一版不做團隊共享與背景監控"
        />
      </section>

      <section className="summary-grid">
        {todaySections.map((section) => (
          <article className="summary-card" key={section.title}>
            <div className="summary-title">
              <ListChecks size={18} />
              <h3>{section.title}</h3>
            </div>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}

function AiSummaryGrid({ summary }) {
  return (
    <section className="summary-grid ai-summary-grid">
      {aiSummarySections.map(([key, title]) => {
        const items = summary[key] ?? [];

        return (
          <article className="summary-card" key={key}>
            <div className="summary-title">
              <ListChecks size={18} />
              <h3>{title}</h3>
            </div>
            {items.length ? (
              <ul>
                {items.map((item, index) => (
                  <li key={`${key}-${index}`}>
                    <span className="source-time">{item.sourceTime}</span>
                    {item.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-summary">沒有整理到相關內容。</p>
            )}
          </article>
        );
      })}
    </section>
  );
}

function HistoryView({ query, setQuery, records }) {
  return (
    <div className="view-stack">
      <section className="search-band">
        <Search size={20} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋日期、主題、人物或關鍵字"
        />
      </section>

      <section className="history-list">
        {records.map((record) => (
          <article className="history-card" key={`${record.date}-${record.title}`}>
            <div>
              <p className="eyebrow">{record.date}</p>
              <h3>{record.title}</h3>
              <p>{record.summary}</p>
            </div>
            <div className="tag-row">
              {record.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function ExportView({ markdownPreview }) {
  return (
    <div className="view-stack">
      <section className="export-band">
        <div>
          <p className="eyebrow">第一階段假資料預覽</p>
          <h3>Markdown 匯出格式</h3>
        </div>
        <button className="secondary-action">
          <Download size={18} />
          匯出預覽
        </button>
      </section>
      <pre className="markdown-preview">{markdownPreview}</pre>
    </div>
  );
}

function SettingsView({ apiKey, setApiKey }) {
  return (
    <div className="view-stack settings-grid">
      <section className="settings-panel">
        <div className="summary-title">
          <KeyRound size={18} />
          <h3>API Key</h3>
        </div>
        <label htmlFor="api-key">由使用者自行輸入</label>
        <div className="api-key-row">
          <input
            id="api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="貼上 OpenAI API key"
            type="password"
          />
          <button
            className="secondary-action"
            disabled={!apiKey}
            onClick={() => setApiKey("")}
            type="button"
          >
            清除
          </button>
        </div>
        <p>
          API key 只保存在目前 App 畫面狀態，不會寫死在程式裡。產生逐字稿與 AI 整理時才會送到 OpenAI API。
        </p>
      </section>

      <section className="settings-panel">
        <div className="summary-title">
          <CheckCircle2 size={18} />
          <h3>第一版限制</h3>
        </div>
        <ul>
          {privacyRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function InfoTile({ icon, title, detail }) {
  return (
    <article className="info-tile">
      <div className="tile-icon">{icon}</div>
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </article>
  );
}

export default App;
