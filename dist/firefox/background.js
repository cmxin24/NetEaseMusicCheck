const TARGET_URL = "https://music.163.com/";
const BUFFER_TIME_MS = 2000;
const ALARM_NAME = "smartDailyNetEaseCheck";
const LOGIN_NOTIFICATION_ID = "netease_login_needed";
const LOG_STORAGE_KEY = "runtimeLogs";
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const LOG_MAX_ENTRIES = 2000;

let logWriteQueue = Promise.resolve();

function normalizeError(err) {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    try {
        return JSON.stringify(err);
    } catch (_) {
        return String(err);
    }
}

function enqueuePersistentLog(level, message, details) {
    const entry = {
        ts: Date.now(),
        level,
        message,
        details: details ?? null
    };

    logWriteQueue = logWriteQueue
        .then(() => new Promise((resolve) => {
            chrome.storage.local.get([LOG_STORAGE_KEY], (res) => {
                const rawLogs = Array.isArray(res[LOG_STORAGE_KEY]) ? res[LOG_STORAGE_KEY] : [];
                const cutoff = Date.now() - LOG_RETENTION_MS;
                const recentLogs = rawLogs.filter((item) => item && typeof item.ts === "number" && item.ts >= cutoff);
                recentLogs.push(entry);
                if (recentLogs.length > LOG_MAX_ENTRIES) {
                    recentLogs.splice(0, recentLogs.length - LOG_MAX_ENTRIES);
                }

                chrome.storage.local.set({ [LOG_STORAGE_KEY]: recentLogs }, () => resolve());
            });
        }))
        .catch((err) => {
            console.error("Persistent log write failed:", err);
        });
}

function logInfo(message, details) {
    if (details !== undefined) {
        console.log(message, details);
    } else {
        console.log(message);
    }
    enqueuePersistentLog("info", message, details);
}

function logWarn(message, details) {
    if (details !== undefined) {
        console.warn(message, details);
    } else {
        console.warn(message);
    }
    enqueuePersistentLog("warn", message, details);
}

function logError(message, details) {
    if (details !== undefined) {
        console.error(message, details);
    } else {
        console.error(message);
    }
    enqueuePersistentLog("error", message, details);
}

function pruneLogs(callback) {
    chrome.storage.local.get([LOG_STORAGE_KEY], (res) => {
        const rawLogs = Array.isArray(res[LOG_STORAGE_KEY]) ? res[LOG_STORAGE_KEY] : [];
        const cutoff = Date.now() - LOG_RETENTION_MS;
        const recentLogs = rawLogs.filter((item) => item && typeof item.ts === "number" && item.ts >= cutoff);
        chrome.storage.local.set({ [LOG_STORAGE_KEY]: recentLogs }, () => {
            if (typeof callback === "function") callback(recentLogs);
        });
    });
}

function printSavedLogs() {
    pruneLogs((logs) => {
        console.group(`NetEaseMusicActivator logs (last 7 days, count=${logs.length})`);
        if (logs.length === 0) {
            console.log("No logs in the last 7 days.");
            console.groupEnd();
            return;
        }

        console.table(
            logs.map((item, index) => ({
                index: index + 1,
                time: new Date(item.ts).toLocaleString(),
                level: item.level,
                message: item.message,
                details: item.details == null ? "" : (typeof item.details === "string" ? item.details : JSON.stringify(item.details))
            }))
        );
        console.groupEnd();
    });
}

globalThis.printSavedLogs = printSavedLogs;
globalThis.printNeteaseLogs = printSavedLogs;

// Icon Paths
const ICONS_RED = {
    "16": "images/red16.png",
    "48": "images/red48.png",
    "128": "images/red128.png"
};
const ICONS_GRAY = {
    "16": "images/gray16.png",
    "48": "images/gray48.png",
    "128": "images/gray128.png"
};

/**
 * UI & Icon Manager
 */
function updateUI(isEnabled) {
    if (isEnabled) {
        chrome.action.setIcon({ path: ICONS_RED });
        chrome.action.setTitle({ title: "NetEaseMusicActivator: Active" });
    } else {
        chrome.action.setIcon({ path: ICONS_GRAY });
        chrome.action.setTitle({ title: "NetEaseMusicActivator: Disabled (Click to enable)" });
    }
}

/**
 * Schedule next run at 00:00:05 of the next day
 */
function scheduleNextRun() {
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(24, 0, 5, 0);
    chrome.alarms.create(ALARM_NAME, { when: nextRun.getTime() });
    logInfo("Next check scheduled at", nextRun.toLocaleString());
}

/**
 * API Check-in Logic
 */
function performCheckIn() {
    return new Promise((resolve) => {
        chrome.cookies.get({ url: TARGET_URL, name: "__csrf" }, (cookie) => {
            const csrfToken = cookie ? cookie.value : '';
            const apiUrl = "https://music.163.com/api/point/dailyTask?type=1";
            
            const params = new URLSearchParams();
            params.append('type', '1');
            if (csrfToken) params.append('csrf_token', csrfToken);

            fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                credentials: 'include',
                body: params
            })
            .then(res => res.json())
            .then(data => {
                if (data.code === 200) {
                    logInfo("Check-in success", { point: data.point });
                    resolve(true);
                } else if (data.code === -2) {
                    logInfo("Already checked in today");
                    resolve(true);
                } else {
                    logWarn("Check-in failed/Auth required", { code: data.code });
                    resolve(false);
                }
            })
            .catch(err => {
                logError("Check-in error", normalizeError(err));
                resolve(false);
            });
        });
    });
}

/**
 * Task Executors
 */
function executeSuccessTask(today) {
    // Only silent mode for success
    chrome.tabs.create({ url: TARGET_URL, active: false }, (tab) => {
        chrome.storage.local.set({ lastOpenedDate: today });
        
        const tabId = tab.id;
        const listener = (id, info) => {
            if (id === tabId && info.status === 'complete') {
                setTimeout(() => {
                    chrome.tabs.remove(id, () => chrome.runtime.lastError);
                    logInfo("Silent task completed and tab closed");
                }, BUFFER_TIME_MS);
                chrome.tabs.onUpdated.removeListener(listener);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

function executeLoginTask() {
    // Opens the login page in the background and keeps it open
    chrome.tabs.create({ url: TARGET_URL, active: false }, (tab) => {
        logWarn("Login page opened in background", { tabId: tab.id });
    });
}

function showLoginNotification() {
    chrome.notifications.create(LOGIN_NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: ICONS_RED["128"],
        title: 'NetEaseMusicActivator',
        message: '请登录您的账号完成签到。Login required.',
        priority: 2
    });
}

/**
 * Main Orchestrator
 */
function checkAndRun() {
    chrome.storage.local.get(['isEnabled', 'lastOpenedDate'], (res) => {
        const isEnabled = res.isEnabled !== false;
        updateUI(isEnabled);

        if (!isEnabled) {
            logInfo("NetEaseMusicActivator is OFF. Skipping");
            return;
        }

        const today = new Date().toDateString();
        if (res.lastOpenedDate !== today) {
            chrome.cookies.get({ url: TARGET_URL, name: "MUSIC_U" }, async (cookie) => {
                let success = false;
                if (cookie) {
                    success = await performCheckIn();
                }

                if (success) {
                    executeSuccessTask(today);
                } else {
                    executeLoginTask(); // Open background tab
                    showLoginNotification();
                }
            });
        }
        scheduleNextRun();
    });
}

/**
 * Event Listeners
 */

// Toggle Switch on Click
chrome.action.onClicked.addListener(() => {
    chrome.storage.local.get(['isEnabled'], (res) => {
        const newState = res.isEnabled === false;
        chrome.storage.local.set({ isEnabled: newState }, () => {
            updateUI(newState);
            if (newState) checkAndRun();
        });
    });
});

chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM_NAME) checkAndRun();
});

chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId === LOGIN_NOTIFICATION_ID) {
        // Find existing tab with music.163.com
        chrome.tabs.query({ url: "*://music.163.com/*" }, (tabs) => {
            if (tabs && tabs.length > 0) {
                const tab = tabs[0];
                chrome.tabs.update(tab.id, { active: true });
                chrome.windows.update(tab.windowId, { focused: true });
            } else {
                 chrome.tabs.create({ url: TARGET_URL });
            }
        });
        chrome.notifications.clear(notificationId);
    }
});

chrome.runtime.onStartup.addListener(checkAndRun);
chrome.runtime.onInstalled.addListener(checkAndRun);

pruneLogs(() => {
    logInfo("Service worker initialized");
});