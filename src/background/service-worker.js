import {
  appendClipboardText,
  appendClipboardImage,
  cleanupExpiredHistory,
  getSettings,
} from "../lib/storage.js";
import { FUN_MESSAGES } from "../lib/messages.js";

const CLEANUP_ALARM_NAME = "clipboard_history_cleanup";
const CLEANUP_INTERVAL_MINUTES = 60;
const CONTENT_SCRIPT_FILE = "src/content/content.js";
const INJECTABLE_URL_PATTERNS = ["http://*/*", "https://*/*", "file:///*"];
const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";

const UPDATE_ALARM_NAME = "checkUpdates";
const UPDATE_CHECK_INTERVAL_MINUTES = 1440;
const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/Aeshp/Clipnext/releases/latest";

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

function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }

  return 0;
}

async function checkForUpdate() {
  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const tagName = data.tag_name;

    if (typeof tagName !== "string" || !tagName) {
      return;
    }

    const githubVersion = tagName.replace(/^v/i, "");
    const localVersion = chrome.runtime.getManifest().version;

    if (compareSemver(githubVersion, localVersion) > 0) {
      const stored = await chrome.storage.local.get("update_info");
      const existing = stored && stored.update_info;

      if (existing && existing.version === githubVersion) {
        return;
      }

      await chrome.storage.local.set({
        update_info: {
          version: githubVersion,
          url: data.html_url || "",
          badgeSeen: false,
        },
      });
    }
  } catch (_error) {
  }
}

async function runMaintenance() {
  ensureCleanupAlarm();
  await cleanupExpiredHistory();

  chrome.alarms.create(UPDATE_ALARM_NAME, {
    periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
  });
  checkForUpdate();

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

/**
 * @param {number|undefined} tabId
 */
async function maybeSendFunToast(tabId) {
  if (typeof tabId !== "number") {
    return;
  }

  try {
    const settings = await getSettings();
    if (!settings.notificationsEnabled) {
      return;
    }

    const randomIndex = Math.floor(Math.random() * FUN_MESSAGES.length);
    const message = FUN_MESSAGES[randomIndex];

    await chrome.tabs.sendMessage(tabId, {
      type: "SHOW_FUN_TOAST",
      message,
    });
  } catch (_error) {
  }
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
  if (!alarm || !alarm.name) {
    return;
  }

  if (alarm.name === CLEANUP_ALARM_NAME) {
    cleanupExpiredHistory().catch((error) => {
      console.error("Failed periodic cleanup:", error);
    });
    return;
  }

  if (alarm.name === UPDATE_ALARM_NAME) {
    checkForUpdate();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  const senderTabId = sender && sender.tab ? sender.tab.id : undefined;

  if (message.type === "COPIED_TEXT" && typeof message.text === "string") {
    saveCopiedText(message.text)
      .then((result) => {
        sendResponse({ ok: result.ok !== false });
        if (result.ok !== false) {
          maybeSendFunToast(senderTabId);
        }
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
        if (result.ok !== false) {
          maybeSendFunToast(senderTabId);
        }
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
          if (saved.ok !== false) {
            maybeSendFunToast(senderTabId);
          }
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
