const TARGET_URL = "https://music.163.com/";
const BUFFER_TIME_MS = 2000;
const ALARM_NAME = "smartDailyNetEaseCheck";

// Icons configuration
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

// 1. Update UI based on status
function updateUI(isEnabled) {
    if (isEnabled) {
        chrome.action.setIcon({ path: ICONS_RED });
        chrome.action.setTitle({ title: "TuneWake: Active" });
    } else {
        chrome.action.setIcon({ path: ICONS_GRAY });
        chrome.action.setTitle({ title: "TuneWake: Disabled (Click to enable)" });
    }
}

// 2. Main logic with status check
function checkAndOpenNetEase() {
    chrome.storage.local.get(['isEnabled', 'lastOpenedDate'], function(result) {
        // Default to enabled if not set
        const isEnabled = result.isEnabled !== false; 
        const today = new Date().toDateString();

        if (!isEnabled) {
            console.log("TuneWake is currently disabled by user. Skipping task.");
            return;
        }

        if (result.lastOpenedDate !== today) {
            console.log("Running daily task...");
            // ... (Your existing check-in and tab creation logic here)
            // Note: Use your existing performCheckIn() and executeMode functions
            runCoreLogic(today); 
        } else {
            console.log("Already run today.");
        }
        
        scheduleNextRun();
    });
}

// 3. Handle Toolbar Icon Click
chrome.action.onClicked.addListener((tab) => {
    chrome.storage.local.get(['isEnabled'], function(result) {
        const newState = result.isEnabled === false; // Toggle state
        chrome.storage.local.set({ isEnabled: newState }, () => {
            updateUI(newState);
            console.log("TuneWake state changed to:", newState ? "ON" : "OFF");
            
            // If just turned on, try to run immediately
            if (newState) checkAndOpenNetEase();
        });
    });
});

// 4. Helper to wrap your existing logic
function runCoreLogic(today) {
    chrome.cookies.get({ url: TARGET_URL, name: "MUSIC_U" }, function(cookie) {
        if (cookie) {
            // performCheckIn(); // Call your sign-in API
            // executeSilentMode(today); // Open/Close background tab
        } else {
            // executeManualLoginMode(today); // Prompt login
        }
    });
}

// Ensure UI is correct on startup/install
function init() {
    chrome.storage.local.get(['isEnabled'], (result) => {
        updateUI(result.isEnabled !== false);
    });
}

chrome.runtime.onStartup.addListener(() => {
    init();
    checkAndOpenNetEase();
});

chrome.runtime.onInstalled.addListener(() => {
    init();
    checkAndOpenNetEase();
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) checkAndOpenNetEase();
});

// Re-use your existing scheduleNextRun() here...