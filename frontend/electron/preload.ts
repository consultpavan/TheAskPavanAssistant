import { contextBridge, ipcRenderer } from 'electron';

// Expose safe, protected APIs to the renderer process (React API context)
contextBridge.exposeInMainWorld('electronAPI', {
    sendAudioStream: (data: Uint8Array) => ipcRenderer.send('audio-stream', data),
    onAppMessage: (callback: (message: string) => void) => ipcRenderer.on('main-process-message', (_event, value) => callback(value)),
    onMeetingStatusChanged: (callback: (isActive: boolean, source?: string) => void) => ipcRenderer.on('meeting-status-changed', (_event, data) => callback(data.active, data.source)),
    refreshMeetingStatus: () => ipcRenderer.invoke('meeting-status:refresh')
});

