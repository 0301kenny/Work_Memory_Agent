const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = () => callback();

  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("workMemorySchedule", {
  onOpenToday(callback) {
    return subscribe("schedule:open-today", callback);
  },
  onAutoStop(callback) {
    return subscribe("schedule:auto-stop", callback);
  },
  updateRecordingState(state) {
    ipcRenderer.send("recording-state:changed", state);
  }
});

contextBridge.exposeInMainWorld("workMemoryAudio", {
  saveRecording(recording) {
    return ipcRenderer.invoke("recording:save", recording);
  },
  showRecordingInFolder(filePath) {
    return ipcRenderer.invoke("recording:show-in-folder", filePath);
  },
  listRecordings() {
    return ipcRenderer.invoke("recording:list");
  }
});

contextBridge.exposeInMainWorld("workMemoryAi", {
  processRecording(request) {
    return ipcRenderer.invoke("ai:process-recording", request);
  }
});

contextBridge.exposeInMainWorld("workMemorySettings", {
  load() {
    return ipcRenderer.invoke("settings:load");
  },
  save(settings) {
    return ipcRenderer.invoke("settings:save", settings);
  },
  clearApiKey() {
    return ipcRenderer.invoke("settings:clear-api-key");
  },
  testConnection(settings) {
    return ipcRenderer.invoke("settings:test-connection", settings);
  },
  detectWhisper() {
    return ipcRenderer.invoke("whisper:detect");
  }
});

contextBridge.exposeInMainWorld("workMemoryHistory", {
  list() {
    return ipcRenderer.invoke("history:list");
  },
  delete(recordId) {
    return ipcRenderer.invoke("history:delete", recordId);
  }
});

contextBridge.exposeInMainWorld("workMemoryMarkdown", {
  copy(markdown) {
    return ipcRenderer.invoke("markdown:copy", markdown);
  },
  download(payload) {
    return ipcRenderer.invoke("markdown:download", payload);
  }
});
