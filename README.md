# Work Memory Agent

個人使用的桌面工作記憶助理。第一版重點是手動錄音、錄完後轉文字、Markdown 逐字稿、搜尋歷史紀錄與本機資料保存。

## 啟動

```bash
npm install
npm run dev
```

## 打包

```bash
npm run dist
```

## Local Whisper 安裝

設定頁預設推薦 `Local Whisper`，不需要 API key。第一版只做「錄完後轉文字」，不做即時轉錄。

### 方案 A：MLX Whisper，Apple Silicon 推薦

```bash
pipx install mlx-whisper
```

安裝後回到 App 設定頁按「偵測工具」。如果 App 找得到 `mlx_whisper`，即可使用 Local Whisper。

### 方案 B：whisper.cpp

```bash
brew install whisper-cpp
```

接著下載模型，例如：

```bash
curl -L -o ~/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

回到 App 設定頁：

- `Local command` 可留空自動偵測，或填 `whisper-cli`
- `Local model path` 填 `~/ggml-base.bin`

### 方案 C：Python Whisper

```bash
pipx install openai-whisper
```

安裝後回到 App 設定頁按「偵測工具」。

## API 模式

設定頁可選：

- `OpenAI-compatible API`
- `Custom API endpoint`

API key 由使用者貼上並按「儲存」，會使用 Electron `safeStorage` 儲存在本機安全位置，不會寫死在程式碼裡，也不會輸出到 log。

API 模式可能產生費用，使用前請確認 provider 的計費方式。
