import { appendClipboardText, cleanupExpiredHistory } from "../lib/storage.js";

const CLEANUP_ALARM_NAME = "clipboard_history_cleanup";
const CLEANUP_INTERVAL_MINUTES = 60;
const CONTENT_SCRIPT_FILE = "src/content/content.js";
const INJECTABLE_URL_PATTERNS = ["http://*/*", "https://*/*", "file:///*"];

function ensureCleanupAlarm() {
  chrome.alarms.create(CLEANUP_ALARM_NAME, {
    periodInMinutes: CLEANUP_INTERVAL_MINUTES,
  });
}

async function injectContentScriptIntoOpenTabs() {
  const tabs = await chrome.tabs.query({
    url: INJECTABLE_URL_PATTERNS,
  });

  const injections = tabs.map(async (tab) => {
    if (!tab || typeof tab.id !== "number") {
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: [CONTENT_SCRIPT_FILE],
      });
    } catch (_error) {
      // Ignore tabs where injection is not allowed.
    }
  });

  await Promise.all(injections);
}

async function runMaintenance() {
  ensureCleanupAlarm();
  await cleanupExpiredHistory();

  try {
    await injectContentScriptIntoOpenTabs();
  } catch (error) {
    console.error("Failed to inject content script:", error);
  }
}

async function saveCopiedText(rawText) {
  await appendClipboardText(rawText);
}

chrome.runtime.onStartup.addListener(() => {
  runMaintenance().catch((error) => {
    console.error("Failed startup cleanup:", error);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  runMaintenance().catch((error) => {
    console.error("Failed install cleanup:", error);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== CLEANUP_ALARM_NAME) {
    return;
  }

  cleanupExpiredHistory().catch((error) => {
    console.error("Failed periodic cleanup:", error);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "COPIED_TEXT" || typeof message.text !== "string") {
    return false;
  }

  saveCopiedText(message.text)
    .then(() => {
      sendResponse({ ok: true });
    })
    .catch((error) => {
      console.error("Failed to save clipboard text:", error);
      sendResponse({ ok: false, error: String(error) });
    });

  return true;
});
