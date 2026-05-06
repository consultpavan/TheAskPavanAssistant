import { app, BrowserWindow, ipcMain, session, dialog } from 'electron';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

// The built directory structure
//
// ├─┬ dist
// │ ├─┬ electron
// │ │ ├─┬ main.js
// │ │ └─┬ preload.js
// │ └── index.html

let mainWindow: BrowserWindow | null = null;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
        // Adding native properties for modern minimal UI
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#121212',
            symbolColor: '#ffffff'
        }
    });

    // Test active push message to Renderer-process.
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow?.webContents.send('main-process-message', (new Date).toLocaleString());
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../index.html'));
    }
}

// Meeting status check runs on demand (initial load + user refresh).
let meetingDetected = false;
let meetingCheckInProgress = false;

function queryMeetingStatus(): Promise<boolean> {
    return new Promise((resolve) => {
        if (meetingCheckInProgress) {
            resolve(meetingDetected);
            return;
        }

        meetingCheckInProgress = true;
        execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
            meetingCheckInProgress = false;
            if (error) {
                const message = String(error.message || '').toLowerCase();
                if (!message.includes('call cancelled') && !message.includes('killed')) {
                    console.warn(`Meeting check warning: ${error.message}`);
                }
                resolve(meetingDetected);
                return;
            }

            const stdoutLower = stdout.toLowerCase();
            const isMeetingActive = stdoutLower.includes('microsoft teams') ||
                stdoutLower.includes('ms-teams.exe') ||
                stdoutLower.includes('teams.exe') ||
                stdoutLower.includes('zoom meeting') ||
                stdoutLower.includes('zoom.exe') ||
                stdoutLower.includes('google meet');
            resolve(isMeetingActive);
        });
    });
}

async function checkActiveMeetings(forceNotify = false): Promise<boolean> {
    if (!mainWindow) return meetingDetected;
    const isMeetingActive = await queryMeetingStatus();

    if (isMeetingActive !== meetingDetected || forceNotify) {
        meetingDetected = isMeetingActive;
        mainWindow.webContents.send('meeting-status-changed', {
            active: meetingDetected,
            source: meetingDetected ? 'Meeting App' : undefined
        });
    }

    return meetingDetected;
}

// Ensure app runs only after ready
app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler(async (_webContents, permission, callback, details) => {
        const isMicRequest = permission === 'media' && Array.isArray(details.mediaTypes) && details.mediaTypes.includes('audio');
        const isAudioCapturePermission = permission === 'audioCapture';

        if (!isMicRequest && !isAudioCapturePermission) {
            callback(false);
            return;
        }

        const choice = await dialog.showMessageBox({
            type: 'question',
            buttons: ['Allow', 'Deny'],
            defaultId: 0,
            cancelId: 1,
            title: 'Microphone Permission',
            message: 'This app needs microphone access to transcribe meetings.',
            detail: 'Allow microphone access to continue.',
            noLink: true,
        });
        callback(choice.response === 0);
    });

    createWindow();
    checkActiveMeetings(true);

    ipcMain.handle('meeting-status:refresh', async () => {
        const active = await checkActiveMeetings(true);
        return { active };
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
