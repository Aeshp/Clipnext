(function () {
  if (window.__clipcardContentLoaded) {
    return;
  }
  window.__clipcardContentLoaded = true;

  const HISTORY_KEY = "clipboard_history";
  const INTERACTION_READ_DELAY_MS = 180;
  const INJECTED_MESSAGE_SOURCE = "__clipcard_injected";
  let lastStoredText = "";
  let lastStoredTextKey = "";
  let lastStoredImageHash = "";
  let hasLoadedLastStored = false;
  let interactionReadTimer = 0;
  let readInProgress = false;

  function normalizeClipboardText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim();
  }

  function toComparisonKey(text) {
    if (typeof text !== "string") {
      return "";
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function imageQuickHash(dataUrl) {
    if (typeof dataUrl !== "string") {
      return "";
    }
    return dataUrl.slice(0, 200);
  }

  function syncLastStoredFromHistoryValue(historyValue) {
    const history = Array.isArray(historyValue) ? historyValue : [];
    const lastItem = history[history.length - 1];

    if (!lastItem) {
      lastStoredText = "";
      lastStoredTextKey = "";
      lastStoredImageHash = "";
      return;
    }

    const itemType = lastItem.type || "text";
    if (itemType === "text" && typeof lastItem.text === "string") {
      lastStoredText = normalizeClipboardText(lastItem.text);
      lastStoredTextKey = toComparisonKey(lastItem.text);
      lastStoredImageHash = "";
    } else if (itemType === "image" && typeof lastItem.image === "string") {
      lastStoredImageHash = imageQuickHash(lastItem.image);
      lastStoredText = "";
      lastStoredTextKey = "";
    } else {
      lastStoredText = "";
      lastStoredTextKey = "";
      lastStoredImageHash = "";
    }
  }

  async function loadLastStored() {
    if (hasLoadedLastStored) {
      return;
    }

    hasLoadedLastStored = true;

    try {
      const result = await chrome.storage.local.get(HISTORY_KEY);
      syncLastStoredFromHistoryValue(result[HISTORY_KEY]);
    } catch (_error) {
      // Safe fallback: background script still does duplicate checks.
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl === "string") {
          resolve(dataUrl);
        } else {
          reject(new Error("FileReader did not produce a string"));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function sendClipboardTextIfNew(rawText, source) {
    const text = normalizeClipboardText(rawText);
    if (!text) {
      return false;
    }

    await loadLastStored();

    const key = toComparisonKey(text);
    if (key === lastStoredTextKey) {
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
        lastStoredTextKey = key;
      }

      return Boolean(response && response.ok);
    } catch (_error) {
      return false;
    }
  }

  async function sendClipboardImageIfNew(imageDataUrl, mime, source) {
    if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:")) {
      return false;
    }

    await loadLastStored();

    const hash = imageQuickHash(imageDataUrl);
    if (hash === lastStoredImageHash) {
      return false;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "COPIED_IMAGE",
        image: imageDataUrl,
        mime: mime || "image/png",
        source,
      });

      if (response && response.ok) {
        lastStoredImageHash = hash;
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

    readInProgress = true;

    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText && clipboardText.trim()) {
          await sendClipboardTextIfNew(clipboardText, "interaction-read");
          return;
        }
      }

      requestImageReadFromBackground();
    } catch (_error) {
      requestImageReadFromBackground();
    } finally {
      readInProgress = false;
    }
  }

  function requestImageReadFromBackground() {
    try {
      chrome.runtime.sendMessage({ type: "CHECK_CLIPBOARD_IMAGE" }).catch(() => {});
    } catch (_error) {
    }
  }

  function scheduleClipboardRead() {
    window.clearTimeout(interactionReadTimer);
    interactionReadTimer = window.setTimeout(() => {
      readClipboardAfterInteraction().catch(() => {
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

      if (text) {
        window.clearTimeout(interactionReadTimer);
        sendClipboardTextIfNew(text, "copy-event").catch(() => {
          // Again Ignore runtime message failures for stability.
        });
      } else {
        window.clearTimeout(interactionReadTimer);
        setTimeout(() => {
          requestImageReadFromBackground();
        }, 250);
      }
    },
    true
  );

  document.addEventListener("click", onClickInteraction, true);
  document.addEventListener("keydown", onKeydownInteraction, true);

  document.addEventListener(
    "contextmenu",
    (event) => {
      if (!event.isTrusted) {
        return;
      }

      setTimeout(() => requestImageReadFromBackground(), 800);
      setTimeout(() => requestImageReadFromBackground(), 2500);
    },
    true
  );

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== INJECTED_MESSAGE_SOURCE) {
      return;
    }

    const payload = data.payload;
    if (!payload || !payload.type) {
      return;
    }

    if (payload.type === "COPIED_TEXT" && typeof payload.text === "string") {
      sendClipboardTextIfNew(payload.text, "injected-writeText").catch(() => {});
    }

    if (payload.type === "COPIED_IMAGE" && typeof payload.image === "string") {
      sendClipboardImageIfNew(payload.image, payload.mime, "injected-write").catch(() => {});
    }
  });

  function injectPageScript() {
    try {
      const scriptUrl = chrome.runtime.getURL("src/injected/injected.js");
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (_error) {
    }
  }

  injectPageScript();

  const FUN_TOAST_WRAPPER_ID = "clipnest-toast-wrapper";
  const CLIPNEST_LOGO_URL = chrome.runtime.getURL("assets/icons/icon48.png");

  function showFunToast(text) {
    if (typeof text !== "string" || !text) {
      return;
    }

    let wrapper = document.getElementById(FUN_TOAST_WRAPPER_ID);

    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.id = FUN_TOAST_WRAPPER_ID;
      Object.assign(wrapper.style, {
        position: "fixed",
        top: "20px",
        right: "20px",
        zIndex: "2147483647",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "8px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      });
      document.body.appendChild(wrapper);
    }

    const toast = document.createElement("div");
    Object.assign(toast.style, {
      background: "#ffffff",
      color: "#1f2937",
      fontSize: "13.5px",
      fontWeight: "500",
      lineHeight: "1.45",
      borderRadius: "10px",
      border: "1px solid #e5e7eb",
      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
      maxWidth: "320px",
      overflow: "hidden",
      wordBreak: "break-word",
      pointerEvents: "none",
      willChange: "transform, opacity",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "8px 12px 6px",
      borderBottom: "1px solid #f3f4f6",
    });

    const logo = document.createElement("img");
    logo.src = CLIPNEST_LOGO_URL;
    logo.alt = "";
    logo.width = 16;
    logo.height = 16;
    Object.assign(logo.style, {
      width: "16px",
      height: "16px",
      borderRadius: "3px",
      flexShrink: "0",
    });

    const brand = document.createElement("span");
    Object.assign(brand.style, {
      fontSize: "11.5px",
      fontWeight: "700",
      color: "#4b5563",
      letterSpacing: "-0.2px",
    });

    const brandClip = document.createElement("span");
    brandClip.textContent = "Clip";

    const brandNext = document.createElement("span");
    brandNext.textContent = "next";
    brandNext.style.fontStyle = "italic";

    brand.appendChild(brandClip);
    brand.appendChild(brandNext);

    header.appendChild(logo);
    header.appendChild(brand);

    const body = document.createElement("div");
    body.textContent = text;
    Object.assign(body.style, {
      padding: "6px 12px 10px",
      fontSize: "13.5px",
      fontWeight: "500",
      lineHeight: "1.45",
      color: "#1f2937",
    });

    toast.appendChild(header);
    toast.appendChild(body);
    wrapper.appendChild(toast);

    const animation = toast.animate(
      [
        { opacity: 0, transform: "translateY(-20px)" },
        { opacity: 1, transform: "translateY(0)", offset: 0.06 },
        { opacity: 1, transform: "translateY(0)", offset: 0.90 },
        { opacity: 0, transform: "translateY(-20px)" },
      ],
      {
        duration: 4800,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
      }
    );

    animation.finished
      .then(() => {
        toast.remove();
        if (wrapper && wrapper.children.length === 0) {
          wrapper.remove();
        }
      })
      .catch(() => {
        try { toast.remove(); } catch (_e) { }
      });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === "PASTE_TEXT" && typeof message.text === "string") {
      const ok = insertTextIntoActiveField(message.text);
      sendResponse({ ok });
      return false;
    }

    if (message.type === "SHOW_FUN_TOAST" && typeof message.message === "string") {
      showFunToast(message.message);
      return false;
    }

    return false;
  });

  loadLastStored().catch(() => {
    // Ignore storage read issues.
  });
})();
