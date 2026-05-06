// global.d.ts
export { };

declare global {
    interface ElectronAPI {
        sendAudioStream: (data: Uint8Array) => void;
        onAppMessage: (callback: (message: string) => void) => void;
        onMeetingStatusChanged: (callback: (isActive: boolean, source?: string) => void) => void;
        refreshMeetingStatus: () => Promise<{ active: boolean }>;
    }

    interface Window {
        electronAPI: ElectronAPI;
    }
}
