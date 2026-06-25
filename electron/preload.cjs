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
  }
});

contextBridge.exposeInMainWorld("workMemoryAi", {
  processRecording(request) {
    return ipcRenderer.invoke("ai:process-recording", request);
  }
});
