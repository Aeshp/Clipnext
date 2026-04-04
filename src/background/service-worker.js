import {
  appendClipboardText,
  appendClipboardImage,
  cleanupExpiredHistory,
} from "../lib/storage.js";

const CLEANUP_ALARM_NAME = "clipboard_history_cleanup";
const CLEANUP_INTERVAL_MINUTES = 60;
const CONTENT_SCRIPT_FILE = "src/content/content.js";
const INJECTABLE_URL_PATTERNS = ["http://*/*", "https://*/*", "file:///*"];
const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (contexts.length > 0) {
    return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["CLIPBOARD"],
    justification: "Read clipboard image data for clipboard history",
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

async function readClipboardViaOffscreen() {
  await ensureOffscreenDocument();
  await new Promise((r) => setTimeout(r, 100));

  try {
    const result = await chrome.runtime.sendMessage({ type: "READ_CLIPBOARD" });
    return result;
  } catch (_error) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      return await chrome.runtime.sendMessage({ type: "READ_CLIPBOARD" });
    } catch (_retryError) {
      return null;
    }
  }
}

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
    await ensureOffscreenDocument();
  } catch (_error) {

  }

  try {
    await injectContentScriptIntoOpenTabs();
  } catch (error) {
    console.error("Failed to inject content script:", error);
  }
}

async function saveCopiedText(rawText) {
  return await appendClipboardText(rawText);
}

async function saveCopiedImage(imageDataUrl, mime) {
  return await appendClipboardImage(imageDataUrl, mime);
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
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "COPIED_TEXT" && typeof message.text === "string") {
    saveCopiedText(message.text)
      .then((result) => {
        sendResponse({ ok: result.ok !== false });
      })
      .catch((error) => {
        console.error("Failed to save clipboard text:", error);
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  //image clipboard messages
  if (message.type === "COPIED_IMAGE" && typeof message.image === "string") {
    saveCopiedImage(message.image, message.mime)
      .then((result) => {
        sendResponse({ ok: result.ok !== false });
      })
      .catch((error) => {
        console.error("Failed to save clipboard image:", error);
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  if (message.type === "CHECK_CLIPBOARD_IMAGE") {
    readClipboardViaOffscreen()
      .then(async (result) => {
        if (result && result.image) {
          const saved = await saveCopiedImage(result.image, result.mime);
          sendResponse({ ok: saved.ok !== false });
        } else {
          sendResponse({ ok: false });
        }
      })
      .catch(() => {
        sendResponse({ ok: false });
      });

    return true;
  }

  return false;
});
