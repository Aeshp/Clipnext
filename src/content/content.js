(function () {
  if (window.__clipcardContentLoaded) {
    return;
  }
  window.__clipcardContentLoaded = true;

  const HISTORY_KEY = "clipboard_history";
  const INTERACTION_READ_DELAY_MS = 180;

  let lastStoredText = "";
  let hasLoadedLastStoredText = false;
  let interactionReadTimer = 0;
  let readInProgress = false;

  function normalizeClipboardText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim();
  }

  function syncLastStoredTextFromHistoryValue(historyValue) {
    const history = Array.isArray(historyValue) ? historyValue : [];
    const lastItem = history[history.length - 1];

    if (lastItem && typeof lastItem.text === "string") {
      lastStoredText = normalizeClipboardText(lastItem.text);
      return;
    }

    lastStoredText = "";
  }

  async function loadLastStoredText() {
    if (hasLoadedLastStoredText) {
      return;
    }

    hasLoadedLastStoredText = true;

    try {
      const result = await chrome.storage.local.get(HISTORY_KEY);
      syncLastStoredTextFromHistoryValue(result[HISTORY_KEY]);
    } catch (_error) {
      // Safe fallback: background script still does duplicate checks.
    }
  }

  async function sendClipboardTextIfNew(rawText, source) {
    const text = normalizeClipboardText(rawText);
    if (!text) {
      return false;
    }

    await loadLastStoredText();

    if (text === lastStoredText) {
      return false;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "COPIED_TEXT",
        text,
        source,
      });

      if (response && response.ok) {
        lastStoredText = text;
      }

      return Boolean(response && response.ok);
    } catch (_error) {
      return false;
    }
  }

  async function readClipboardAfterInteraction() {
    if (readInProgress) {
      return;
    }

    if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
      return;
    }

    readInProgress = true;

    try {
      // Clipboard reads are only attempted shortly after trusted user interactions.
      const clipboardText = await navigator.clipboard.readText();
      await sendClipboardTextIfNew(clipboardText, "interaction-read");
    } catch (_error) {
      // Ignore permission/security errors and keep the extension stable.
    } finally {
      readInProgress = false;
    }
  }

  function scheduleClipboardRead() {
    window.clearTimeout(interactionReadTimer);
    interactionReadTimer = window.setTimeout(() => {
      readClipboardAfterInteraction().catch(() => {
        // Errors are handled in readClipboardAfterInteraction.
      });
    }, INTERACTION_READ_DELAY_MS);
  }

  function onClickInteraction(event) {
    if (!event.isTrusted) {
      return;
    }

    scheduleClipboardRead();
  }

  function onKeydownInteraction(event) {
    if (!event.isTrusted) {
      return;
    }

    const isLikelyClipboardTrigger =
      event.ctrlKey ||
      event.metaKey ||
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "Spacebar";

    if (!isLikelyClipboardTrigger) {
      return;
    }

    scheduleClipboardRead();
  }

  function insertTextIntoActiveField(text) {
    const activeElement = document.activeElement;
    if (!activeElement) {
      return false;
    }

    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement
    ) {
      if (activeElement.readOnly || activeElement.disabled) {
        return false;
      }

      const value = activeElement.value || "";
      const start = typeof activeElement.selectionStart === "number" ? activeElement.selectionStart : value.length;
      const end = typeof activeElement.selectionEnd === "number" ? activeElement.selectionEnd : value.length;

      const nextValue = value.slice(0, start) + text + value.slice(end);
      const cursor = start + text.length;

      activeElement.value = nextValue;
      activeElement.setSelectionRange(cursor, cursor);
      activeElement.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
      const inserted = document.execCommand("insertText", false, text);
      if (inserted) {
        return true;
      }

      activeElement.textContent = (activeElement.textContent || "") + text;
      activeElement.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    return false;
  }

  function getCopiedText(event) {
    if (event.clipboardData) {
      const clipboardText = event.clipboardData.getData("text/plain");
      if (clipboardText) {
        return clipboardText;
      }
    }

    const selection = window.getSelection();
    if (selection) {
      const selectedText = selection.toString();
      if (selectedText) {
        return selectedText;
      }
    }

    const activeElement = document.activeElement;
    if (!activeElement || typeof activeElement.value !== "string") {
      return "";
    }

    const start = activeElement.selectionStart;
    const end = activeElement.selectionEnd;

    if (typeof start === "number" && typeof end === "number" && end > start) {
      return activeElement.value.slice(start, end);
    }

    return "";
  }

  document.addEventListener(
    "copy",
    (event) => {
      const text = getCopiedText(event);
      sendClipboardTextIfNew(text, "copy-event").catch(() => {
        // Ignore runtime message failures for stability.
      });
    },
    true
  );

  document.addEventListener("click", onClickInteraction, true);
  document.addEventListener("keydown", onKeydownInteraction, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "PASTE_TEXT" || typeof message.text !== "string") {
      return false;
    }

    const ok = insertTextIntoActiveField(message.text);
    sendResponse({ ok });
    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(changes, HISTORY_KEY)) {
      return;
    }

    const nextValue = changes[HISTORY_KEY].newValue;
    syncLastStoredTextFromHistoryValue(nextValue);
  });

  loadLastStoredText().catch(() => {
    // Ignore storage read issues.
  });
})();
