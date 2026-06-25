import { useMemo, useState } from "react";
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

function App() {
  const [activeView, setActiveView] = useState("today");
  const [recordingState, setRecordingState] = useState("idle");
  const [query, setQuery] = useState("");
  const [apiKey, setApiKey] = useState("");

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

  function startRecording() {
    setRecordingState("recording");
    setActiveView("today");
  }

  function pauseRecording() {
    setRecordingState("paused");
  }

  function resumeRecording() {
    setRecordingState("recording");
  }

  function stopRecording() {
    setRecordingState("stopped");
    setActiveView("today");
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
            onStart={startRecording}
            onPause={pauseRecording}
            onResume={resumeRecording}
            onStop={stopRecording}
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

function TodayView({ recordingState, onStart, onPause, onResume, onStop }) {
  return (
    <div className="view-stack">
      <section className="control-band">
        <div>
          <p className="eyebrow">手動開始，不自動錄音</p>
          <h3>按下開始記錄後，畫面才會進入記錄中狀態</h3>
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
        <input
          id="api-key"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="第一階段不會送出或儲存"
          type="password"
        />
        <p>
          第一階段只建立設定欄位。之後才會加入本機安全保存與 AI 摘要串接。
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
