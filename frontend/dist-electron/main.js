import { BrowserWindow, app, dialog, ipcMain, session } from "electron";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
//#region electron/main.ts
var mainWindow = null;
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 900,
		height: 700,
		webPreferences: { preload: path.join(__dirname, "preload.js") },
		titleBarStyle: "hidden",
		titleBarOverlay: {
			color: "#121212",
			symbolColor: "#ffffff"
		}
	});
	mainWindow.webContents.on("did-finish-load", () => {
		mainWindow?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
	});
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(path.join(__dirname, "../index.html"));
}
var meetingDetected = false;
var meetingCheckInProgress = false;
function queryMeetingStatus() {
	return new Promise((resolve) => {
		if (meetingCheckInProgress) {
			resolve(meetingDetected);
			return;
		}
		meetingCheckInProgress = true;
		execFile("tasklist", [
			"/fo",
			"csv",
			"/nh"
		], {
			windowsHide: true,
			timeout: 4e3
		}, (error, stdout) => {
			meetingCheckInProgress = false;
			if (error) {
				const message = String(error.message || "").toLowerCase();
				if (!message.includes("call cancelled") && !message.includes("killed")) console.warn(`Meeting check warning: ${error.message}`);
				resolve(meetingDetected);
				return;
			}
			const stdoutLower = stdout.toLowerCase();
			resolve(stdoutLower.includes("microsoft teams") || stdoutLower.includes("ms-teams.exe") || stdoutLower.includes("teams.exe") || stdoutLower.includes("zoom meeting") || stdoutLower.includes("zoom.exe") || stdoutLower.includes("google meet"));
		});
	});
}
async function checkActiveMeetings(forceNotify = false) {
	if (!mainWindow) return meetingDetected;
	const isMeetingActive = await queryMeetingStatus();
	if (isMeetingActive !== meetingDetected || forceNotify) {
		meetingDetected = isMeetingActive;
		mainWindow.webContents.send("meeting-status-changed", {
			active: meetingDetected,
			source: meetingDetected ? "Meeting App" : void 0
		});
	}
	return meetingDetected;
}
app.whenReady().then(() => {
	session.defaultSession.setPermissionRequestHandler(async (_webContents, permission, callback, details) => {
		if (!(permission === "media" && Array.isArray(details.mediaTypes) && details.mediaTypes.includes("audio")) && !(permission === "audioCapture")) {
			callback(false);
			return;
		}
		callback((await dialog.showMessageBox({
			type: "question",
			buttons: ["Allow", "Deny"],
			defaultId: 0,
			cancelId: 1,
			title: "Microphone Permission",
			message: "This app needs microphone access to transcribe meetings.",
			detail: "Allow microphone access to continue.",
			noLink: true
		})).response === 0);
	});
	createWindow();
	checkActiveMeetings(true);
	ipcMain.handle("meeting-status:refresh", async () => {
		return { active: await checkActiveMeetings(true) };
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
//#endregion
